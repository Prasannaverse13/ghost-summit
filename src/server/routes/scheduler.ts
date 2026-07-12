import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import { createPost } from '../core/post';
import { getDailyChampion, yesterdayDateKey } from '../core/daily';

/**
 * Scheduled (cron) tasks. Registered in devvit.json under `scheduler.tasks`;
 * the platform POSTs the mapped endpoint on the cron schedule. Endpoints receive
 * a JSON body ({ name, data }) and must respond with JSON.
 */
export const scheduler = new Hono();

// POST /internal/scheduler/daily-post
// Fired daily (see devvit.json `scheduler.tasks.daily-post`, cron "5 0 * * *" =
// 00:05 UTC, just after the daily seed rolls over). Creates that day's Ghost
// Summit post so a fresh climb appears in feeds automatically, then celebrates
// yesterday's top climber with a pinned first comment.
scheduler.post('/daily-post', async (c) => {
  try {
    const post = await createPost();

    // Community recognition: crown yesterday's champion in a pinned first
    // comment. Best-effort — a missing champion or any failure here must never
    // block the daily post from going up.
    try {
      const champion = await getDailyChampion(yesterdayDateKey());
      if (champion) {
        const comment = await reddit.submitComment({
          id: post.id,
          text: `👑 Yesterday's champion: u/${champion.username} reached ${champion.height}m! Can you beat it today?`,
          runAs: 'APP',
        });
        // Pin it to the top so it greets everyone who opens the post.
        await comment.distinguish(true);
      }
    } catch (error) {
      console.error(`Failed to post champion comment: ${error}`);
    }
  } catch (error) {
    console.error(`Error creating daily post: ${error}`);
  }
  // The platform expects a JSON body back; the shape is intentionally empty.
  return c.json({}, 200);
});
