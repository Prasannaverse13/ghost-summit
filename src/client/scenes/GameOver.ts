import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { DAILY_MAX_ATTEMPTS, type LeaderboardResponse, type Outcome } from '../../shared/api';
import type { GameMode } from './Game';

interface GameOverData {
  outcome?: Outcome;
  height?: number; // this run's height/score
  rank?: number; // 1-based; 0 = unranked / unknown
  totalPlayers?: number;
  bestHeight?: number; // this user's BEST height today (across attempts)
  attemptsLeft?: number; // climbs remaining today
  noAttempts?: boolean; // came from the menu with 0 climbs left (no run this visit)
  mode?: GameMode; // difficulty, so "CLIMB AGAIN" relaunches the same way
}

// Per-outcome presentation: title, accent colour, and camera backdrop.
const OUTCOME_CONFIG: Record<Outcome, { title: string; color: string; bg: number }> = {
  win: { title: 'YOU REACHED THE SUMMIT', color: '#ffe08a', bg: 0x1f6f4a },
  caught: { title: 'THE GHOST CAUGHT YOU', color: '#e0a8ff', bg: 0x2a1030 },
  fell: { title: 'YOU FELL', color: '#ffffff', bg: 0x2a1a3a },
};

// "Out of climbs for today" presentation (not a failure state).
const OUT_OF_CLIMBS_CONFIG = { title: 'OUT OF CLIMBS TODAY', color: '#ffe08a', bg: 0x22304a };

export class GameOver extends Scene {
  camera!: Phaser.Cameras.Scene2D.Camera;
  background!: Phaser.GameObjects.Image;
  title_text!: Phaser.GameObjects.Text;
  sub_text!: Phaser.GameObjects.Text;
  height_text!: Phaser.GameObjects.Text;
  best_text!: Phaser.GameObjects.Text;
  hearts_text!: Phaser.GameObjects.Text;
  rank_text!: Phaser.GameObjects.Text;
  again_button!: Phaser.GameObjects.Text;
  lb_button!: Phaser.GameObjects.Text;
  prompt_text!: Phaser.GameObjects.Text;

  // Leaderboard view (built on demand).
  private lb_title: Phaser.GameObjects.Text | null = null;
  private lb_list: Phaser.GameObjects.Text | null = null;
  private lb_user: Phaser.GameObjects.Text | null = null;

  private outcome: Outcome = 'fell';
  private finalHeight = 0;
  private rank = 0;
  private totalPlayers = 0;
  private bestHeight = 0;
  private attemptsLeft = 0;
  private noAttempts = false;
  private mode: GameMode = 'easy';
  private showingLb = false;
  private lbRequested = false;

  constructor() {
    super('GameOver');
  }

  init(data: GameOverData) {
    this.outcome = data.outcome ?? 'fell';
    this.finalHeight = data.height ?? 0;
    this.rank = data.rank ?? 0;
    this.totalPlayers = data.totalPlayers ?? 0;
    this.bestHeight = data.bestHeight ?? this.finalHeight;
    this.attemptsLeft = Math.max(0, data.attemptsLeft ?? 0);
    this.noAttempts = data.noAttempts ?? false;
    this.mode = data.mode ?? 'easy';
    this.lb_title = null;
    this.lb_list = null;
    this.lb_user = null;
    this.showingLb = false;
    this.lbRequested = false;
  }

  create() {
    const cfg = this.noAttempts ? OUT_OF_CLIMBS_CONFIG : OUTCOME_CONFIG[this.outcome];
    const ranAClimb = !this.noAttempts; // did we actually play a run this visit?
    const canClimbAgain = ranAClimb && this.attemptsLeft > 0;

    this.camera = this.cameras.main;
    this.camera.setBackgroundColor(cfg.bg);

    this.background = this.add.image(0, 0, 'background').setOrigin(0).setAlpha(0.35);

    // Headline
    this.title_text = this.add
      .text(0, 0, cfg.title, {
        fontFamily: 'Arial Black',
        fontSize: '52px',
        color: cfg.color,
        stroke: '#000000',
        strokeThickness: 12,
        align: 'center',
      })
      .setOrigin(0.5);

    // "Come back tomorrow" — shown once no climbs remain.
    this.sub_text = this.add
      .text(0, 0, 'Come back tomorrow for a new summit.', {
        fontFamily: 'Arial',
        fontStyle: 'bold',
        fontSize: '28px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(this.attemptsLeft <= 0);

    // This run's height (only when we actually climbed this visit).
    this.height_text = this.add
      .text(0, 0, `Height: ${this.finalHeight}m`, {
        fontFamily: 'Arial Black',
        fontSize: '44px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 9,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(ranAClimb);

    // Best-of-day (always shown — it's what counts on the leaderboard).
    this.best_text = this.add
      .text(0, 0, `Best today: ${this.bestHeight}m`, {
        fontFamily: 'Arial Black',
        fontSize: '36px',
        color: '#ffe08a',
        stroke: '#000000',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5);

    // Lives as hearts: filled for climbs left, hollow for climbs used.
    this.hearts_text = this.add
      .text(0, 0, this.heartsString(this.attemptsLeft), {
        fontFamily: 'Arial',
        fontSize: '46px',
        color: '#ff7a7a',
        stroke: '#000000',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5);

    // Rank (only when we have one)
    this.rank_text = this.add
      .text(0, 0, this.rank > 0 ? `Rank ${this.rank} of ${this.totalPlayers}` : '', {
        fontFamily: 'Arial',
        fontStyle: 'bold',
        fontSize: '32px',
        color: '#ffe08a',
        stroke: '#000000',
        strokeThickness: 7,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(this.rank > 0);

    // Climb again (when climbs remain).
    this.again_button = this.add
      .text(0, 0, `CLIMB AGAIN (${this.attemptsLeft} left)`, {
        fontFamily: 'Arial Black',
        fontSize: '40px',
        color: '#ffd166',
        stroke: '#000000',
        strokeThickness: 10,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(canClimbAgain);
    if (canClimbAgain) {
      this.again_button.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.climbAgain());
      this.tweens.add({
        targets: this.again_button,
        alpha: { from: 1, to: 0.6 },
        duration: 750,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }

    // View-leaderboard button
    this.lb_button = this.add
      .text(0, 0, 'VIEW LEADERBOARD', {
        fontFamily: 'Arial Black',
        fontSize: '36px',
        color: '#a6e7ff',
        stroke: '#000000',
        strokeThickness: 10,
        align: 'center',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.showLeaderboard());

    // Return prompt
    this.prompt_text = this.add
      .text(0, 0, 'Tap to return', {
        fontFamily: 'Arial Black',
        fontSize: '32px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.returnToMenu());

    this.input.keyboard?.once('keydown-SPACE', () => this.returnToMenu());
    this.input.keyboard?.once('keydown-ENTER', () => this.returnToMenu());

    this.updateLayout(this.scale.width, this.scale.height);
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => this.updateLayout(gameSize.width, gameSize.height));
  }

  /** Builds the hearts string: filled ♥ for climbs left, hollow ♡ for used. */
  private heartsString(left: number): string {
    const l = Phaser.Math.Clamp(left, 0, DAILY_MAX_ATTEMPTS);
    return Array.from({ length: DAILY_MAX_ATTEMPTS }, (_, i) => (i < l ? '♥' : '♡')).join(' ');
  }

  /** Starts another climb this day with the same difficulty (fast retry — skips the intro). */
  private climbAgain(): void {
    this.scene.start('Game', { mode: this.mode });
  }

  private returnToMenu(): void {
    this.scene.start('MainMenu');
  }

  /** Fetches today's leaderboard and swaps the result view for a ranked list. */
  private async showLeaderboard(): Promise<void> {
    if (this.lbRequested) return;
    this.lbRequested = true;

    // Hide the result view.
    this.title_text.setVisible(false);
    this.sub_text.setVisible(false);
    this.height_text.setVisible(false);
    this.best_text.setVisible(false);
    this.hearts_text.setVisible(false);
    this.rank_text.setVisible(false);
    this.again_button.setVisible(false).disableInteractive();
    this.lb_button.setVisible(false).disableInteractive();

    let data: LeaderboardResponse | null = null;
    try {
      const res = await fetch('/api/leaderboard');
      if (res.ok) data = (await res.json()) as LeaderboardResponse;
    } catch {
      // ignore — show an empty-state message below
    }

    const lines =
      data && data.entries.length
        ? data.entries.map((e) => `${e.rank}.  ${e.username}  —  ${e.height}m`).join('\n')
        : 'No climbers yet today.\nBe the first!';
    const userLine = data && data.userRank > 0 ? `You: rank ${data.userRank} of ${data.totalPlayers}` : '';

    this.lb_title = this.add
      .text(0, 0, "TODAY'S TOP CLIMBERS", {
        fontFamily: 'Arial Black',
        fontSize: '38px',
        color: '#ffe08a',
        stroke: '#000000',
        strokeThickness: 9,
        align: 'center',
      })
      .setOrigin(0.5);
    this.lb_list = this.add
      .text(0, 0, lines, {
        fontFamily: 'Arial',
        fontStyle: 'bold',
        fontSize: '28px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 5,
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5);
    this.lb_user = this.add
      .text(0, 0, userLine, {
        fontFamily: 'Arial Black',
        fontSize: '28px',
        color: '#a6e7ff',
        stroke: '#000000',
        strokeThickness: 7,
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(userLine !== '');

    this.showingLb = true;
    this.updateLayout(this.scale.width, this.scale.height);
  }

  private updateLayout(width: number, height: number): void {
    // Resize camera viewport to prevent black bars
    this.cameras.resize(width, height);

    // Stretch background to fill entire screen
    this.background?.setDisplaySize(width, height);

    // Build the visible rows for the current view, then stack them (measured,
    // shrink-to-fit, centred) so nothing overlaps at any screen size.
    const rows: { obj: Phaser.GameObjects.Text; wrapFrac: number; gapBefore: number }[] = [];

    if (this.showingLb) {
      const t = this.lb_title;
      const l = this.lb_list;
      const u = this.lb_user;
      if (t) rows.push({ obj: t, wrapFrac: 0.92, gapBefore: 0 });
      if (l) rows.push({ obj: l, wrapFrac: 0.94, gapBefore: 0.03 });
      if (u && u.visible) rows.push({ obj: u, wrapFrac: 0.94, gapBefore: 0.025 });
      rows.push({ obj: this.prompt_text, wrapFrac: 0, gapBefore: 0.04 });
    } else {
      rows.push({ obj: this.title_text, wrapFrac: 0.92, gapBefore: 0 });
      if (!this.noAttempts) rows.push({ obj: this.height_text, wrapFrac: 0.92, gapBefore: 0.028 });
      rows.push({ obj: this.best_text, wrapFrac: 0.92, gapBefore: 0.02 });
      rows.push({ obj: this.hearts_text, wrapFrac: 0, gapBefore: 0.02 });
      if (this.rank > 0) rows.push({ obj: this.rank_text, wrapFrac: 0, gapBefore: 0.02 });
      if (!this.noAttempts && this.attemptsLeft > 0) {
        rows.push({ obj: this.again_button, wrapFrac: 0.92, gapBefore: 0.03 });
      } else if (this.attemptsLeft <= 0) {
        rows.push({ obj: this.sub_text, wrapFrac: 0.9, gapBefore: 0.03 });
      }
      rows.push({ obj: this.lb_button, wrapFrac: 0.92, gapBefore: 0.03 });
      rows.push({ obj: this.prompt_text, wrapFrac: 0, gapBefore: 0.035 });
    }

    this.stackRows(rows, width, height);
  }

  /**
   * Lays out single-column rows top-to-bottom with per-row gaps (as a fraction
   * of height): sets fonts + wrap, measures real heights, shrinks the whole
   * stack to fit the viewport if needed, then centres it. Returns the scale used.
   */
  private stackRows(
    rows: { obj: Phaser.GameObjects.Text; wrapFrac: number; gapBefore: number }[],
    width: number,
    height: number
  ): number {
    const sTarget = Math.max(0.6, Math.min(Math.min(width / 1024, height / 768), 1));
    if (rows.length === 0) return sTarget;

    const apply = (s: number) => {
      for (const r of rows) {
        r.obj.setScale(s);
        if (r.wrapFrac > 0) r.obj.setWordWrapWidth((width * r.wrapFrac) / s);
      }
    };
    apply(sTarget);

    const gaps = rows.map((r) => r.gapBefore * height);
    const sumGaps = gaps.reduce((a, g) => a + g, 0);
    let sumH = rows.reduce((a, r) => a + r.obj.displayHeight, 0);

    const availH = height * 0.94;
    let finalScale = sTarget;
    if (sumH + sumGaps > availH) {
      finalScale = sTarget * Math.max(0.35, (availH - sumGaps) / sumH);
      apply(finalScale);
      sumH = rows.reduce((a, r) => a + r.obj.displayHeight, 0);
    }

    const cx = width / 2;
    let y = Math.max(height * 0.03, (height - (sumH + sumGaps)) / 2);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      y += gaps[i] ?? 0;
      const h = r.obj.displayHeight;
      r.obj.setPosition(cx, y + h / 2);
      y += h;
    }
    return finalScale;
  }
}
