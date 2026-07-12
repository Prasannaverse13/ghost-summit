import { Scene } from 'phaser';

export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  init() {
    //  Dark, on-theme loading screen (matches the splash + menu) — no bright
    //  flash between the feed card and the game. Sized from the live viewport
    //  (Scale.RESIZE) rather than fixed coordinates so it stays centred.
    const { width, height } = this.scale;
    const scaleFactor = Math.min(Math.min(width / 1024, height / 768), 1);
    this.cameras.main.setBackgroundColor(0x0d0e17);

    //  Title, matching the gold Arial-Black styling used on the menu.
    this.add
      .text(width / 2, height * 0.4, 'GHOST SUMMIT', {
        fontFamily: 'Arial Black',
        fontSize: '72px',
        color: '#ffcd75',
        stroke: '#000000',
        strokeThickness: 9,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScale(scaleFactor);

    //  Flavour line.
    this.add
      .text(width / 2, height * 0.54, "Loading today's summit…", {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#c7cde8',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScale(scaleFactor);

    //  Progress bar: dark track + gold fill that grows from the left.
    const barW = Math.min(width * 0.7, 460);
    const barH = 16;
    const barY = height * 0.63;
    const barLeft = width / 2 - barW / 2;
    this.add.rectangle(width / 2, barY, barW, barH, 0x23263a).setStrokeStyle(2, 0x3a3f5c);
    const fill = this.add.rectangle(barLeft + 2, barY, 2, barH - 6, 0xffcd75).setOrigin(0, 0.5);

    //  Use the 'progress' event emitted by the LoaderPlugin to grow the fill.
    this.load.on('progress', (progress: number) => {
      fill.width = Math.max(2, (barW - 4) * progress);
    });
  }

  preload() {
    //  Load the assets for the game - Replace with your own assets
    this.load.setPath('../assets');

    this.load.image('logo', 'logo.png');

    //  Player character (Kenney "Platformer Characters" — Adventurer, an
    //  Indiana-Jones-style shooter). Poses are 80x110; the physics body is
    //  resized back to PLAYER_SIZE in Game.ts so collisions are unchanged.
    this.load.image('char_idle', 'adventurer_idle.png');
    this.load.image('char_jump', 'adventurer_jump.png');
    this.load.image('char_walk_a', 'adventurer_walk_a.png');
    this.load.image('char_walk_b', 'adventurer_walk_b.png');

    //  (The bat enemy is drawn in-engine in Game.ts — no sprite to load.)

    //  Sound effects (Kenney "New Platformer Pack"). Each is loaded as OGG +
    //  MP3; Phaser picks the first format the browser supports (OGG on desktop,
    //  MP3 on iOS Safari, which can't decode OGG). Keys are semantic; the source
    //  files keep their original Kenney names. Volumes + a mute toggle live in
    //  Game.ts.
    this.load.audio('sfx_jump', ['sfx_jump.ogg', 'sfx_jump.mp3']);
    this.load.audio('sfx_shoot', ['sfx_throw.ogg', 'sfx_throw.mp3']);
    this.load.audio('sfx_batkill', ['sfx_disappear.ogg', 'sfx_disappear.mp3']);
    this.load.audio('sfx_reload', ['sfx_magic.ogg', 'sfx_magic.mp3']);
    this.load.audio('sfx_caught', ['sfx_hurt.ogg', 'sfx_hurt.mp3']);
    this.load.audio('sfx_land', ['sfx_bump.ogg', 'sfx_bump.mp3']);

    //  Looping background music (horror bed). MP3 plays on every browser
    //  including iOS Safari, so no second format is needed. Started on the first
    //  user interaction and played low, under the SFX (see Game.ts).
    this.load.audio('music_horror', ['music_horror.mp3']);

    //  Grass platform tiles (64x64): rounded caps + middle for floating ledges,
    //  plus a full block for tiling the ground.
    this.load.image('grass_left', 'terrain_grass_horizontal_left.png');
    this.load.image('grass_mid', 'terrain_grass_horizontal_middle.png');
    this.load.image('grass_right', 'terrain_grass_horizontal_right.png');
    this.load.image('grass_block', 'terrain_grass_block.png');

    //  Parallax backdrops (256x256, tileable). One theme is chosen per climb
    //  from the seed. Each theme pairs a solid "sky" layer with a "fade"
    //  silhouette layer.
    this.load.image('bg_sky', 'background_solid_sky.png');
    this.load.image('bg_sand', 'background_solid_sand.png');
    this.load.image('bg_hills', 'background_fade_hills.png');
    this.load.image('bg_trees', 'background_fade_trees.png');
    this.load.image('bg_desert', 'background_fade_desert.png');
    this.load.image('bg_mushrooms', 'background_fade_mushrooms.png');

    //  (The chaser ghost is drawn in-engine in Game.ts — no sprite to load.)
  }

  create() {
    //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
    //  For example, you can define global animations here, so we can use them in other scenes.

    //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
    this.scene.start('MainMenu');
  }
}
