import { redis } from '@devvit/web/server';
import type { DailyChampion } from '../../shared/api';

/**
 * Shared daily-challenge helpers used by both the API routes and the scheduler,
 * so the date keys + leaderboard key format never diverge between them.
 */

/** A date as a UTC "YYYY-MM-DD" key, so the daily reset is global. */
export function utcDateKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The UTC day before today, as a "YYYY-MM-DD" key. */
export function yesterdayDateKey(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDateKey(d);
}

/** Redis sorted-set of the day's scores: member = username, score = best height. */
export const leaderboardKey = (dateKey: string) => `leaderboard:${dateKey}`;

/**
 * The top climber for a given day (highest score), or null if nobody played.
 * Reads the single highest-ranked entry from that day's leaderboard zset.
 */
export async function getDailyChampion(dateKey: string): Promise<DailyChampion | null> {
  const top = await redis.zRange(leaderboardKey(dateKey), 0, 0, { by: 'rank', reverse: true });
  const entry = top[0];
  if (!entry) return null;
  return { username: entry.member, height: Math.max(0, Math.floor(entry.score)) };
}
