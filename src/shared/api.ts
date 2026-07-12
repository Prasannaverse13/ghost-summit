export type InitResponse = {
  type: "init";
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: "increment";
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: "decrement";
  postId: string;
  count: number;
};

// --- Daily challenge (Phase 2) ---

/** Climbs (lives) each player gets per day. Best height of the day counts. */
export const DAILY_MAX_ATTEMPTS = 3;

/** How a run ended. Shared by the client scenes and the run-submission API. */
export type Outcome = "win" | "caught" | "fell";

/** The top climber of a given day. */
export type DailyChampion = { username: string; height: number };

/** GET /api/daily-status — today's seed + how many of the day's climbs remain. */
export type DailyStatusResponse = {
  type: "daily-status";
  dateKey: string; // UTC "YYYY-MM-DD"
  seed: number; // deterministic per dateKey; drives the level + background
  attemptsUsed: number; // climbs taken today (0..attemptsMax)
  attemptsMax: number; // DAILY_MAX_ATTEMPTS
  attemptsLeft: number; // max(0, attemptsMax - attemptsUsed)
  bestHeight: number; // this user's BEST height today (0 if none yet)
  bestOutcome: Outcome | null; // outcome of that best run
  champion: DailyChampion | null; // yesterday's top climber (null if none)
};

/** POST /api/submit-run body. */
export type SubmitRunRequest = {
  height: number;
  outcome: Outcome;
};

/** POST /api/submit-run response. */
export type SubmitRunResponse = {
  type: "submit-run";
  accepted: boolean; // false => no climbs were left, so this run was not counted
  attemptsUsed: number; // climbs taken today after this submission
  attemptsLeft: number; // climbs remaining today
  rank: number; // 1-based, highest height = rank 1 (0 if unranked)
  bestHeight: number; // this user's BEST height today (across all attempts)
  bestOutcome: Outcome | null;
  totalPlayers: number;
};

export type LeaderboardEntry = {
  rank: number; // 1-based
  username: string;
  height: number;
};

/** GET /api/leaderboard response. */
export type LeaderboardResponse = {
  type: "leaderboard";
  dateKey: string;
  entries: LeaderboardEntry[]; // today's top 10, highest first
  userRank: number; // this user's 1-based rank (0 if not played)
  totalPlayers: number;
};

