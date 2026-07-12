import { Scene, GameObjects } from 'phaser';
import { DAILY_MAX_ATTEMPTS, type DailyChampion, type DailyStatusResponse } from '../../shared/api';
import type { GameMode } from './Game';

/**
 * Ghost Summit - Title Screen
 * Shows the game title, a one-line hook, an Easy/Hard selector, and a
 * "TAP TO CLIMB" prompt. Starts the Game scene (passing the chosen mode) on
 * tapping the prompt / Space / Enter.
 *
 * The backdrop is drawn with graphics (no image assets) so it stays visually
 * consistent with the climbing scene and has no external asset dependencies.
 */

// Palette shared with the climbing scene (see Game.ts). Text colours are kept
// high-contrast (bright white body, bright gold CTA) so they read clearly on a
// phone; strokes are added at each text below for punch against the backdrop.
const COLOR_BG = 0x1a1c2c;
const COLOR_TITLE = '#ffcd75';
const COLOR_TEXT = '#ffffff'; // body text — bright white for mobile contrast
const COLOR_PROMPT = '#ffd166'; // CTA — bright gold so it clearly reads as tappable
const COLOR_DIM = '#aeb8e6'; // unselected difficulty button (still clearly legible)

export class MainMenu extends Scene {
  private backdrop: GameObjects.Graphics | null = null;
  private title: GameObjects.Text | null = null;
  private tagline: GameObjects.Text | null = null;
  private easyBtn: GameObjects.Text | null = null;
  private hardBtn: GameObjects.Text | null = null;
  private prompt: GameObjects.Text | null = null;
  private climbsInfo: GameObjects.Text | null = null;
  private hearts: GameObjects.Text | null = null;
  private livesLine: GameObjects.Text | null = null;
  private championLine: GameObjects.Text | null = null;

  private selectedMode: GameMode = 'easy';
  private attemptsLeft = DAILY_MAX_ATTEMPTS; // climbs remaining today (from /api/daily-status)
  private champion: DailyChampion | null = null; // yesterday's top climber (from /api/daily-status)

  constructor() {
    super('MainMenu');
  }

  /**
   * Reset cached GameObject references every time the scene starts.
   * The same Scene instance is reused by Phaser, so we must ensure
   * stale (destroyed) objects are cleared out when the scene restarts.
   */
  init(): void {
    this.backdrop = null;
    this.title = null;
    this.tagline = null;
    this.easyBtn = null;
    this.hardBtn = null;
    this.prompt = null;
    this.climbsInfo = null;
    this.hearts = null;
    this.livesLine = null;
    this.championLine = null;
    this.selectedMode = 'easy'; // default to Easy
    this.attemptsLeft = DAILY_MAX_ATTEMPTS; // assume full until the daily status loads
    this.champion = null;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR_BG);

    this.refreshLayout();

    // Re-calculate positions whenever the game canvas is resized (e.g. orientation change).
    this.scale.on('resize', () => this.refreshLayout());

    // Gentle pulse so the prompt reads as interactive.
    if (this.prompt) {
      this.tweens.add({
        targets: this.prompt,
        alpha: { from: 1, to: 0.6 }, // dim only slightly so it stays readable
        duration: 750,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }

    // Start the climb by tapping the prompt or via keyboard for desktop play.
    // (The difficulty buttons handle their own taps to select a mode.)
    this.prompt?.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.startClimb());
    this.input.keyboard?.once('keydown-SPACE', () => this.startClimb());
    this.input.keyboard?.once('keydown-ENTER', () => this.startClimb());

    // Load today's climbs-remaining and reflect it in the hearts / lives line.
    void this.fetchDaily();
  }

  private selectMode(mode: GameMode): void {
    this.selectedMode = mode;
    this.updateModeVisual();
  }

  /** Fetches today's climbs-remaining; falls back to a full set if offline. */
  private async fetchDaily(): Promise<void> {
    try {
      const res = await fetch('/api/daily-status');
      if (res.ok) {
        const s = (await res.json()) as DailyStatusResponse;
        this.attemptsLeft = Math.max(0, s.attemptsLeft);
        this.champion = s.champion ?? null;
      }
    } catch {
      // offline / local dev — keep the default full set
    }
    // Re-run the full layout so the stack re-measures with the final lives text
    // (its wrapped height can differ from the placeholder) — avoids any overlap.
    this.refreshLayout();
  }

  /** Filled ♥ for climbs left, hollow ♡ for climbs used. */
  private heartsString(left: number): string {
    const l = Math.max(0, Math.min(DAILY_MAX_ATTEMPTS, left));
    return Array.from({ length: DAILY_MAX_ATTEMPTS }, (_, i) => (i < l ? '♥' : '♡')).join(' ');
  }

  /** Syncs the hearts + lives caption to the current attemptsLeft. */
  private updateLivesVisual(): void {
    this.hearts?.setText(this.heartsString(this.attemptsLeft));
    if (this.livesLine) {
      const n = this.attemptsLeft;
      this.livesLine.setText(n <= 0 ? 'No climbs left — come back tomorrow' : `${n} climb${n === 1 ? '' : 's'} left today`);
      this.livesLine.setColor(n <= 0 ? '#ff9d9d' : '#ffffff');
    }
  }

  /** Highlights the currently-selected difficulty button. */
  private updateModeVisual(): void {
    if (this.easyBtn) {
      const sel = this.selectedMode === 'easy';
      this.easyBtn.setColor(sel ? COLOR_TITLE : COLOR_DIM).setAlpha(sel ? 1 : 0.9);
    }
    if (this.hardBtn) {
      const sel = this.selectedMode === 'hard';
      this.hardBtn.setColor(sel ? COLOR_TITLE : COLOR_DIM).setAlpha(sel ? 1 : 0.9);
    }
  }

  private startClimb(): void {
    // Play the comic intro first; it forwards the mode straight through to Game.
    this.scene.start('Intro', { mode: this.selectedMode });
  }

  /**
   * Positions and (lightly) scales all UI elements based on the current game size.
   * Call this from create() and from any resize events.
   */
  private refreshLayout(): void {
    const { width, height } = this.scale;

    // Resize camera to new viewport to prevent black bars.
    this.cameras.resize(width, height);

    // Backdrop – a subtle vertical gradient evoking a mountain at dusk.
    if (!this.backdrop) {
      this.backdrop = this.add.graphics();
    }
    this.backdrop.clear();
    this.backdrop.fillGradientStyle(0x0d0e17, 0x0d0e17, COLOR_BG, COLOR_BG, 1);
    this.backdrop.fillRect(0, 0, width, height);

    // --- Create the elements once (moderate fonts; positioned by the stack below) ---
    const title =
      this.title ??
      (this.title = this.add
        .text(0, 0, 'GHOST SUMMIT', {
          fontFamily: 'Arial Black',
          fontSize: '68px',
          color: COLOR_TITLE,
          stroke: '#000000',
          strokeThickness: 10,
          align: 'center',
        })
        .setOrigin(0.5));

    const tagline =
      this.tagline ??
      (this.tagline = this.add
        .text(0, 0, 'Race the ghosts of everyone who reached for the summit before you.', {
          fontFamily: 'Arial',
          fontStyle: 'bold',
          fontSize: '24px',
          color: COLOR_TEXT,
          stroke: '#000000',
          strokeThickness: 6,
          align: 'center',
          lineSpacing: 4,
        })
        .setOrigin(0.5));

    const climbsInfo =
      this.climbsInfo ??
      (this.climbsInfo = this.add
        .text(0, 0, 'Three climbs a day · best score counts', {
          fontFamily: 'Arial',
          fontStyle: 'bold',
          fontSize: '22px',
          color: '#ffe08a',
          stroke: '#000000',
          strokeThickness: 5,
          align: 'center',
        })
        .setOrigin(0.5));

    const hearts =
      this.hearts ??
      (this.hearts = this.add
        .text(0, 0, this.heartsString(this.attemptsLeft), {
          fontFamily: 'Arial',
          fontSize: '40px',
          color: '#ff7a7a',
          stroke: '#000000',
          strokeThickness: 6,
          align: 'center',
        })
        .setOrigin(0.5));

    const livesLine =
      this.livesLine ??
      (this.livesLine = this.add
        .text(0, 0, '', {
          fontFamily: 'Arial',
          fontStyle: 'bold',
          fontSize: '22px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 5,
          align: 'center',
        })
        .setOrigin(0.5));

    const easyBtn =
      this.easyBtn ??
      (this.easyBtn = this.add
        .text(0, 0, 'EASY', {
          fontFamily: 'Arial Black',
          fontSize: '40px',
          color: COLOR_TITLE,
          stroke: '#000000',
          strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.selectMode('easy')));

    const hardBtn =
      this.hardBtn ??
      (this.hardBtn = this.add
        .text(0, 0, 'HARD', {
          fontFamily: 'Arial Black',
          fontSize: '40px',
          color: COLOR_DIM,
          stroke: '#000000',
          strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.selectMode('hard')));

    const prompt =
      this.prompt ??
      (this.prompt = this.add
        .text(0, 0, 'TAP TO CLIMB', {
          fontFamily: 'Arial Black',
          fontSize: '46px',
          color: COLOR_PROMPT,
          stroke: '#000000',
          strokeThickness: 8,
          align: 'center',
        })
        .setOrigin(0.5));

    // Yesterday's champion (shown only when there is one).
    const championLine =
      this.championLine ??
      (this.championLine = this.add
        .text(0, 0, '', {
          fontFamily: 'Arial',
          fontStyle: 'bold',
          fontSize: '20px',
          color: '#ffd166',
          stroke: '#000000',
          strokeThickness: 5,
          align: 'center',
        })
        .setOrigin(0.5));
    if (this.champion) {
      championLine.setText(`👑 Yesterday: u/${this.champion.username} — ${this.champion.height}m`);
    }

    this.updateModeVisual();
    this.updateLivesVisual();

    // --- Measured vertical stack ---
    // Set fonts + wrap, measure real heights, place top-to-bottom with gaps,
    // shrink-to-fit if the stack is taller than the viewport, then centre it.
    // This guarantees NO overlap at any size and spreads elements down-screen.
    const rows: { objs: GameObjects.Text[]; wrapFrac: number; gapBefore: number }[] = [
      { objs: [title], wrapFrac: 0.92, gapBefore: 0 },
      { objs: [tagline], wrapFrac: 0.9, gapBefore: 0.03 },
      { objs: [climbsInfo], wrapFrac: 0.9, gapBefore: 0.02 },
      // Champion line appears just under the rules, only when we have one.
      ...(this.champion ? [{ objs: [championLine], wrapFrac: 0.9, gapBefore: 0.014 }] : []),
      { objs: [hearts], wrapFrac: 0, gapBefore: 0.022 },
      { objs: [livesLine], wrapFrac: 0.9, gapBefore: 0.012 },
      { objs: [easyBtn, hardBtn], wrapFrac: 0, gapBefore: 0.035 },
      { objs: [prompt], wrapFrac: 0, gapBefore: 0.05 },
    ];

    const sTarget = Math.max(0.6, Math.min(Math.min(width / 1024, height / 768), 1));
    const applyScale = (s: number) => {
      for (const r of rows) {
        for (const o of r.objs) {
          o.setScale(s);
          if (r.wrapFrac > 0) o.setWordWrapWidth((width * r.wrapFrac) / s);
        }
      }
    };
    const rowHeight = (r: { objs: GameObjects.Text[] }) => Math.max(...r.objs.map((o) => o.displayHeight));

    applyScale(sTarget);
    const gaps = rows.map((r) => r.gapBefore * height);
    const sumGaps = gaps.reduce((a, g) => a + g, 0);
    let sumH = rows.reduce((a, r) => a + rowHeight(r), 0);

    const availH = height * 0.94;
    let finalScale = sTarget;
    if (sumH + sumGaps > availH) {
      finalScale = sTarget * Math.max(0.35, (availH - sumGaps) / sumH);
      applyScale(finalScale);
      sumH = rows.reduce((a, r) => a + rowHeight(r), 0);
    }

    const cx = width / 2;
    const btnGap = 120 * finalScale;
    let y = Math.max(height * 0.03, (height - (sumH + sumGaps)) / 2);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      y += gaps[i] ?? 0;
      const h = rowHeight(r);
      const cyRow = y + h / 2;
      const [a, b] = r.objs;
      if (a && b) {
        a.setPosition(cx - btnGap, cyRow);
        b.setPosition(cx + btnGap, cyRow);
      } else if (a) {
        a.setPosition(cx, cyRow);
      }
      y += h;
    }
  }
}
