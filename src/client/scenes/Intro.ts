import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { GameMode } from './Game';

/**
 * Ghost Summit — animated comic-style intro.
 * A short (~7s) motion-comic that plays after the menu's "TAP TO CLIMB" and
 * before the Game scene. Three beats — darkness, the rising threat, the goal —
 * built entirely from EXISTING assets (adventurer sprite, the drawn menacing
 * ghost, Kenney backdrops) with tweened, eased motion and typewriter captions.
 *
 * It is fully skippable (tap / click / Space / Enter / Esc) and always forwards
 * the chosen difficulty mode straight through to Game. It never touches
 * gameplay, the daily seed, or the leaderboard.
 */

// --- Beat timing (ms from scene start) — tune the pacing here ---
const BEAT_THREAT = 2400; // the ghost begins rising
const BEAT_GOAL = 4800; // the summit light begins growing
const BEAT_END = 7000; // the exit fade begins
const FADE_OUT_MS = 550;

// --- Caption feel ---
const CAPTION_Y_FRAC = 0.16; // captions sit near the top (classic comic caption bar)
const CAPTION_SLIDE = 30; // px slide-up on entry
const CAPTION_TYPE_MS = 750; // typewriter duration (scaled down for long lines below)

// --- Audio ---
const MUTE_STORAGE_KEY = 'gs_muted'; // must match Game.ts
const INTRO_MUSIC_BASE = 0.1; // faint bed under the intro
const INTRO_MUSIC_SWELL = 0.18; // rises as the ghost appears

type IntroData = { mode?: GameMode };

export class Intro extends Scene {
  private mode: GameMode = 'easy';
  private leaving = false;

  private music: Phaser.Sound.NoAudioSound | Phaser.Sound.HTML5AudioSound | Phaser.Sound.WebAudioSound | undefined =
    undefined;

  // Persistent visuals (repositioned on resize).
  private bgSky!: Phaser.GameObjects.TileSprite;
  private bgHills!: Phaser.GameObjects.TileSprite;
  private vignette!: Phaser.GameObjects.Image;
  private summitGlow!: Phaser.GameObjects.Image;
  private adventurer!: Phaser.GameObjects.Sprite;
  private ghost: Phaser.GameObjects.Container | null = null;
  private frame!: Phaser.GameObjects.Graphics;
  private letterbox!: Phaser.GameObjects.Graphics;
  private skip!: Phaser.GameObjects.Text;

  constructor() {
    super('Intro');
  }

  init(data: IntroData) {
    this.mode = data?.mode === 'hard' ? 'hard' : 'easy';
    this.leaving = false;
    this.ghost = null;
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(0x05060a);
    this.cameras.main.fadeIn(400, 0, 0, 0);

    // Apply the saved mute preference (shared with Game) before any audio.
    this.sound.mute = this.loadMute();

    // Ensure the shared drawn-ghost textures exist (identical to Game's, so it
    // reuses them — the calls below are no-ops once made).
    this.makeGhostTexture('ghost_body', true);
    this.makeRadialTexture('ghost_glow', 220, '190,215,255', 0.12);
    this.makeRadialTexture('intro_summit_glow', 512, '255,224,150', 0.0);
    this.makeVignetteTexture('intro_vignette');

    // --- Backdrop (dark night sky + hill silhouette) ---
    this.bgSky = this.add.tileSprite(width / 2, height / 2, width, height, 'bg_sky').setDepth(-20).setAlpha(0.5);
    this.bgSky.setTint(0x1a2038);
    this.bgHills = this.add
      .tileSprite(width / 2, height, width, 300, 'bg_hills')
      .setOrigin(0.5, 1)
      .setDepth(-10)
      .setTint(0x11162a);

    // --- Summit light (grows in the final beat) ---
    this.summitGlow = this.add
      .image(width / 2, height * 0.12, 'intro_summit_glow')
      .setDepth(60)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setScale(0.2);

    // --- The adventurer, at the bottom of the dark ---
    this.adventurer = this.add
      .sprite(width / 2, height * 0.82, 'char_idle')
      .setScale(1.0)
      .setDepth(10)
      .setAlpha(0);

    // --- Heavy vignette over everything (lifts in the final beat) ---
    this.vignette = this.add.image(width / 2, height / 2, 'intro_vignette').setDepth(50).setAlpha(0.95);

    // --- Comic panel framing (letterbox bars + inset border) ---
    this.letterbox = this.add.graphics().setDepth(100);
    this.frame = this.add.graphics().setDepth(101);

    // --- Skip prompt (bottom-right) ---
    this.skip = this.add
      .text(width - 22, height - 20, 'tap to skip ▸', {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: '#c7cde8',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(1, 1)
      .setDepth(130);
    this.tweens.add({
      targets: this.skip,
      alpha: { from: 1, to: 0.4 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    this.refreshStaticLayout();
    this.scale.on('resize', this.refreshStaticLayout, this);

    // --- Skip: any tap / click / Space / Enter / Esc ---
    this.input.on('pointerdown', () => this.goToGame());
    this.input.keyboard?.on('keydown-SPACE', () => this.goToGame());
    this.input.keyboard?.on('keydown-ENTER', () => this.goToGame());
    this.input.keyboard?.on('keydown-ESC', () => this.goToGame());

    // --- Faint music bed, swelling as the ghost appears ---
    this.music = this.sound.add('music_horror', { loop: true, volume: 0 });
    this.music.play();
    this.tweens.add({ targets: this.music, volume: INTRO_MUSIC_BASE, duration: 1200, delay: 200 });

    // Clean up the resize listener + music when the scene ends.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.refreshStaticLayout, this);
      this.music?.destroy();
      this.music = undefined;
    });

    this.runSequence();
  }

  /** Schedules the full beat sequence. Every callback is cancelled on shutdown. */
  private runSequence() {
    const { height } = this.scale;

    // Beat 1 — DARKNESS.
    this.tweens.add({ targets: this.adventurer, alpha: 1, duration: 600, delay: 200, ease: 'Quad.easeOut' });
    this.tweens.add({
      targets: this.adventurer,
      y: this.adventurer.y - 6,
      duration: 1100,
      delay: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.showCaption('Trapped in the endless dark...', 500, 500);

    // Beat 2 — THE THREAT (ghost rises from below).
    this.time.delayedCall(BEAT_THREAT, () => this.spawnRisingGhost());
    // The hero recoils: swap to the jump/alarm frame and a scared hop.
    this.time.delayedCall(BEAT_THREAT + 150, () => {
      if (this.leaving) return;
      this.adventurer.setTexture('char_jump');
      this.tweens.add({
        targets: this.adventurer,
        y: this.adventurer.y - 22,
        duration: 260,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    });
    this.tweens.add({ targets: this.music, volume: INTRO_MUSIC_SWELL, duration: 1200, delay: BEAT_THREAT });
    this.showCaption('...something is rising from below.', BEAT_THREAT + 250, 600);

    // Beat 3 — THE GOAL (light grows, the dark lifts, the hero looks up).
    this.time.delayedCall(BEAT_GOAL, () => {
      if (this.leaving) return;
      this.summitGlow.setPosition(this.scale.width / 2, this.scale.height * 0.12);
      this.tweens.add({ targets: this.summitGlow, scale: 2.4, alpha: 0.85, duration: 1600, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: this.vignette, alpha: 0.3, duration: 1600, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: this.bgSky, alpha: 0.85, duration: 1600, ease: 'Sine.easeOut' });
      // Hero looks up: settle to the idle frame, stretch up and rise a touch.
      this.adventurer.setTexture('char_idle');
      this.tweens.add({
        targets: this.adventurer,
        scaleY: 1.07,
        y: height * 0.79,
        duration: 900,
        ease: 'Sine.easeOut',
      });
    });
    this.showCaption('Climb toward the light. Shoot what hunts you. Escape before it takes you.', BEAT_GOAL + 200, 0, false);

    // Exit — fade to black, then hand off to Game.
    this.time.delayedCall(BEAT_END, () => {
      if (this.leaving) return;
      this.cameras.main.fadeOut(FADE_OUT_MS, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.goToGame());
    });
  }

  /** Builds the menacing ghost below the view and rises it into frame, behind the hero. */
  private spawnRisingGhost() {
    if (this.leaving) return;
    const { width, height } = this.scale;

    const container = this.add.container(width / 2, height + 170).setScale(0.9).setDepth(8);
    const inner = this.add.container(0, 0);
    const glow = this.add.image(0, 0, 'ghost_glow').setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    const body = this.add.image(0, 0, 'ghost_body').setAlpha(0.9);
    inner.add([glow, body]);
    container.add(inner);
    this.ghost = container;

    // Rise with a slight overshoot, glow blooming in.
    this.tweens.add({ targets: container, y: height * 0.6, duration: 1500, ease: 'Back.easeOut' });
    this.tweens.add({ targets: glow, alpha: 0.7, duration: 1200, ease: 'Quad.easeOut' });
    // Ominous squash wobble.
    this.tweens.add({
      targets: inner,
      scaleX: { from: 1, to: 1.08 },
      scaleY: { from: 1, to: 0.92 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  /**
   * Shows a comic caption: a bordered box that slides up + fades in, with the
   * text revealed by a typewriter. If `autoOut` it fades away after `holdMs`
   * (otherwise it lingers until the exit fade — used for the final line).
   */
  private showCaption(full: string, startDelay: number, holdMs: number, autoOut = true) {
    this.time.delayedCall(startDelay, () => {
      if (this.leaving) return;
      const { width, height } = this.scale;
      const y = height * CAPTION_Y_FRAC;

      // Responsive so the full text always fits (mobile especially): the font
      // scales down on narrow screens, and the wrap width + box padding are kept
      // within the viewport so nothing is ever clipped.
      const pad = 16;
      const fontPx = Phaser.Math.Clamp(Math.round(width / 20), 15, 30);
      const wrapW = Math.min(width * 0.8, 600);

      const text = this.add
        .text(width / 2, y, full, {
          fontFamily: 'Arial Black',
          fontSize: `${fontPx}px`,
          color: '#ffffff',
          align: 'center',
          stroke: '#000000',
          strokeThickness: 3,
          wordWrap: { width: wrapW },
        })
        .setOrigin(0.5)
        .setDepth(120);

      // Size the caption box to the (wrapped) text, then a translucent panel behind.
      const b = text.getBounds();
      const box = this.add.graphics().setDepth(119);
      box.fillStyle(0x000000, 0.55);
      box.fillRoundedRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2, 12);
      box.lineStyle(3, 0xffffff, 0.85);
      box.strokeRoundedRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2, 12);

      // Slide up + fade in together.
      text.y += CAPTION_SLIDE;
      box.y += CAPTION_SLIDE;
      text.setAlpha(0);
      box.setAlpha(0);
      this.tweens.add({ targets: [text, box], y: `-=${CAPTION_SLIDE}`, alpha: 1, duration: 350, ease: 'Back.easeOut' });

      // Typewriter the text in (box stays put).
      const typeDur = full.length > 40 ? CAPTION_TYPE_MS * 1.7 : CAPTION_TYPE_MS;
      this.typewrite(text, full, 380, typeDur);

      if (autoOut) {
        this.time.delayedCall(380 + typeDur + holdMs, () => {
          this.tweens.add({
            targets: [text, box],
            alpha: 0,
            y: `-=20`,
            duration: 300,
            ease: 'Sine.easeIn',
            onComplete: () => {
              text.destroy();
              box.destroy();
            },
          });
        });
      }
    });
  }

  /** Reveals `full` one character at a time over `durMs`, starting after `delayMs`. */
  private typewrite(target: Phaser.GameObjects.Text, full: string, delayMs: number, durMs: number) {
    target.setText('');
    const steps = full.length;
    if (steps === 0) return;
    const interval = Math.max(16, durMs / steps);
    this.time.delayedCall(delayMs, () => {
      let i = 0;
      this.time.addEvent({
        delay: interval,
        repeat: steps - 1,
        callback: () => {
          i++;
          target.setText(full.slice(0, i));
        },
      });
    });
  }

  /** Hands off to the Game scene (once), passing the chosen mode straight through. */
  private goToGame() {
    if (this.leaving) return;
    this.leaving = true;
    this.music?.stop();
    this.scene.start('Game', { mode: this.mode });
  }

  /** Positions/sizes the persistent visuals; called on create and on resize. */
  private refreshStaticLayout() {
    const { width, height } = this.scale;
    this.cameras.resize(width, height);

    this.bgSky.setPosition(width / 2, height / 2).setSize(width, height);
    this.bgHills.setPosition(width / 2, height).setSize(width, 300);
    this.summitGlow.setPosition(width / 2, height * 0.12);
    if (this.adventurer && !this.leaving) this.adventurer.x = width / 2;
    if (this.ghost) this.ghost.x = width / 2;

    // Vignette: a circle large enough to cover the whole viewport (dark edges).
    const cover = Math.hypot(width, height);
    this.vignette.setPosition(width / 2, height / 2).setDisplaySize(cover, cover);

    this.skip.setPosition(width - 22, height - 20);

    // Letterbox bars + inset comic-panel border.
    const bar = Math.round(height * 0.06);
    this.letterbox.clear();
    this.letterbox.fillStyle(0x000000, 1);
    this.letterbox.fillRect(0, 0, width, bar);
    this.letterbox.fillRect(0, height - bar, width, bar);

    const m = 14;
    this.frame.clear();
    this.frame.lineStyle(3, 0xffffff, 0.25);
    this.frame.strokeRect(m, bar + m, width - m * 2, height - bar * 2 - m * 2);
  }

  // --- Drawing helpers (copied from Game.ts so the ghost is pixel-identical; ---
  // --- all guarded by texture existence, so they are shared, not duplicated) ---

  /** Reads the saved mute preference (best-effort; defaults to unmuted). */
  private loadMute(): boolean {
    try {
      return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private makeGhostTexture(key: string, menacing: boolean) {
    if (this.textures.exists(key)) return;
    const texW = 124;
    const texH = 152;
    const pad = 10;
    const left = pad;
    const right = texW - pad;
    const w = right - left;
    const cx = texW / 2;
    const r = w / 2;
    const domeCY = pad + r;
    const humps = 4;
    const humpR = w / (2 * humps);
    const bottomY = texH - pad - humpR;

    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(left, domeCY);
    g.arc(cx, domeCY, r, Math.PI, Math.PI * 2, false);
    g.lineTo(right, bottomY);
    for (let i = 0; i < humps; i++) {
      const hcx = right - humpR - i * 2 * humpR;
      g.arc(hcx, bottomY, humpR, 0, Math.PI, false);
    }
    g.lineTo(left, domeCY);
    g.closePath();
    g.fillPath();

    const eyeY = domeCY + 4;
    const eyeDX = 21;
    if (menacing) {
      g.fillStyle(0x0b0c1a, 1);
      this.fillRotRect(g, cx - eyeDX, eyeY, 30, 15, 0.5);
      this.fillRotRect(g, cx + eyeDX, eyeY, 30, 15, -0.5);
    } else {
      g.fillStyle(0x3a4a6a, 1);
      g.fillCircle(cx - eyeDX, eyeY, 6);
      g.fillCircle(cx + eyeDX, eyeY, 6);
    }

    g.generateTexture(key, texW, texH);
    g.destroy();
  }

  private fillRotRect(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, ang: number) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const hw = w / 2;
    const hh = h / 2;
    g.beginPath();
    g.moveTo(cx - hw * c + hh * s, cy - hw * s - hh * c);
    g.lineTo(cx + hw * c + hh * s, cy + hw * s - hh * c);
    g.lineTo(cx + hw * c - hh * s, cy + hw * s + hh * c);
    g.lineTo(cx - hw * c - hh * s, cy - hw * s + hh * c);
    g.closePath();
    g.fillPath();
  }

  private makeRadialTexture(key: string, diameter: number, rgb: string, innerStop: number) {
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, diameter, diameter);
    if (!tex) return;
    const ctx = tex.getContext();
    const r = diameter / 2;
    const grd = ctx.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, `rgba(${rgb},1)`);
    grd.addColorStop(innerStop, `rgba(${rgb},1)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, diameter, diameter);
    tex.refresh();
  }

  /** Builds a heavy-vignette texture: transparent core fading to opaque dark edges. */
  private makeVignetteTexture(key: string) {
    if (this.textures.exists(key)) return;
    const d = 512;
    const tex = this.textures.createCanvas(key, d, d);
    if (!tex) return;
    const ctx = tex.getContext();
    const r = d / 2;
    const grd = ctx.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(5,6,10,0)');
    grd.addColorStop(0.55, 'rgba(5,6,10,0)');
    grd.addColorStop(1, 'rgba(5,6,10,1)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, d, d);
    tex.refresh();
  }
}
