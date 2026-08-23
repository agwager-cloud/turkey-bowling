type LoopKey = 'loginLobby' | 'arcade' | 'ambience';

interface LoopTrack {
  audio: HTMLAudioElement;
  volume: number;
}

// Resolve from the folder containing index.html rather than from an individual
// module URL. This is robust in itch.io's iframe, local Vite and direct builds.
const assetBase = (): URL => new URL('./', document.baseURI || window.location.href);
const asset = (name: string): string => new URL(`audio/${name}`, assetBase()).href;

class AudioDirector {
  private readonly loops: Record<LoopKey, LoopTrack>;
  private readonly activeSfx = new Set<HTMLAudioElement>();
  private currentScene = '';
  private unlocked = false;
  private muted = localStorage.getItem('turkeyBowlingMuted') === '1';

  constructor() {
    this.loops = {
      loginLobby: this.makeLoop(asset('BowlingLoginLobby.mp3'), 0.34),
      arcade: this.makeLoop(asset('hitslab-retro-arcade-game-music-396890.mp3'), 0.11),
      ambience: this.makeLoop(asset('freesound_community-bowling-alley-ambience-56880.mp3'), 0.44)
    };

    // Some embedded browsers reject the very first media play attempt even
    // though it happened during a pointer gesture. Do not permanently mark the
    // audio system as "already unlocked" and then stop trying. Every genuine
    // user gesture is allowed to retry any requested loop that is still paused.
    const resumeFromGesture = () => {
      this.unlocked = true;
      this.syncSceneMix();
    };
    window.addEventListener('pointerdown', resumeFromGesture, { capture: true, passive: true });
    window.addEventListener('click', resumeFromGesture, { capture: true, passive: true });
    window.addEventListener('keydown', resumeFromGesture, { capture: true });

    window.addEventListener('turkey-bowling-sound-change', (event) => {
      this.setMuted((event as CustomEvent<boolean>).detail);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pauseAllLoops();
      else this.syncSceneMix();
    });
  }

  setScene(sceneKey: string): void {
    this.currentScene = sceneKey;
    this.syncSceneMix();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    Object.values(this.loops).forEach(({ audio }) => { audio.muted = muted; });
    this.activeSfx.forEach((audio) => { audio.muted = muted; });
    if (muted) this.pauseAllLoops();
    else {
      // The sound toggle itself is a user gesture, so a later pointer/click event
      // will retry playback immediately even if an embedded browser denied an
      // earlier attempt.
      this.syncSceneMix();
    }
  }

  /** Loud bowling-pin crash. Resolves when the clip has finished. */
  playPinImpact(): Promise<void> {
    return this.playOneShot(asset('freesound_community-bowling-strike-40456.mp3'), 0.96, true);
  }

  /** Strike celebration cheer. Intentionally prominent over the background mix. */
  playCheer(): void {
    void this.playOneShot(asset('cheer.mp3'), 0.88, false);
  }

  /** Spare celebration callout. Matches the strike cheer volume. */
  playSpare(): void {
    void this.playOneShot(asset('nice_spare.mp3'), 0.88, false);
  }

  /** Zero-pin reaction. Matches the cheer/spare callout volume. */
  playZeroPins(): void {
    void this.playOneShot(asset('awww.mp3'), 0.88, false);
  }

  private makeLoop(src: string, volume: number): LoopTrack {
    const audio = new Audio(src);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = volume;
    audio.muted = this.muted;
    return { audio, volume };
  }

  private wantedLoops(): Set<LoopKey> {
    switch (this.currentScene) {
      case 'StartScene':
      case 'LobbyScene':
        return new Set<LoopKey>(['loginLobby']);
      case 'BowlingScene':
        return new Set<LoopKey>(['arcade', 'ambience']);
      case 'MatchupScene':
      case 'MatchResultScene':
      case 'FinalResultsScene':
        return new Set<LoopKey>(['arcade']);
      default:
        return new Set<LoopKey>();
    }
  }

  private syncSceneMix(): void {
    if (!this.unlocked || this.muted || document.hidden) return;
    const wanted = this.wantedLoops();
    (Object.keys(this.loops) as LoopKey[]).forEach((key) => {
      const track = this.loops[key];
      track.audio.volume = track.volume;
      track.audio.muted = false;
      if (wanted.has(key)) {
        if (track.audio.paused) {
          // If the embed/browser declines this attempt, leave it paused. The next
          // user gesture will call syncSceneMix again and retry rather than
          // leaving the game permanently silent.
          void track.audio.play().catch(() => undefined);
        }
      } else if (!track.audio.paused) {
        track.audio.pause();
        track.audio.currentTime = 0;
      }
    });
  }

  private pauseAllLoops(): void {
    Object.values(this.loops).forEach(({ audio }) => audio.pause());
  }

  private playOneShot(src: string, volume: number, waitForEnd: boolean): Promise<void> {
    if (this.muted) return Promise.resolve();

    // Do not gate SFX on our own `unlocked` boolean. Gameplay SFX occur after
    // the player has interacted with the page, and the browser is the authority
    // on whether playback is permitted. The old boolean could suppress every
    // sound forever after one failed unlock attempt.
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = volume;
    audio.muted = false;
    this.activeSfx.add(audio);

    const cleanup = () => {
      this.activeSfx.delete(audio);
      audio.onended = null;
      audio.onerror = null;
    };

    if (!waitForEnd) {
      audio.onended = cleanup;
      audio.onerror = cleanup;
      void audio.play().catch(() => cleanup());
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      void audio.play().catch(finish);
      window.setTimeout(finish, 2400);
    });
  }
}

export const audioDirector = new AudioDirector();
