import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { getDailyChampion, leaderboardKey, utcDateKey, yesterdayDateKey } from '../core/daily';
import {
  DAILY_MAX_ATTEMPTS,
  type DailyStatusResponse,
  type DecrementResponse,
  type IncrementResponse,
  type InitResponse,
  type LeaderboardResponse,
  type Outcome,
  type SubmitRunRequest,
  type SubmitRunResponse,
} from '../../shared/api';

/** Climbs (lives) per player per day. Best height of the day is what counts. */
const MAX_ATTEMPTS = DAILY_MAX_ATTEMPTS;

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

// --- Daily challenge helpers (Phase 2) ---
// (utcDateKey / leaderboardKey / champion lookup live in ../core/daily.)

/** Deterministic positive 31-bit int from the date key (FNV-1a hash). */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 0x7fffffff || 1;
}

// Per-day, per-user climb count (0..MAX_ATTEMPTS) and the user's best run.
const attemptsKey = (dateKey: string, username: string) => `attempts:${dateKey}:${username}`;
const bestKey = (dateKey: string, username: string) => `best:${dateKey}:${username}`;
const DAILY_TTL_SECONDS = 2 * 24 * 60 * 60; // self-clean a day's attempt/best keys after 2 days

/** Coerces a stored/submitted outcome to a valid Outcome (defaults to 'fell'). */
function toOutcome(v: unknown): Outcome {
  return v === 'win' || v === 'caught' ? v : 'fell';
}

// Fun, varied announcement lines posted on the daily post when a player sets a
// new personal best. A few phrasings per outcome so it never reads repetitive.
const COMMENT_TEMPLATES: Record<Outcome, ((u: string, h: number) => string)[]> = {
  caught: [
    (u, h) => `🏔️ u/${u} reached ${h}m before the ghost caught them!`,
    (u, h) => `👻 The ghost caught u/${u} at ${h}m today — so close!`,
    (u, h) => `🕯️ u/${u} climbed to ${h}m before the dark swallowed them.`,
  ],
  fell: [
    (u, h) => `🪂 u/${u} fell at ${h}m on today's climb.`,
    (u, h) => `💫 u/${u} slipped at ${h}m — the summit waits for tomorrow.`,
    (u, h) => `🌙 u/${u} tumbled off the mountain at ${h}m tonight.`,
  ],
  win: [
    (u, h) => `🎉 u/${u} escaped to the summit at ${h}m!`,
    (u, h) => `🏆 u/${u} conquered today's mountain — ${h}m to the top!`,
    (u, h) => `☀️ u/${u} reached the light at ${h}m. Legend.`,
  ],
};

/** Builds a varied announcement line for a run result. */
function buildResultComment(username: string, height: number, outcome: Outcome): string {
  const templates = COMMENT_TEMPLATES[outcome];
  const make = templates[Math.floor(Math.random() * templates.length)] ?? templates[0];
  return make ? make(username, height) : `u/${username} climbed ${height}m today.`;
}

/** Reads this user's BEST run for the day, if any. */
async function readBest(
  dateKey: string,
  username: string
): Promise<{ height: number; outcome: Outcome } | null> {
  const raw = await redis.get(bestKey(dateKey, username));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { height?: number; outcome?: unknown };
    return { height: Math.max(0, Math.floor(Number(p.height) || 0)), outcome: toOutcome(p.outcome) };
  } catch {
    return null;
  }
}

/** How many of today's climbs this user has taken (0..MAX_ATTEMPTS). */
async function readAttemptsUsed(dateKey: string, username: string): Promise<number> {
  const raw = await redis.get(attemptsKey(dateKey, username));
  const n = Math.floor(Number(raw) || 0);
  return Math.max(0, Math.min(MAX_ATTEMPTS, n));
}

/**
 * 1-based descending rank (highest height = 1). Redis zRank is 0-based ascending,
 * so we invert it against the player count. Returns 0 if the user isn't ranked.
 */
async function descendingRank(dateKey: string, username: string, totalPlayers: number): Promise<number> {
  const ascRank = await redis.zRank(leaderboardKey(dateKey), username);
  if (ascRank === undefined) return 0;
  return totalPlayers - ascRank;
}

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required but missing from context',
      },
      400
    );
  }

  try {
    const [count, username] = await Promise.all([
      redis.get('count'),
      reddit.getCurrentUsername(),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      postId: postId,
      count: count ? parseInt(count) : 0,
      username: username ?? 'anonymous',
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    let errorMessage = 'Unknown error during initialization';
    if (error instanceof Error) {
      errorMessage = `Initialization failed: ${error.message}`;
    }
    return c.json<ErrorResponse>(
      { status: 'error', message: errorMessage },
      400
    );
  }
});

api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({
    count,
    postId,
    type: 'increment',
  });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({
    count,
    postId,
    type: 'decrement',
  });
});

// --- Daily challenge endpoints (Phase 2) ---

// GET /api/daily-status — today's seed + how many of the day's climbs remain.
api.get('/daily-status', async (c) => {
  try {
    const dateKey = utcDateKey();
    const seed = hashSeed(dateKey);
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const attemptsUsed = await readAttemptsUsed(dateKey, username);
    const best = await readBest(dateKey, username);
    // Yesterday's champion, for a bit of community recognition on the menu.
    const champion = await getDailyChampion(yesterdayDateKey()).catch(() => null);

    return c.json<DailyStatusResponse>({
      type: 'daily-status',
      dateKey,
      seed,
      attemptsUsed,
      attemptsMax: MAX_ATTEMPTS,
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - attemptsUsed),
      bestHeight: best?.height ?? 0,
      bestOutcome: best?.outcome ?? null,
      champion,
    });
  } catch (error) {
    console.error('API daily-status error:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to load daily status' }, 400);
  }
});

// POST /api/submit-run — record one of the day's climbs (up to MAX_ATTEMPTS).
// The player's BEST height of the day is what lands on the leaderboard.
api.post('/submit-run', async (c) => {
  try {
    const dateKey = utcDateKey();
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const lbKey = leaderboardKey(dateKey);

    const body = (await c.req.json().catch(() => ({}))) as Partial<SubmitRunRequest>;
    const height = Math.max(0, Math.floor(Number(body.height) || 0));
    const outcome = toOutcome(body.outcome);

    const attemptsUsed = await readAttemptsUsed(dateKey, username);

    // No climbs left: reject, returning the current standing unchanged.
    if (attemptsUsed >= MAX_ATTEMPTS) {
      const best = await readBest(dateKey, username);
      const totalPlayers = await redis.zCard(lbKey);
      const rank = await descendingRank(dateKey, username, totalPlayers);
      return c.json<SubmitRunResponse>({
        type: 'submit-run',
        accepted: false,
        attemptsUsed,
        attemptsLeft: 0,
        rank,
        bestHeight: best?.height ?? 0,
        bestOutcome: best?.outcome ?? null,
        totalPlayers,
      });
    }

    // Count this climb.
    const newAttemptsUsed = await redis.incrBy(attemptsKey(dateKey, username), 1);
    await redis.expire(attemptsKey(dateKey, username), DAILY_TTL_SECONDS);

    // Update the best-of-day only if this run beat it.
    const prevBest = await readBest(dateKey, username);
    const isNewBest = !prevBest || height > prevBest.height;
    const bestHeight = prevBest && prevBest.height >= height ? prevBest.height : height;
    const bestOutcome = prevBest && prevBest.height >= height ? prevBest.outcome : outcome;
    if (isNewBest) {
      await redis.set(bestKey(dateKey, username), JSON.stringify({ height, outcome }));
    }
    await redis.expire(bestKey(dateKey, username), DAILY_TTL_SECONDS);

    // Leaderboard entry always reflects the player's BEST of the day.
    await redis.zAdd(lbKey, { member: username, score: bestHeight });

    // Community engagement: announce a NEW PERSONAL BEST in the daily post's
    // comments (1st climb, then only when a later climb beats it — never every
    // attempt, so the post isn't flooded). Failures never break the submission.
    const postId = context.postId;
    if (isNewBest && username !== 'anonymous' && postId) {
      try {
        await reddit.submitComment({
          id: postId,
          text: buildResultComment(username, height, outcome),
          runAs: 'APP',
        });
      } catch (error) {
        console.error('Failed to post result comment:', error);
      }
    }

    const totalPlayers = await redis.zCard(lbKey);
    const rank = await descendingRank(dateKey, username, totalPlayers);
    return c.json<SubmitRunResponse>({
      type: 'submit-run',
      accepted: true,
      attemptsUsed: newAttemptsUsed,
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - newAttemptsUsed),
      rank,
      bestHeight,
      bestOutcome,
      totalPlayers,
    });
  } catch (error) {
    console.error('API submit-run error:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to submit run' }, 400);
  }
});

// GET /api/leaderboard — today's top 10 plus the current user's standing.
api.get('/leaderboard', async (c) => {
  try {
    const dateKey = utcDateKey();
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const lbKey = leaderboardKey(dateKey);

    // Highest score first: by rank, reversed (index 0 = top score).
    const top = await redis.zRange(lbKey, 0, 9, { by: 'rank', reverse: true });
    const entries = top.map((e, i) => ({
      rank: i + 1,
      username: e.member,
      height: Math.floor(e.score),
    }));

    const totalPlayers = await redis.zCard(lbKey);
    const userRank = await descendingRank(dateKey, username, totalPlayers);

    return c.json<LeaderboardResponse>({
      type: 'leaderboard',
      dateKey,
      entries,
      userRank,
      totalPlayers,
    });
  } catch (error) {
    console.error('API leaderboard error:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to load leaderboard' }, 400);
  }
});

