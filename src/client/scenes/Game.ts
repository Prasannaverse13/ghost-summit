import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { DailyStatusResponse, Outcome, SubmitRunResponse } from '../../shared/api';

/**
 * Ghost Summit
 * A vertical climbing scene. Move left/right, jump up procedurally-placed
 * platforms, climb as high as you can. Camera follows you upward.
 *
 * Two threats: a CHASING GHOST rises from below (out-climb it or die) and
 * ZIGZAG BATS cross your path (shoot them with the gun or dodge). Score = max
 * height climbed + a bonus per bat shot down. Fall below the view -> Game Over.
 */

const FALLBACK_WIDTH = 1024; // used only if the camera width is unavailable
const PLAYER_SIZE = 44;
const GRAVITY = 1400;
const MOVE_SPEED = 340;
const JUMP_VELOCITY = -820;
const PLATFORM_H = 22;
const NUM_PLATFORMS = 120;

// --- Derived jump physics (kept in sync with the constants above) ---
// Peak height a perfectly-timed jump reaches: H = JUMP_VELOCITY^2 / (2 * GRAVITY).
const MAX_JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY); // ~240px
// Vertical spacing is varied but always a safe fraction of MAX_JUMP_HEIGHT, so
// the next platform up is always reachable. Hardest gap is ~68% of max height.
const GAP_MIN = Math.round(MAX_JUMP_HEIGHT * 0.3); // ~72px
const GAP_MAX = Math.round(MAX_JUMP_HEIGHT * 0.68); // ~163px (beatable ceiling)
// Horizontal distance coverable by the apex of a jump (MOVE_SPEED * time-to-apex).
// Consecutive platforms are never offset further than this, so the path upward
// is always reachable; the screen-wrap only adds slack on top.
const MAX_DX = Math.round((MOVE_SPEED * Math.abs(JUMP_VELOCITY)) / GRAVITY); // ~199px
// Minimum horizontal step so platforms march sideways (a real zig-zag that uses
// the full width) instead of stacking into a straight-up column.
const PLATFORM_MIN_DX = 70;
// Chance per platform of flipping the sweep direction early (before an edge).
// This gives each seed its own horizontal character — some cluster left, some
// right, some fully traverse — while every step still respects MAX_DX.
const PLATFORM_TURN_CHANCE = 0.22;

// --- Platform width variety ---
const PLATFORM_W_MIN = 75;
const PLATFORM_W_MAX = 220;
const PLATFORM_W_MAX_TOP = 120; // max width thins to this near the summit (difficulty ramp)
const EDGE_PAD = 12; // keep platforms fully on the visible field

// --- Moving platforms — tune by feel ---
const MOVING_FIRST_STATIC = 2; // first N platforms are always static (find your footing)
const MOVING_PLATFORM_SPEED = 60; // px/sec, slow back-and-forth
const MOVING_PLATFORM_RANGE = 90; // px amplitude either side of the placed centre

// --- Visual-only tuning (does not affect physics) ---
// Scale applied to the 80x110 Adventurer character frames. The physics body is
// resized back to PLAYER_SIZE below (setSize uses PLAYER_SIZE / PLAYER_SCALE),
// so the world collision box stays exactly PLAYER_SIZE regardless of this scale.
const PLAYER_SCALE = 0.7;
// Display height of the grass ledge tiles (source tiles are 64px).
const PLAT_TILE_H = 40;

// --- The chasing ghost (vertical pursuer) — tune by feel ---
// A single menacing ghost rises from below the player and chases UPWARD: the
// relentless pressure that forces you to keep climbing. It is NOT shootable —
// you escape it only by out-climbing it. Its speed ramps with height (and is
// multiplied by the difficulty's chaserSpeedMul).
const GHOST_START_OFFSET = 900; // px below the player at spawn (generous head start)
const GHOST_START_DELAY_MS = 1200; // grace before it begins rising
const GHOST_CHASE_SPEED_MIN = 120; // px/sec rise speed at the bottom
const GHOST_CHASE_SPEED_MAX = 260; // px/sec rise speed at the top of the ramp
const GHOST_SPEED_RAMP_HEIGHT = 2500; // metres over which speed ramps min -> max
const GHOST_DRIFT_X = 55; // px/sec horizontal drift toward the player's x (slow)
const GHOST_CATCH_DX = 62; // horizontal catch half-distance
const GHOST_CATCH_DY = 40; // vertical catch half-distance (tolerance at your level)
const GHOST_CHASER_SCALE = 0.72; // display scale of the chaser ghost

// --- The zigzag bats (the shootable threat) — tune by feel ---
// Bats cross the screen weaving up and down. Touching one is game over, so you
// must shoot (BAT_KILL_BONUS score) or dodge them. They escalate with height:
// spawn cadence tightens and the concurrent cap grows.
const BAT_START_HEIGHT = 100; // metres before the first bat appears
const BAT_FIRST_DELAY_MS = 700; // grace after crossing BAT_START_HEIGHT
const BAT_SPEED = 170; // px/sec horizontal cross speed
const BAT_ZIGZAG_AMPLITUDE = 70; // px vertical weave amplitude
const BAT_ZIGZAG_FREQUENCY = 2.2; // sine cycles per full screen crossing
const BAT_SPAWN_INTERVAL_MS = 2200; // ms between spawns at BAT_START_HEIGHT
const BAT_SPAWN_INTERVAL_MIN_MS = 750; // fastest spawn cadence at the ramp top
const BAT_SPAWN_RAMP_HEIGHT = 2500; // metres over which cadence + count reach their max
const BAT_ALIVE_MIN = 2; // concurrent bat cap near the bottom
const BAT_ALIVE_MAX = 6; // concurrent bat cap at the ramp top
const BAT_SCALE = 0.7; // display scale of the drawn 100x64 bat texture
const BAT_TINT = 0x241a30; // charcoal-purple silhouette colour of the drawn bat
const BAT_HIT_RADIUS = 24; // bat radius for bullet hits AND player collision
const BAT_KILL_BONUS = 25; // score (metres) added per bat shot down
const BAT_BAND_TOP_FRAC = 0.18; // highest baseline row, as a fraction of the view
const BAT_BAND_BOT_FRAC = 0.72; // lowest baseline row
const BAT_ENTER_MARGIN = 90; // px off-screen where bats enter/exit

// --- Difficulty modes — chosen on the main menu, tune freely ---
// Easy is the default. Values here override the base feel constants above:
// the chasing-ghost speed is multiplied, the spotlight radius is set outright,
// and the moving-platform chance ramps between min (bottom) and max (summit).
export type GameMode = 'easy' | 'hard';
interface DifficultyConfig {
  chaserSpeedMul: number; // multiplies the chasing-ghost rise speed
  lightRadius: number; // spotlight radius (px); bigger = more visibility
  moverChanceMin: number; // mover chance near the bottom
  moverChanceMax: number; // mover chance near the summit
}
const DIFFICULTY: Record<GameMode, DifficultyConfig> = {
  easy: { chaserSpeedMul: 1.0, lightRadius: 170, moverChanceMin: 0.1, moverChanceMax: 0.35 },
  hard: { chaserSpeedMul: 1.25, lightRadius: 130, moverChanceMin: 0.2, moverChanceMax: 0.6 },
};

// --- Gun + shooting — tune by feel ---
// The player carries a gun with a limited magazine. Firing sends a bullet along
// the AIM direction (cursor on desktop, last tap on mobile) — used to shoot the
// zigzag bats. Ammo refills to full every RELOAD_INTERVAL metres climbed.
const MAX_AMMO = 12; // full magazine
const BULLET_SPEED = 900; // px/sec, travel speed along the aim direction
const FIRE_COOLDOWN_MS = 220; // minimum time between shots (also caps auto-fire while held)
const RELOAD_INTERVAL = 500; // metres climbed per automatic full reload
const BULLET_RADIUS = 5; // drawn bullet radius (px)
const BULLET_MAX_DIST = 1600; // despawn a bullet after it travels this far (safety cull)
const GUN_REACH = 16; // gun distance from the player centre along the aim (px)
const GUN_OFFSET_Y = 4; // gun vertical anchor relative to the player centre (px)
const GUN_MUZZLE_X = 14; // bullet spawn offset from the gun centre toward the muzzle (px)

// --- Audio — per-sound volumes, tuned by feel. Frequent actions (jump/shoot/
// land) are kept subtle; the game-over hit is the loudest. A global mute toggle
// (speaker icon + "M" key) silences everything. ---
const SFX_JUMP_VOL = 0.35;
const SFX_SHOOT_VOL = 0.22;
const SFX_BATKILL_VOL = 0.5;
const SFX_RELOAD_VOL = 0.5;
const SFX_CAUGHT_VOL = 0.75;
const SFX_LAND_VOL = 0.28;
const MUTE_STORAGE_KEY = 'gs_muted'; // localStorage key for the mute preference

// Looping background music — kept low so it sits UNDER the SFX. It swells
// slightly as the chasing ghost closes in for rising tension.
const MUSIC_BASE_VOL = 0.16; // volume when the ghost is far away
const MUSIC_MAX_VOL = 0.3; // volume when the ghost is right beneath you
const MUSIC_TENSION_RANGE = 700; // px gap below which the music starts swelling

// --- Mobile touch gestures — tune the feel here (desktop input is unaffected) ---
// Swipe up = jump, swipe left/right = move (hold to sustain; a quick flick gives
// a short step), tap = shoot toward the tap. Tap vs swipe is decided by travel.
const SWIPE_THRESHOLD_PX = 28; // travel beyond this = swipe; at/under on release = tap (shoot)
const MOVE_DEADZONE_PX = 14; // holding within this of the drag anchor keeps the last direction
const FLICK_MAX_MS = 200; // a move released faster than this counts as a flick (gets a step tail)
const FLICK_TAIL_MS = 160; // how long a flick keeps moving after release (a short step)
const JUMP_BUFFER_MS = 140; // a swipe-up stays "pressed" this long, so it fires the instant you land

// --- Background themes — one is chosen per climb from the seed ---
interface BgTheme {
  sky: string; // solid backdrop layer (fixed)
  far: string; // fade silhouette layer (parallax-scrolled)
}
const BG_THEMES: BgTheme[] = [
  { sky: 'bg_sky', far: 'bg_hills' },
  { sky: 'bg_sky', far: 'bg_trees' },
  { sky: 'bg_sand', far: 'bg_desert' },
  { sky: 'bg_sky', far: 'bg_mushrooms' },
];

// --- Darkness + light — tune by feel ---
const DARK_MAX_ALPHA = 0.93; // darkness at the bottom (near-black)
const DARK_MIN_ALPHA = 0.0; // darkness at the summit (full sunlight)
const DARK_FADE_POWER = 1.6; // >1 keeps it dark longer, blooming near the top
const DARK_COLOR = 0x05060a; // the overlay colour
// Sky/hills warm from night -> daylight over the same climb-progress curve.
const SKY_NIGHT = 0x2b3557;
const SKY_DAY = 0xfff1cf;
const HILLS_NIGHT = 0x20294a;
const HILLS_DAY = 0xffd7a0;

/** Linearly interpolates between two 0xRRGGBB colours. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff,
    ag = (a >> 8) & 0xff,
    ab = a & 0xff;
  const br = (b >> 16) & 0xff,
    bg = (b >> 8) & 0xff,
    bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export class Game extends Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private sky!: Phaser.GameObjects.TileSprite;
  private hills!: Phaser.GameObjects.TileSprite;

  private startY = 0;
  private maxHeight = 0;
  private heightText!: Phaser.GameObjects.Text;
  private isGameOver = false;
  private ready = false; // true once the run is built (after the daily fetch)

  // --- Mobile touch-gesture state (swipe to move/jump, tap to shoot) ---
  // One entry per active touch, so several fingers (move + shoot + jump) coexist.
  private touchGestures = new Map<
    number,
    { startX: number; startY: number; maxDist: number; kind: 'none' | 'move' | 'jump' | 'dead' }
  >();
  private touchMoveDir = 0; // -1 / 0 / +1 from the active horizontal drag
  private moveHeld = false; // true while the move finger is down
  private moveId = -1; // pointer id currently driving movement
  private moveStartAt = 0; // scene-clock ms the move gesture began (flick vs hold)
  private moveLatchUntil = 0; // movement stays active until this ms (a flick's step tail)
  private touchJumpAt = -100000; // scene-clock ms of the last swipe-up (jump buffer)

  // Horizontal play field = the camera's visible width (set in create()).
  private fieldW = FALLBACK_WIDTH;

  // Moving platforms: dynamic immovable bodies that patrol horizontally, with
  // their grass visuals repositioned each frame to match the body.
  private movingGroup!: Phaser.Physics.Arcade.Group;
  private movers: {
    plat: Phaser.Physics.Arcade.Sprite;
    pieces: { obj: Phaser.GameObjects.Image; off: number }[];
    minX: number;
    maxX: number;
  }[] = [];

  // Darkness state.
  private darkRT!: Phaser.GameObjects.RenderTexture;
  private summitY = 0; // y of the topmost platform (reach it => win)
  private climbSpan = 1; // vertical distance from start to summit (progress denom)

  // The chasing ghost: a single vertical pursuer rising from below.
  private chaser!: Phaser.GameObjects.Container;
  private chaserX = 0;
  private chaserY = 0;
  private chaserActiveAt = 0; // scene-clock ms; it starts rising at/after this

  // The zigzag bats: shootable flyers that weave across the screen.
  private bats: {
    obj: Phaser.GameObjects.Sprite;
    dir: number; // +1 left->right, -1 right->left
    speed: number; // px/sec
    startX: number;
    endX: number;
    frac: number; // baseline row as a fraction of the view height (screen-relative)
    phase: number; // per-bat zigzag phase so bats don't weave in lockstep
  }[] = [];
  private batCount = 0; // total spawned (drives alternating direction)
  private nextBatAt = 0; // scene-clock ms; next allowed bat entry

  // Gun + shooting state.
  private gun!: Phaser.GameObjects.Image;
  private ammo = MAX_AMMO;
  private facing = 1; // +1 right, -1 left (derived from the aim direction)
  private aimX = 1; // unit aim vector (world-space direction from the player)
  private aimY = 0;
  private pointerAim = false; // true once a pointer has set the aim (else aim follows movement)
  private lastFireAt = 0; // scene-clock ms of the last shot (fire-rate cooldown)
  private nextReloadHeight = RELOAD_INTERVAL; // metres of the next automatic reload milestone
  private batBonus = 0; // score bonus (metres) accumulated from shooting bats
  private bullets: { obj: Phaser.GameObjects.Image; vx: number; vy: number; dist: number }[] = [];
  private ammoText!: Phaser.GameObjects.Text;
  private reloadFlash!: Phaser.GameObjects.Text;
  private fireKeyX!: Phaser.Input.Keyboard.Key;
  private fireKeyF!: Phaser.Input.Keyboard.Key;

  // Audio + mute.
  private muteBtn!: Phaser.GameObjects.Image;
  private muteRect: { x: number; y: number; w: number; h: number } | null = null;
  private muteKey!: Phaser.Input.Keyboard.Key;
  private prevOnGround = true; // for the airborne -> grounded LAND detection
  private music: Phaser.Sound.NoAudioSound | Phaser.Sound.HTML5AudioSound | Phaser.Sound.WebAudioSound | undefined =
    undefined;
  private musicStarted = false; // music begins on the first user interaction

  // Difficulty (resolved from the chosen mode in create()).
  private mode: GameMode = 'easy';
  private chaserSpeedMul = 1;
  private lightRadius = 170;
  private lightBrushKey = 'light_brush_170';

  constructor() {
    super('Game');
  }

  /** Reads the difficulty mode passed from the menu; defaults to Easy. */
  init(data: { mode?: GameMode }) {
    this.mode = data?.mode === 'hard' ? 'hard' : 'easy';
  }

  create() {
    this.ready = false;
    this.isGameOver = false;
    this.maxHeight = 0;

    // Reset gun + threat state (the scene instance is reused across restarts).
    this.ammo = MAX_AMMO;
    this.facing = 1;
    this.aimX = 1;
    this.aimY = 0;
    this.pointerAim = false;
    this.lastFireAt = 0;
    this.nextReloadHeight = RELOAD_INTERVAL;
    this.batBonus = 0;
    this.bullets = [];
    this.bats = [];
    this.batCount = 0;
    this.touchGestures.clear();
    this.touchMoveDir = 0;
    this.moveHeld = false;
    this.moveId = -1;
    this.moveLatchUntil = 0;
    this.touchJumpAt = -100000;
    this.prevOnGround = true;
    this.musicStarted = false;

    // Apply the saved mute preference to the global sound manager.
    this.sound.mute = this.loadMuteSetting();

    // Horizontal field = the camera's visible width (Doodle-Jump style column),
    // not a fixed world width. Everything horizontal (ground, placement, wrap)
    // is measured against this.
    this.fieldW = Math.round(this.cameras.main.width) || FALLBACK_WIDTH;

    // Fetch today's daily status first; the level seed comes from the server so
    // everyone climbs the same mountain. Show a brief loading label meanwhile.
    this.cameras.main.setBackgroundColor(0x05060a);
    const loading = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Loading today's summit…", {
        fontFamily: 'Arial',
        fontSize: '28px',
        color: '#c7cde8',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2000);

    void this.beginDaily(loading);
  }

  /**
   * Fetches the daily status, then either shows the "out of climbs" result (all
   * MAX_ATTEMPTS used today) or builds the playable run on the daily seed. Falls
   * back to a random seed if the server is unreachable (local/offline dev).
   */
  private async beginDaily(loading: Phaser.GameObjects.Text) {
    // Fetch today's daily status (seed + climbs remaining).
    let status: DailyStatusResponse | null = null;
    try {
      const res = await fetch('/api/daily-status');
      if (res.ok) status = (await res.json()) as DailyStatusResponse;
    } catch {
      // ignore — fall through to the offline fallback below
    }
    loading.destroy();

    // Out of climbs for today — no playable run, show the best-of-day result.
    if (status && status.attemptsLeft <= 0) {
      this.scene.start('GameOver', {
        outcome: status.bestOutcome ?? 'fell',
        height: status.bestHeight,
        bestHeight: status.bestHeight,
        attemptsLeft: 0,
        noAttempts: true,
      });
      return;
    }

    const seed = status?.seed ?? (Math.floor(Math.random() * 0x7fffffff) || 1);
    this.buildRun(seed);
  }

  /** Builds the playable climb from the given (daily) seed. */
  private buildRun(dailySeed: number) {
    // World is tall enough for the worst-case (all-GAP_MAX) tower.
    const totalHeight = NUM_PLATFORMS * GAP_MAX + 400;

    this.cameras.main.setBackgroundColor(0x1a1c2c);
    this.physics.world.setBounds(0, -totalHeight, this.fieldW, totalHeight + 800);

    // Resolve difficulty for this run.
    const diff = DIFFICULTY[this.mode];
    this.chaserSpeedMul = diff.chaserSpeedMul;
    this.lightRadius = diff.lightRadius;

    // The daily seed drives the whole layout AND the background theme, so
    // "same day = same climb + same backdrop" for everyone.
    const runSeed = dailySeed;
    const theme = BG_THEMES[runSeed % BG_THEMES.length] ?? { sky: 'bg_sky', far: 'bg_hills' };

    // Parallax backdrop: sky + far layer fixed to the camera. Both are scrolled
    // manually in update() so the far layer drifts slower than the world.
    const { width: vw, height: vh } = this.scale;
    this.sky = this.add
      .tileSprite(vw / 2, vh / 2, vw, vh, theme.sky)
      .setScrollFactor(0)
      .setDepth(-20);
    this.hills = this.add
      .tileSprite(vw / 2, vh / 2, vw, vh, theme.far)
      .setScrollFactor(0)
      .setDepth(-10);

    this.platforms = this.physics.add.staticGroup();
    this.movingGroup = this.physics.add.group({ allowGravity: false, immovable: true });
    this.movers = [];

    const groundY = 0;
    this.addPlatform(this.fieldW / 2, groundY, this.fieldW, 40);
    this.addGroundVisual(groundY);

    let seed = runSeed;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    // Independent stream (derived from the same run seed) so the "does this
    // platform move?" decision does NOT shift the layout stream — gaps/widths/x
    // stay identical for a given seed.
    let seed2 = (runSeed * 40503 + 12345) & 0x7fffffff;
    const rand2 = () => {
      seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff;
      return seed2 / 0x7fffffff;
    };

    // Procedural climb: varied gaps + widths, marching left<->right across the
    // full width in a zig-zag. Each step is capped at MAX_DX so the next
    // platform is always reachable from the one below.
    let prevX = this.fieldW / 2;
    // Initial sweep direction from the seed, so some maps go left-first.
    let sweepDir = (runSeed & 1) === 0 ? 1 : -1; // +1 right, -1 left
    let y = groundY;
    for (let i = 1; i <= NUM_PLATFORMS; i++) {
      y -= GAP_MIN + rand() * (GAP_MAX - GAP_MIN);

      const t = i / NUM_PLATFORMS;
      const wMax = PLATFORM_W_MAX + (PLATFORM_W_MAX_TOP - PLATFORM_W_MAX) * t; // 210 -> 130
      let w = PLATFORM_W_MIN + rand() * (wMax - PLATFORM_W_MIN);
      w = Math.min(w, this.fieldW - 2 * EDGE_PAD); // must fit on the field

      const placed = this.placePlatformX(prevX, w, rand(), rand(), sweepDir);
      const x = placed.x;
      sweepDir = placed.dir;
      // Mover chance ramps from min (bottom) to max (summit); first few static.
      const moveChance = i <= MOVING_FIRST_STATIC ? 0 : Phaser.Math.Linear(diff.moverChanceMin, diff.moverChanceMax, t);
      if (rand2() < moveChance) {
        this.addMovingPlatform(x, y, w);
      } else {
        this.addPlatform(x, y, w, PLATFORM_H);
        this.addPlatformVisual(x, y, w);
      }
      prevX = x; // chain from the placed centre so movers stay reachable at centre
    }
    this.summitY = y; // topmost platform — reaching it wins

    this.createPlayerAnims();
    this.player = this.physics.add.sprite(this.fieldW / 2, groundY - 60, 'char_idle');
    this.player.setScale(PLAYER_SCALE).setDepth(10);
    this.player.setCollideWorldBounds(false);
    this.player.setBounce(0);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    // Keep the world-space collision box identical to the original 44x44 block.
    // setSize works in source-texture pixels and is multiplied by the sprite
    // scale, so PLAYER_SIZE / PLAYER_SCALE yields exactly PLAYER_SIZE in world
    // units, centered on the sprite (matching the old origin-0.5 block body).
    body.setSize(PLAYER_SIZE / PLAYER_SCALE, PLAYER_SIZE / PLAYER_SCALE, true);
    body.setGravityY(GRAVITY);
    this.startY = this.player.y;
    this.climbSpan = Math.max(1, this.startY - this.summitY);

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.movingGroup);

    // Gun: a small in-engine sprite riding in the player's hands. It follows the
    // player and flips with facing each frame (see update()). Drawn just above
    // the player so it reads as held.
    this.makeGunTexture('gun');
    this.makeBulletTexture('bullet');
    this.gun = this.add.image(this.player.x + GUN_REACH, this.player.y + GUN_OFFSET_Y, 'gun').setDepth(11);

    // The chasing ghost (rises from below) + the zigzag bats (shootable).
    this.spawnChaser();
    this.bats = [];
    this.batCount = 0;
    this.nextBatAt = this.time.now + BAT_FIRST_DELAY_MS;

    this.createDarkness();

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setDeadzone(this.fieldW, 200);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.fireKeyX = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.fireKeyF = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.muteKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);

    this.setupControls();

    this.heightText = this.add
      .text(20, 20, 'Height: 0m', {
        fontFamily: 'Arial Black',
        fontSize: 32,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 7,
      })
      .setScrollFactor(0)
      .setDepth(1000);

    // Ammo counter (top-right). Kept in sync by updateAmmoText().
    this.ammoText = this.add
      .text(this.scale.width - 20, 20, `Ammo: ${this.ammo}/${MAX_AMMO}`, {
        fontFamily: 'Arial Black',
        fontSize: 28,
        color: '#ffe08a',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000);

    // "RELOADED" flash — hidden until a reload milestone is crossed.
    this.reloadFlash = this.add
      .text(this.scale.width / 2, 90, 'RELOADED', {
        fontFamily: 'Arial Black',
        fontSize: 40,
        color: '#7fffa0',
        stroke: '#000000',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001)
      .setAlpha(0);

    this.createMuteButton();

    // Looping horror bed — created now, but only started on the first user
    // interaction (ensureMusicStarted) to satisfy browser autoplay rules.
    this.music = this.sound.add('music_horror', { loop: true, volume: MUSIC_BASE_VOL });

    // Lay the HUD out now and keep it laid out (and non-overlapping) on resize.
    this.layoutHud(this.scale.width, this.scale.height);
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      this.music?.destroy(); // stop + release the loop when leaving the scene
      this.music = undefined;
    });

    this.ready = true; // run is fully built — update() may now run
  }

  /**
   * Creates the invisible static collision body for a platform. Kept pixel-for-
   * pixel identical to the original template (same size + refreshBody); the
   * grass artwork is drawn separately so physics is fully decoupled from visuals.
   */
  private addPlatform(x: number, y: number, w: number, h: number) {
    const key = `plat_${w}x${h}`;
    if (!this.textures.exists(key)) {
      this.makeBlockTexture(key, w, h, 0xffffff);
    }
    const plat = this.platforms.create(x, y, key) as Phaser.Physics.Arcade.Sprite;
    plat.setVisible(false);
    plat.refreshBody();
    return plat;
  }

  /** Tiles the full-width ground with grass blocks, aligned to the body top. */
  private addGroundVisual(groundY: number) {
    const topY = groundY - 20; // ground body is 40px tall, centered on groundY
    this.add
      .tileSprite(this.fieldW / 2, topY, this.fieldW, 64, 'grass_block')
      .setOrigin(0.5, 0)
      .setDepth(0);
  }

  /**
   * Places a platform by marching horizontally in `dir` (a directed sweep that
   * uses the full width as a left<->right zig-zag). The step is a random amount
   * in [PLATFORM_MIN_DX, MAX_DX], so it always moves sideways yet never exceeds
   * a jump's reach (guaranteeing a reachable path up). When the march reaches a
   * field edge it clamps to the edge and flips direction. A `turnRoll` also
   * flips direction early with probability PLATFORM_TURN_CHANCE, so different
   * seeds cluster/traverse differently. Returns the new x and the (possibly
   * flipped) sweep direction. Deterministic given `roll`/`turnRoll` in [0,1).
   */
  private placePlatformX(
    prevX: number,
    w: number,
    roll: number,
    turnRoll: number,
    dir: number
  ): { x: number; dir: number } {
    const half = w / 2;
    const minX = half + EDGE_PAD;
    const maxX = this.fieldW - half - EDGE_PAD;
    if (minX >= maxX) return { x: this.fieldW / 2, dir }; // platform ~ field width

    // Occasionally turn back early — varies run length -> per-seed clustering.
    const d = turnRoll < PLATFORM_TURN_CHANCE ? -dir : dir;

    const maxStep = Math.min(MAX_DX, maxX - minX);
    const minStep = Math.min(PLATFORM_MIN_DX, maxStep);
    const stepMag = minStep + roll * (maxStep - minStep);

    let x = prevX + d * stepMag;
    let nextDir = d;
    if (x > maxX) {
      x = maxX; // hit the right edge -> clamp and sweep back left
      nextDir = -1;
    } else if (x < minX) {
      x = minX; // hit the left edge -> clamp and sweep back right
      nextDir = 1;
    }
    return { x, dir: nextDir };
  }

  /**
   * Draws a floating grass ledge (rounded left/right caps + stretched middle)
   * over a platform's collision body. The grass surface is aligned to the top
   * of the PLATFORM_H body so the player visually stands on the grass.
   */
  private addPlatformVisual(x: number, y: number, w: number): Phaser.GameObjects.Image[] {
    const scale = PLAT_TILE_H / 64;
    const capW = 64 * scale;
    const topY = y - PLATFORM_H / 2;

    const left = this.add
      .image(x - w / 2 + capW / 2, topY, 'grass_left')
      .setOrigin(0.5, 0)
      .setScale(scale)
      .setDepth(0);
    const right = this.add
      .image(x + w / 2 - capW / 2, topY, 'grass_right')
      .setOrigin(0.5, 0)
      .setScale(scale)
      .setDepth(0);
    const mid = this.add.image(x, topY, 'grass_mid').setOrigin(0.5, 0).setDepth(0);
    mid.displayWidth = w - 2 * capW;
    mid.displayHeight = PLAT_TILE_H;

    return [left, right, mid]; // order matches the offsets used by moving platforms
  }

  /**
   * A horizontally-patrolling platform: a dynamic, immovable, gravity-free body
   * that moves via velocity and reverses at [minX, maxX] (its placed centre +/-
   * MOVING_PLATFORM_RANGE, clamped to the field). It always passes back through
   * its placed centre, so the reachability the generator guaranteed still holds.
   * The grass visuals are stored with their offsets and follow the body each frame.
   */
  private addMovingPlatform(x: number, y: number, w: number) {
    const key = `plat_${w}x${PLATFORM_H}`;
    if (!this.textures.exists(key)) {
      this.makeBlockTexture(key, w, PLATFORM_H, 0xffffff);
    }
    const plat = this.movingGroup.create(x, y, key) as Phaser.Physics.Arcade.Sprite;
    plat.setVisible(false);
    const body = plat.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    plat.setImmovable(true);

    const half = w / 2;
    const minX = Math.max(x - MOVING_PLATFORM_RANGE, half + EDGE_PAD);
    const maxX = Math.min(x + MOVING_PLATFORM_RANGE, this.fieldW - half - EDGE_PAD);
    // Deterministic starting direction (alternates by creation order).
    const dir = this.movers.length % 2 === 0 ? 1 : -1;
    plat.setVelocityX(maxX > minX ? dir * MOVING_PLATFORM_SPEED : 0);

    const capW = PLAT_TILE_H; // 64 * (PLAT_TILE_H / 64)
    const offs = [-w / 2 + capW / 2, w / 2 - capW / 2, 0];
    const pieces = this.addPlatformVisual(x, y, w).map((obj, i) => ({ obj, off: offs[i] ?? 0 }));

    this.movers.push({ plat, pieces, minX, maxX });
  }

  /**
   * Advances each moving platform: reverses at its patrol bounds, carries the
   * player standing on it (standard Phaser deltaX carry), and drags its grass
   * visuals along. Called from update() before the screen-wrap.
   */
  private updateMovingPlatforms() {
    const pb = this.player.body as Phaser.Physics.Arcade.Body;
    const grounded = pb.touching.down || pb.blocked.down;

    for (const m of this.movers) {
      const b = m.plat.body as Phaser.Physics.Arcade.Body;

      if (m.plat.x <= m.minX && b.velocity.x < 0) m.plat.setVelocityX(MOVING_PLATFORM_SPEED);
      else if (m.plat.x >= m.maxX && b.velocity.x > 0) m.plat.setVelocityX(-MOVING_PLATFORM_SPEED);

      if (grounded && b.touching.up) {
        this.player.x += b.deltaX(); // ride the platform
      }

      for (const p of m.pieces) {
        p.obj.x = m.plat.x + p.off;
      }
    }
  }

  /**
   * Spawns the single chasing ghost below the player: the menacing drawn ghost
   * (glow + angled eyes) with a subtle squash wobble. It hovers during a grace
   * delay, then rises (see updateChaser). It is NOT shootable.
   */
  private spawnChaser() {
    this.makeGhostTexture('ghost_body', true);
    this.makeRadialTexture('ghost_glow', 220, '190,215,255', 0.12);

    this.chaserX = this.fieldW / 2;
    this.chaserY = this.startY + GHOST_START_OFFSET;
    this.chaserActiveAt = this.time.now + GHOST_START_DELAY_MS;

    // Above the darkness overlay (depth 900) so the pursuer stays visible/menacing.
    this.chaser = this.add.container(this.chaserX, this.chaserY).setScale(GHOST_CHASER_SCALE).setDepth(905);
    const inner = this.add.container(0, 0);
    const glow = this.add.image(0, 0, 'ghost_glow').setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
    const body = this.add.image(0, 0, 'ghost_body').setAlpha(0.85);
    inner.add([glow, body]);
    this.chaser.add(inner);
    this.tweens.add({
      targets: inner,
      scaleX: { from: 1, to: 1.07 },
      scaleY: { from: 1, to: 0.93 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  /**
   * Advances the chasing ghost: after the grace delay it rises at a height-ramped
   * speed (scaled by difficulty), drifting slowly toward the player's x. It is
   * clamped so it never floats above the player — once level it pins just below
   * and slides sideways. Returns true if it catches the player (level + within
   * the horizontal catch range).
   */
  private updateChaser(dt: number): boolean {
    if (this.time.now >= this.chaserActiveAt) {
      const rampT = Phaser.Math.Clamp(this.maxHeight / GHOST_SPEED_RAMP_HEIGHT, 0, 1);
      const speed = Phaser.Math.Linear(GHOST_CHASE_SPEED_MIN, GHOST_CHASE_SPEED_MAX, rampT) * this.chaserSpeedMul;
      this.chaserY -= speed * dt; // rise (world Y decreases upward)
      if (this.chaserY < this.player.y) this.chaserY = this.player.y; // never overshoot above you
    }

    // Slow horizontal drift toward the player's x (kept roughly centred on you).
    const dx = this.player.x - this.chaserX;
    const step = GHOST_DRIFT_X * dt;
    this.chaserX += Phaser.Math.Clamp(dx, -step, step);

    this.chaser.setPosition(this.chaserX, this.chaserY);

    return (
      this.player.y >= this.chaserY - GHOST_CATCH_DY && Math.abs(this.player.x - this.chaserX) < GHOST_CATCH_DX
    );
  }

  /** Concurrent bat cap for the given height (ramps BAT_ALIVE_MIN -> BAT_ALIVE_MAX). */
  private batAliveCap(height: number): number {
    const rampT = Phaser.Math.Clamp(height / BAT_SPAWN_RAMP_HEIGHT, 0, 1);
    return Math.round(Phaser.Math.Linear(BAT_ALIVE_MIN, BAT_ALIVE_MAX, rampT));
  }

  /** Time between bat spawns for the given height (tightens with altitude). */
  private batSpawnInterval(height: number): number {
    const rampT = Phaser.Math.Clamp(height / BAT_SPAWN_RAMP_HEIGHT, 0, 1);
    return Phaser.Math.Linear(BAT_SPAWN_INTERVAL_MS, BAT_SPAWN_INTERVAL_MIN_MS, rampT);
  }

  /**
   * Spawns one zigzag bat entering from the off-screen edge (alternating side),
   * crossing at a random screen-relative baseline row with its own weave phase.
   */
  private spawnBat() {
    const dir = this.batCount % 2 === 0 ? 1 : -1;
    this.batCount++;

    const startX = dir === 1 ? -BAT_ENTER_MARGIN : this.fieldW + BAT_ENTER_MARGIN;
    const endX = dir === 1 ? this.fieldW + BAT_ENTER_MARGIN : -BAT_ENTER_MARGIN;
    const frac = Phaser.Math.FloatBetween(BAT_BAND_TOP_FRAC, BAT_BAND_BOT_FRAC);
    const phase = Phaser.Math.FloatBetween(0, Math.PI * 2);

    const y = this.cameras.main.scrollY + this.scale.height * frac;
    const obj = this.add.sprite(startX, y, 'bat_down').setScale(BAT_SCALE).setDepth(945).setFlipX(dir === -1);
    obj.play('bat_fly');

    this.bats.push({ obj, dir, speed: BAT_SPEED, startX, endX, frac, phase });
  }

  /**
   * Advances each bat: horizontal cross + a sine zigzag around its screen-
   * relative baseline (so bats stay in play as the camera climbs). Despawns off
   * the horizontal edge. Returns true if any bat touches the player.
   */
  private updateBats(dt: number): boolean {
    const scrollY = this.cameras.main.scrollY;
    const viewH = this.scale.height;
    const catchDist = BAT_HIT_RADIUS + PLAYER_SIZE * 0.4;
    let hitPlayer = false;

    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i];
      if (!b) continue;

      b.obj.x += b.dir * b.speed * dt;
      const prog = Phaser.Math.Clamp((b.obj.x - b.startX) / (b.endX - b.startX), 0, 1);
      b.obj.y = scrollY + viewH * b.frac + Math.sin(b.phase + prog * Math.PI * 2 * BAT_ZIGZAG_FREQUENCY) * BAT_ZIGZAG_AMPLITUDE;

      const offEdge = b.dir === 1 ? b.obj.x >= b.endX : b.obj.x <= b.endX;
      if (offEdge) {
        b.obj.destroy();
        this.bats.splice(i, 1);
        continue;
      }

      if (Math.abs(b.obj.x - this.player.x) < catchDist && Math.abs(b.obj.y - this.player.y) < catchDist) {
        hitPlayer = true;
      }
    }
    return hitPlayer;
  }

  /**
   * Kills any bat a live bullet overlaps: removes both, awards BAT_KILL_BONUS,
   * and spawns a death burst. Bullet vs bat is a simple radius test.
   */
  private collideBulletsBats() {
    for (let bi = this.bats.length - 1; bi >= 0; bi--) {
      const bat = this.bats[bi];
      if (!bat) continue;
      for (let li = this.bullets.length - 1; li >= 0; li--) {
        const bullet = this.bullets[li];
        if (!bullet) continue;
        if (Math.hypot(bullet.obj.x - bat.obj.x, bullet.obj.y - bat.obj.y) < BAT_HIT_RADIUS) {
          this.spawnBatDeath(bat.obj.x, bat.obj.y);
          this.playSfx('sfx_batkill', SFX_BATKILL_VOL);
          bat.obj.destroy();
          this.bats.splice(bi, 1);
          bullet.obj.destroy();
          this.bullets.splice(li, 1);

          this.batBonus += BAT_KILL_BONUS;
          this.updateHeightText();
          break; // this bat is gone — move to the next bat
        }
      }
    }
  }

  /** A short outward burst of shards where a bat died. */
  private spawnBatDeath(x: number, y: number) {
    this.makeBlockTexture('bat_spark', 6, 6, 0xc9a0ff);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.3, 0.3);
      const dist = Phaser.Math.FloatBetween(26, 56);
      const shard = this.add.image(x, y, 'bat_spark').setDepth(958);
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0,
        scale: 0.3,
        duration: 420,
        ease: 'Quad.easeOut',
        onComplete: () => shard.destroy(),
      });
    }
  }

  /** Global animations for the character. Guarded so scene restarts are safe. */
  private createPlayerAnims() {
    if (!this.anims.exists('player_idle')) {
      this.anims.create({ key: 'player_idle', frames: [{ key: 'char_idle' }], frameRate: 1, repeat: -1 });
    }
    if (!this.anims.exists('player_jump')) {
      this.anims.create({ key: 'player_jump', frames: [{ key: 'char_jump' }], frameRate: 1, repeat: -1 });
    }
    if (!this.anims.exists('player_move')) {
      this.anims.create({
        key: 'player_move',
        frames: [{ key: 'char_walk_a' }, { key: 'char_walk_b' }],
        frameRate: 8,
        repeat: -1,
      });
    }
    // Drawn bat: two flap frames generated once, then a simple wing-flap anim.
    this.makeBatTexture('bat_down', -1);
    this.makeBatTexture('bat_up', 1);
    if (!this.anims.exists('bat_fly')) {
      this.anims.create({
        key: 'bat_fly',
        frames: [{ key: 'bat_down' }, { key: 'bat_up' }],
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  /**
   * Draws a classic ghost silhouette into a texture once: rounded dome top,
   * straight sides, a scalloped (4-hump) bottom edge. White fill so it can be
   * tinted/alpha'd as a spectre. `menacing` => dark angled eye slits (the
   * chaser); otherwise two small neutral round eyes (friendly companions).
   */
  private makeGhostTexture(key: string, menacing: boolean) {
    if (this.textures.exists(key)) return;
    const texW = 124;
    const texH = 152;
    const pad = 10;
    const left = pad;
    const right = texW - pad;
    const w = right - left;
    const cx = texW / 2;
    const r = w / 2; // dome radius
    const domeCY = pad + r;
    const humps = 4;
    const humpR = w / (2 * humps);
    const bottomY = texH - pad - humpR;

    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // Body: dome top -> straight sides -> scalloped bottom.
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(left, domeCY);
    g.arc(cx, domeCY, r, Math.PI, Math.PI * 2, false); // upper semicircle (the dome)
    g.lineTo(right, bottomY);
    for (let i = 0; i < humps; i++) {
      const hcx = right - humpR - i * 2 * humpR;
      g.arc(hcx, bottomY, humpR, 0, Math.PI, false); // downward bulge
    }
    g.lineTo(left, domeCY);
    g.closePath();
    g.fillPath();

    const eyeY = domeCY + 4;
    const eyeDX = 21;
    if (menacing) {
      // Dark angled slits ("\ /") so the chaser reads as a threat.
      g.fillStyle(0x0b0c1a, 1);
      this.fillRotRect(g, cx - eyeDX, eyeY, 30, 15, 0.5);
      this.fillRotRect(g, cx + eyeDX, eyeY, 30, 15, -0.5);
    } else {
      // Small neutral round eyes for friendly companion ghosts.
      g.fillStyle(0x3a4a6a, 1);
      g.fillCircle(cx - eyeDX, eyeY, 6);
      g.fillCircle(cx + eyeDX, eyeY, 6);
    }

    g.generateTexture(key, texW, texH);
    g.destroy();
  }

  /** Fills a rectangle rotated by `ang` (radians) — used for the angled eyes. */
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

  /**
   * Spotlight darkness: a screen-sized RenderTexture filled dark each frame with
   * a soft hole erased around the player. Cheap (one fill + one erase/frame) and
   * mobile-friendly. Sits below the HUD so the height counter stays readable.
   */
  private createDarkness() {
    // Brush key includes the radius so each difficulty gets its own texture
    // (textures are cached across scene restarts / mode switches).
    this.lightBrushKey = `light_brush_${this.lightRadius}`;
    this.makeRadialTexture(this.lightBrushKey, this.lightRadius * 2, '255,255,255', 0.32);
    this.darkRT = this.add
      .renderTexture(0, 0, this.scale.width, this.scale.height)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(900);
  }

  /**
   * Builds a soft radial-gradient disc texture (white, faded edges) once.
   * `rgb` is a CSS "r,g,b" string; `innerStop` is the solid-core fraction.
   */
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

  private makeBlockTexture(key: string, w: number, h: number, color: number): string {
    if (this.textures.exists(key)) return key;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
    return key;
  }

  /**
   * Input wiring. DESKTOP (mouse) is unchanged: the cursor aims and a click
   * fires. MOBILE (touch) uses gestures — swipe up = jump, swipe left/right =
   * move (hold to sustain; a quick flick gives a short step), tap = shoot toward
   * the tap point. Every handler branches on `wasTouch`, so only touch runs the
   * gesture machine. Multi-touch is enabled so move + jump + shoot can overlap.
   */
  private setupControls() {
    this.input.addPointer(2); // up to 3 simultaneous touches (move + jump + shoot)

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.ready || this.isGameOver) return;
      if (p.wasTouch) {
        this.onTouchMove(p);
        return;
      }
      // Desktop mouse: aim follows the cursor.
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.pointerAim = true;
      this.setAim(wp.x, wp.y);
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.ready || this.isGameOver) return;
      this.ensureMusicStarted(); // first interaction unlocks + starts the music
      if (this.isControlPointer(p)) return; // taps on the mute icon are handled there
      if (p.wasTouch) {
        this.onTouchDown(p);
        return;
      }
      // Desktop mouse: aim + fire on click.
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.pointerAim = true;
      this.setAim(wp.x, wp.y);
      this.fire();
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) this.onTouchUp(p);
    });
  }

  /** Begins tracking a new touch as a potential swipe or tap. */
  private onTouchDown(p: Phaser.Input.Pointer) {
    this.touchGestures.set(p.id, { startX: p.x, startY: p.y, maxDist: 0, kind: 'none' });
  }

  /** Classifies an in-progress touch (once, on the dominant axis) and drives hold-to-move. */
  private onTouchMove(p: Phaser.Input.Pointer) {
    const g = this.touchGestures.get(p.id);
    if (!g) return;
    const dx = p.x - g.startX;
    const dy = p.y - g.startY;
    g.maxDist = Math.max(g.maxDist, Math.hypot(dx, dy));

    if (g.kind === 'none' && g.maxDist > SWIPE_THRESHOLD_PX) {
      if (Math.abs(dy) >= Math.abs(dx)) {
        if (dy < 0) {
          g.kind = 'jump';
          this.touchJumpAt = this.time.now; // buffered; applied in update() when grounded
        } else {
          g.kind = 'dead'; // downward swipe does nothing (and won't fire on release)
        }
      } else {
        g.kind = 'move';
        this.moveId = p.id;
        this.moveHeld = true;
        this.moveStartAt = this.time.now;
        this.touchMoveDir = Math.sign(dx);
      }
    }

    // While the move finger is down, direction tracks the drag (deadzone so
    // holding near the anchor keeps the last direction instead of jittering).
    if (g.kind === 'move' && p.id === this.moveId) {
      const off = p.x - g.startX;
      if (Math.abs(off) > MOVE_DEADZONE_PX) this.touchMoveDir = Math.sign(off);
    }
  }

  /** Resolves a released touch: a tap fires; a move stops (with a short flick tail). */
  private onTouchUp(p: Phaser.Input.Pointer) {
    const g = this.touchGestures.get(p.id);
    this.touchGestures.delete(p.id);
    if (!this.ready || this.isGameOver || !g) return;

    if (g.kind === 'none') {
      // Never crossed the swipe threshold -> a tap -> fire toward the tap point.
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.pointerAim = true;
      this.setAim(wp.x, wp.y);
      this.fire();
    } else if (g.kind === 'move' && p.id === this.moveId) {
      // Quick flick keeps moving briefly (a step); a deliberate hold stops now.
      const heldFor = this.time.now - this.moveStartAt;
      this.moveLatchUntil = heldFor < FLICK_MAX_MS ? this.time.now + FLICK_TAIL_MS : 0;
      this.moveHeld = false;
      this.moveId = -1;
    }
  }

  /** True if a pointer is over the mute icon (so it never fires a shot). */
  private isControlPointer(p: Phaser.Input.Pointer): boolean {
    const m = this.muteRect;
    return !!m && p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h;
  }

  /** Sets the unit aim vector from a world-space target point. */
  private setAim(worldX: number, worldY: number) {
    const dx = worldX - this.player.x;
    const dy = worldY - this.player.y;
    const len = Math.hypot(dx, dy) || 1;
    this.aimX = dx / len;
    this.aimY = dy / len;
  }

  /**
   * Creates the mute toggle: a drawn speaker icon (top-right, positioned in
   * layoutHud). Tapping it — or pressing "M" — silences all audio. Its texture
   * swaps between the "on" and "off" glyphs to reflect state.
   */
  private createMuteButton() {
    this.makeSpeakerTexture('spk_on', false);
    this.makeSpeakerTexture('spk_off', true);
    this.muteBtn = this.add
      .image(0, 0, this.sound.mute ? 'spk_off' : 'spk_on')
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1001)
      .setInteractive({ useHandCursor: true });
    this.muteBtn.on('pointerdown', () => this.toggleMute());
  }

  /** Flips the global mute state, updates the icon, and saves the preference. */
  private toggleMute() {
    this.sound.mute = !this.sound.mute;
    this.muteBtn.setTexture(this.sound.mute ? 'spk_off' : 'spk_on');
    this.saveMuteSetting(this.sound.mute);
  }

  /** Plays a one-shot sound effect (a no-op while muted, via the sound manager). */
  private playSfx(key: string, volume: number) {
    this.sound.play(key, { volume });
  }

  /**
   * Starts the looping music the first time the player interacts (jump / shoot /
   * tap). Kicking it off from a user gesture satisfies browser autoplay rules
   * and unlocks the audio context on iOS. Respects the global mute.
   */
  private ensureMusicStarted() {
    if (this.musicStarted || !this.music) return;
    this.music.play();
    this.musicStarted = true;
  }

  /** Reads the saved mute preference (best-effort; defaults to unmuted). */
  private loadMuteSetting(): boolean {
    try {
      return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** Persists the mute preference (best-effort — ignored if storage is blocked). */
  private saveMuteSetting(muted: boolean) {
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // ignore — storage may be unavailable in some embeds
    }
  }

  /**
   * Draws a small speaker icon once: a dark translucent chip for legibility, a
   * white speaker cone, and either sound waves (on) or a red cross (off).
   */
  private makeSpeakerTexture(key: string, muted: boolean) {
    if (this.textures.exists(key)) return;
    const w = 34;
    const h = 28;
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // Legibility chip behind the glyph.
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(17, 14, 16);

    // Speaker: driver base + cone opening to the right.
    g.fillStyle(0xffffff, 1);
    g.fillRect(6, 11, 5, 8);
    g.fillTriangle(9, 15, 20, 6, 20, 24);

    if (muted) {
      g.lineStyle(3, 0xff6a5a, 1);
      g.lineBetween(24, 8, 31, 21);
      g.lineBetween(31, 8, 24, 21);
    } else {
      g.lineStyle(2.5, 0xffffff, 1);
      g.beginPath();
      g.arc(20, 15, 6, -Math.PI / 4, Math.PI / 4, false);
      g.strokePath();
      g.beginPath();
      g.arc(20, 15, 11, -Math.PI / 4, Math.PI / 4, false);
      g.strokePath();
    }

    g.generateTexture(key, w, h);
    g.destroy();
  }

  /**
   * Lays out the HUD: the mute icon sits in the top-right corner, Height is
   * top-left, and Ammo is top-right just below the mute icon (a separate row, so
   * they can't collide at any width). Height shrinks to fit if it would ever
   * reach the mute icon. The reload flash is centred below.
   */
  private layoutHud(width: number, _height: number) {
    const pad = 16;

    // Mute icon: top-right corner. Its screen rect is stored so the shoot
    // handler ignores taps that land on it.
    this.muteBtn.setOrigin(1, 0).setPosition(width - pad, pad);
    const muteW = this.muteBtn.displayWidth;
    const muteH = this.muteBtn.displayHeight;
    this.muteRect = { x: width - pad - muteW, y: pad, w: muteW, h: muteH };

    // Height top-left, scaled down if it would otherwise reach the mute icon.
    this.heightText.setOrigin(0, 0).setScale(1);
    const availH = width - pad * 2 - muteW - 10;
    const kH = this.heightText.width > availH && availH > 0 ? availH / this.heightText.width : 1;
    this.heightText.setScale(kH).setPosition(pad, pad);

    // Ammo top-right, on the row below the mute icon.
    this.ammoText.setOrigin(1, 0).setScale(1);
    const availA = width - pad * 2;
    const kA = this.ammoText.width > availA && availA > 0 ? availA / this.ammoText.width : 1;
    this.ammoText.setScale(kA).setPosition(width - pad, pad + muteH + 6);

    this.reloadFlash.setPosition(width / 2, Math.max(90, pad + muteH + 60));
  }

  /** Re-lays the HUD when the web-view is resized. */
  private onResize(gameSize: Phaser.Structs.Size) {
    if (!this.ready) return;
    this.layoutHud(gameSize.width, gameSize.height);
  }

  /**
   * Fires one bullet along the aim direction (cursor / last tap) if there's ammo
   * and the fire-rate cooldown has elapsed. Bullets are advanced in
   * updateBullets() and can kill bats (collideBulletsBats()).
   */
  private fire() {
    if (!this.ready || this.isGameOver) return;
    if (this.ammo <= 0) return;
    if (this.time.now - this.lastFireAt < FIRE_COOLDOWN_MS) return;

    this.lastFireAt = this.time.now;
    this.ammo--;
    this.updateAmmoText();
    this.ensureMusicStarted(); // firing counts as the first interaction (X/F keys)
    this.playSfx('sfx_shoot', SFX_SHOOT_VOL);

    const muzzleX = this.gun.x + this.aimX * GUN_MUZZLE_X;
    const muzzleY = this.gun.y + this.aimY * GUN_MUZZLE_X;
    // Above the darkness overlay (depth 900) so bullets stay visible in flight.
    const obj = this.add.image(muzzleX, muzzleY, 'bullet').setDepth(960);
    this.bullets.push({ obj, vx: this.aimX * BULLET_SPEED, vy: this.aimY * BULLET_SPEED, dist: 0 });
  }

  /** Advances live bullets and despawns them off-screen / past BULLET_MAX_DIST. */
  private updateBullets(dt: number) {
    const view = this.cameras.main.worldView;
    const pad = 40;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b) continue;
      const dx = b.vx * dt;
      const dy = b.vy * dt;
      b.obj.x += dx;
      b.obj.y += dy;
      b.dist += Math.hypot(dx, dy);

      const off =
        b.obj.x < view.x - pad ||
        b.obj.x > view.x + view.width + pad ||
        b.obj.y < view.y - pad ||
        b.obj.y > view.y + view.height + pad;
      if (off || b.dist > BULLET_MAX_DIST) {
        b.obj.destroy();
        this.bullets.splice(i, 1);
      }
    }
  }

  private updateAmmoText() {
    this.ammoText.setText(`Ammo: ${this.ammo}/${MAX_AMMO}`);
    // Warn red when empty, warm gold otherwise.
    this.ammoText.setColor(this.ammo <= 0 ? '#ff6a5a' : '#ffe08a');
    this.layoutHud(this.scale.width, this.scale.height);
  }

  /** Score = climbed metres + bat-kill bonus. Re-lays the HUD (its width changes). */
  private updateHeightText() {
    this.heightText.setText(`Height: ${this.score()}m`);
    this.layoutHud(this.scale.width, this.scale.height);
  }

  /** The submitted/displayed score: pure climbed metres plus the bat-kill bonus. */
  private score(): number {
    return this.maxHeight + this.batBonus;
  }

  /** Refills to full and flashes "RELOADED" — called each RELOAD_INTERVAL metres. */
  private reload() {
    this.ammo = MAX_AMMO;
    this.updateAmmoText();
    this.playSfx('sfx_reload', SFX_RELOAD_VOL);
    this.reloadFlash.setAlpha(1).setScale(1);
    this.tweens.killTweensOf(this.reloadFlash);
    this.tweens.add({
      targets: this.reloadFlash,
      alpha: 0,
      scale: 1.25,
      duration: 900,
      ease: 'Quad.easeOut',
    });
  }

  /** Draws a small side-on pistol texture once (barrel + grip). */
  private makeGunTexture(key: string) {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    // Faces +X (right); flipped via setFlipX when the player faces left.
    g.fillStyle(0x2b2f38, 1);
    g.fillRect(0, 0, 26, 8); // barrel/slide
    g.fillRect(2, 6, 9, 12); // grip
    g.fillStyle(0x9aa0ad, 1);
    g.fillRect(20, 1, 6, 4); // muzzle highlight
    g.generateTexture(key, 28, 20);
    g.destroy();
  }

  /** Draws a small glowing bullet texture once. */
  private makeBulletTexture(key: string) {
    if (this.textures.exists(key)) return;
    const d = BULLET_RADIUS * 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xfff2a0, 1);
    g.fillCircle(BULLET_RADIUS, BULLET_RADIUS, BULLET_RADIUS);
    g.fillStyle(0xffb020, 1);
    g.fillCircle(BULLET_RADIUS, BULLET_RADIUS, BULLET_RADIUS * 0.5);
    g.generateTexture(key, d, d);
    g.destroy();
  }

  /**
   * Draws a menacing bat silhouette into a texture once: two spread wings with a
   * scalloped/pointed lower (membrane) edge, a rounded body, two pointed ears,
   * and tiny amber glowing eyes — all in a dark charcoal-purple (BAT_TINT). The
   * `flap` sign (+1 up / -1 down) lifts the outer wing points to make the two
   * flap frames; every other feature is identical between frames.
   */
  private makeBatTexture(key: string, flap: number) {
    if (this.textures.exists(key)) return;
    const texW = 100;
    const texH = 64;
    const cx = 50;
    const cy = 36;
    const amp = 14; // how far the outer wing points travel between flap frames

    // Right-wing outline as [dx, dy, outerWeight] relative to (cx, cy). The
    // weight (0 near body, 1 at the tip) scales the flap lift so the tip flaps
    // most and the shoulder barely moves. The zig-zag dy's form the scalloped
    // pointed membrane along the bottom edge.
    const wing: [number, number, number][] = [
      [6, -4, 0.0], // shoulder (top, near body)
      [48, -6, 1.0], // wing tip (outer)
      [41, 6, 0.85], // finger point
      [35, 0, 0.7], // cusp up between fingers
      [28, 9, 0.6], // finger point
      [21, 2, 0.45], // cusp up
      [14, 10, 0.3], // finger point (near body)
      [5, 9, 0.05], // lower body join
    ];
    const wingPts = (side: number) =>
      wing.map(([dx, dy, w]) => new Phaser.Math.Vector2(cx + side * dx, cy + dy - flap * w * amp));

    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // Wings first (behind the body), then body + ears on top.
    g.fillStyle(BAT_TINT, 1);
    g.fillPoints(wingPts(1), true); // right wing
    g.fillPoints(wingPts(-1), true); // left wing (mirrored)
    g.fillEllipse(cx, cy, 22, 30); // rounded body
    g.fillTriangle(cx - 9, cy - 12, cx - 4, cy - 26, cx - 1, cy - 11); // left ear
    g.fillTriangle(cx + 9, cy - 12, cx + 4, cy - 26, cx + 1, cy - 11); // right ear

    // Tiny glowing eyes.
    g.fillStyle(0xffcf5a, 1);
    g.fillCircle(cx - 5, cy - 3, 2.2);
    g.fillCircle(cx + 5, cy - 3, 2.2);

    g.generateTexture(key, texW, texH);
    g.destroy();
  }

  override update(_time: number, delta: number) {
    if (!this.ready || this.isGameOver) return;
    const dt = delta / 1000;

    // Mute toggle (also available via the on-screen speaker icon).
    if (Phaser.Input.Keyboard.JustDown(this.muteKey)) this.toggleMute();

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const onGround = body.blocked.down || body.touching.down;

    // LAND: a soft thud when settling onto a platform (airborne -> grounded).
    if (onGround && !this.prevOnGround) this.playSfx('sfx_land', SFX_LAND_VOL);
    this.prevOnGround = onGround;

    // Movement: keyboard (desktop) or the mobile hold-to-move gesture. The move
    // stays active while the finger is held, plus a brief tail after a flick.
    const touchMoving = this.moveHeld || this.time.now < this.moveLatchUntil;
    const touchDir = touchMoving ? this.touchMoveDir : 0;
    const left = this.cursors.left.isDown || touchDir === -1;
    const right = this.cursors.right.isDown || touchDir === 1;
    if (left && !right) this.player.setVelocityX(-MOVE_SPEED);
    else if (right && !left) this.player.setVelocityX(MOVE_SPEED);
    else this.player.setVelocityX(0);

    // Carry the player on moving platforms (adjusts player.x) before wrapping.
    this.updateMovingPlatforms();

    // Screen-edge wrap (Doodle-Jump style): leave the left of the visible view
    // and reappear on the right, and vice versa. Uses the camera's visible
    // width, not the world width.
    const view = this.cameras.main.worldView;
    const leftEdge = view.x;
    const rightEdge = view.x + view.width;
    if (this.player.x < leftEdge) this.player.x = rightEdge;
    else if (this.player.x > rightEdge) this.player.x = leftEdge;

    // Jump: keyboard, or a buffered mobile swipe-up (fires the instant you land).
    const jumpBuffered = this.time.now - this.touchJumpAt < JUMP_BUFFER_MS;
    const jumpPressed = this.cursors.up.isDown || this.spaceKey.isDown || jumpBuffered;
    if (jumpPressed && onGround) {
      this.player.setVelocityY(JUMP_VELOCITY);
      this.touchJumpAt = -100000; // consume the buffered swipe-up
      this.ensureMusicStarted(); // jumping counts as the first interaction
      this.playSfx('sfx_jump', SFX_JUMP_VOL);
    }

    // --- Aim + facing ---
    // Keyboard-only players (no pointer aim yet) aim in their move direction so
    // X/F still shoots somewhere useful. Once a pointer sets the aim, it wins.
    if (!this.pointerAim) {
      if (left && !right) {
        this.aimX = -1;
        this.aimY = 0;
      } else if (right && !left) {
        this.aimX = 1;
        this.aimY = 0;
      }
    }
    this.facing = this.aimX < 0 ? -1 : 1;

    // --- Visuals only (read state, never mutate physics) ---
    if (!onGround) {
      this.player.anims.play('player_jump', true); // jump frame doubles as "fall"
    } else if (left || right) {
      this.player.anims.play('player_move', true);
    } else {
      this.player.anims.play('player_idle', true);
    }
    this.player.setFlipX(this.facing === -1);

    // Gun rides in the player's hands and points along the aim direction.
    const aimAng = Math.atan2(this.aimY, this.aimX);
    this.gun.setPosition(this.player.x + this.aimX * GUN_REACH, this.player.y + GUN_OFFSET_Y + this.aimY * GUN_REACH);
    this.gun.setRotation(aimAng);
    this.gun.setFlipY(this.facing === -1); // keep the pistol upright when aiming left

    // Fire while X or F is held (fire() enforces the cooldown + ammo). Pointer
    // taps fire once each via the pointerdown handler.
    if (this.fireKeyX.isDown || this.fireKeyF.isDown) this.fire();

    this.updateBullets(dt);

    const cam = this.cameras.main;

    // Vertical parallax: hills drift slower than the world, sky nearly fixed.
    this.sky.tilePositionY = cam.scrollY * 0.1;
    this.hills.tilePositionY = cam.scrollY * 0.3;

    // Climb progress (0 at start, 1 at the summit) drives the difficulty ramp,
    // the light, and the warmth.
    const progress = Phaser.Math.Clamp((this.startY - this.player.y) / this.climbSpan, 0, 1);

    // Darkness + warmth follow the same progress, shaped by DARK_FADE_POWER.
    const curve = Math.pow(progress, DARK_FADE_POWER);
    const darkness = Phaser.Math.Linear(DARK_MAX_ALPHA, DARK_MIN_ALPHA, curve);
    this.sky.setTint(lerpColor(SKY_NIGHT, SKY_DAY, curve));
    this.hills.setTint(lerpColor(HILLS_NIGHT, HILLS_DAY, curve));

    // Redraw the spotlight: dark everywhere, soft hole following the player.
    this.darkRT.clear();
    this.darkRT.fill(DARK_COLOR, darkness);
    const px = this.player.x - cam.scrollX;
    const py = this.player.y - cam.scrollY;
    this.darkRT.erase(this.lightBrushKey, px - this.lightRadius, py - this.lightRadius);

    const climbed = Math.max(0, Math.floor((this.startY - this.player.y) / 10));
    if (climbed > this.maxHeight) {
      this.maxHeight = climbed;
      this.updateHeightText();

      // Automatic reload every RELOAD_INTERVAL metres climbed. Advance the
      // milestone past the current height so a big single jump still triggers
      // exactly one reload.
      if (this.maxHeight >= this.nextReloadHeight) {
        this.reload();
        while (this.nextReloadHeight <= this.maxHeight) this.nextReloadHeight += RELOAD_INTERVAL;
      }
    }

    // --- Zigzag bats (shootable) ---
    // Spawn bats from BAT_START_HEIGHT, cadence + concurrent cap escalating with
    // height. Move them, resolve bullet hits, and check player collision.
    const batCap = this.batAliveCap(this.maxHeight);
    if (this.maxHeight >= BAT_START_HEIGHT && this.bats.length < batCap && this.time.now >= this.nextBatAt) {
      this.spawnBat();
      this.nextBatAt = this.time.now + this.batSpawnInterval(this.maxHeight);
    }
    const batHitPlayer = this.updateBats(dt);
    this.collideBulletsBats();

    if (batHitPlayer) {
      void this.gameOver('caught'); // a bat flew into you
      return;
    }

    // --- Chasing ghost (relentless pursuer) ---
    if (this.updateChaser(dt)) {
      void this.gameOver('caught'); // caught from below by the ghost
      return;
    }

    // Rising tension: swell the music from base -> max as the ghost's vertical
    // gap to the player closes (a no-op while muted — the manager gates output).
    if (this.music && this.musicStarted) {
      const gap = this.chaserY - this.player.y;
      const t = Phaser.Math.Clamp(1 - gap / MUSIC_TENSION_RANGE, 0, 1);
      this.music.setVolume(Phaser.Math.Linear(MUSIC_BASE_VOL, MUSIC_MAX_VOL, t));
    }

    // --- Outcome checks (order matters) ---
    if (this.player.y <= this.summitY) {
      void this.gameOver('win'); // reached the summit — sunlight
      return;
    }
    const camBottom = cam.scrollY + this.scale.height;
    if (this.player.y > camBottom + 200) {
      void this.gameOver('fell'); // dropped off the bottom of the view
    }
  }

  /**
   * Ends the run: submits the result to the daily leaderboard (one attempt per
   * day; the server ignores repeats), then shows the result scene with the
   * returned rank + player count. isGameOver is set synchronously so no further
   * frames or duplicate submissions occur while the request is in flight.
   */
  private async gameOver(outcome: Outcome) {
    if (this.isGameOver) return;
    this.isGameOver = true;

    // Stop the loop immediately (a scene-owned fade would be cut short by the
    // scene transition and keep looping into GameOver).
    this.music?.stop();

    // Death sting for any losing outcome (caught by the ghost, hit by a bat, or
    // fell). Plays on the global sound manager, so it carries into GameOver.
    if (outcome !== 'win') this.playSfx('sfx_caught', SFX_CAUGHT_VOL);

    const finalScore = this.score(); // climbed metres + bat-kill bonus
    let resp: SubmitRunResponse | null = null;
    try {
      const res = await fetch('/api/submit-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ height: finalScore, outcome }),
      });
      if (res.ok) resp = (await res.json()) as SubmitRunResponse;
    } catch {
      // ignore — still show the local result if the submit fails
    }

    this.scene.start('GameOver', {
      outcome,
      height: finalScore,
      bestHeight: resp?.bestHeight ?? finalScore,
      attemptsLeft: resp?.attemptsLeft ?? 0,
      rank: resp?.rank ?? 0,
      totalPlayers: resp?.totalPlayers ?? 0,
      mode: this.mode,
    });
  }
}