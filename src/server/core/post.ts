import { reddit } from '@devvit/web/server';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Human-readable UTC title for the day, e.g. "Ghost Summit — July 12, 2026
 * Daily Climb". UTC is used so it lines up with the daily seed, which rolls over
 * at UTC midnight (see utcDateKey in routes/api.ts). Built manually (no Intl) so
 * it's deterministic across runtimes.
 */
export const dailyPostTitle = (date: Date = new Date()): string => {
  const month = MONTHS[date.getUTCMonth()] ?? '';
  return `Ghost Summit — ${month} ${date.getUTCDate()}, ${date.getUTCFullYear()} Daily Climb`;
};

/**
 * Creates a new Ghost Summit post. The post carries no seed — the client fetches
 * /api/daily-status, which derives today's seed from the current UTC date — so
 * whichever day a post is opened, it shows that day's mountain.
 */
export const createPost = async (title: string = dailyPostTitle()) => {
  return await reddit.submitCustomPost({
    title,
  });
};
