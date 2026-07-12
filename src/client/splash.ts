import { requestExpandedMode } from '@devvit/web/client';

/**
 * Ghost Summit inline (feed) splash. Kept intentionally tiny — no Phaser, no
 * heavy deps — so the card renders instantly. Its only job is to launch the
 * expanded 'game' view (see the `game` entrypoint in devvit.json).
 *
 * The whole card is a single launch surface: a tap anywhere (including the CTA
 * button, whose click bubbles up) expands into the game. One handler keeps the
 * user-gesture -> requestExpandedMode call from firing twice.
 */
const app = document.getElementById('app');

app?.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});
