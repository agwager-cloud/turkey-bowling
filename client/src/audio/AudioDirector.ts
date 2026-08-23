// @ts-nocheck
const asset = (name) => new URL(`./audio/${name}`, window.location.href).href;
class AudioDirector {
    constructor() {
        this.activeSfx = new Set();
        this.currentScene = '';
        this.unlocked = false;
        this.muted = localStorage.getItem('turkeyBowlingMuted') === '1';
        this.loops = {
            loginLobby: this.makeLoop(asset('BowlingLoginLobby.mp3'), 0.34),
            arcade: this.makeLoop(asset('hitslab-retro-arcade-game-music-396890.mp3'), 0.11),
            ambience: this.makeLoop(asset('freesound_community-bowling-alley-ambience-56880.mp3'), 0.44)
        };
        // Browsers require a real user gesture before starting audio. The first tap,
        // click or drag anywhere in the game unlocks the requested scene mix.
        window.addEventListener('pointerdown', () => this.unlock(), { capture: true, passive: true });
        window.addEventListener('turkey-bowling-sound-change', (event) => {
            this.setMuted(event.detail);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden)
                this.pauseAllLoops();
            else
                this.syncSceneMix();
        });
    }
    setScene(sceneKey) {
        this.currentScene = sceneKey;
        this.syncSceneMix();
    }
    setMuted(muted) {
        this.muted = muted;
        Object.values(this.loops).forEach(({ audio }) => { audio.muted = muted; });
        this.activeSfx.forEach((audio) => { audio.muted = muted; });
        if (!muted)
            this.syncSceneMix();
    }
    /** Loud bowling-pin crash. Resolves when the clip has finished. */
    playPinImpact() {
        return this.playOneShot(asset('freesound_community-bowling-strike-40456.mp3'), 0.96, true);
    }
    /** Strike celebration cheer. Intentionally prominent over the background mix. */
    playCheer() {
        void this.playOneShot(asset('cheer.mp3'), 0.88, false);
    }
    /** Spare celebration callout. Matches the strike cheer volume. */
    playSpare() {
        void this.playOneShot(asset('nice_spare.mp3'), 0.88, false);
    }
    /** Zero-pin reaction. Matches the cheer/spare callout volume. */
    playZeroPins() {
        void this.playOneShot(asset('awww.mp3'), 0.88, false);
    }
    makeLoop(src, volume) {
        const audio = new Audio(src);
        audio.loop = true;
        audio.preload = 'auto';
        audio.volume = volume;
        audio.muted = this.muted;
        return { audio, volume };
    }
    unlock() {
        if (this.unlocked)
            return;
        this.unlocked = true;
        this.syncSceneMix();
    }
    wantedLoops() {
        switch (this.currentScene) {
            case 'StartScene':
            case 'LobbyScene':
                return new Set(['loginLobby']);
            case 'BowlingScene':
                return new Set(['arcade', 'ambience']);
            case 'MatchupScene':
            case 'MatchResultScene':
            case 'FinalResultsScene':
                return new Set(['arcade']);
            default:
                return new Set();
        }
    }
    syncSceneMix() {
        if (!this.unlocked || document.hidden)
            return;
        const wanted = this.wantedLoops();
        Object.keys(this.loops).forEach((key) => {
            const track = this.loops[key];
            track.audio.volume = track.volume;
            track.audio.muted = this.muted;
            if (wanted.has(key)) {
                if (track.audio.paused)
                    void track.audio.play().catch(() => undefined);
            }
            else if (!track.audio.paused) {
                track.audio.pause();
                // Returning to a music family later begins that track from the start,
                // while moving Matchups -> Bowling -> Results keeps arcade music continuous.
                track.audio.currentTime = 0;
            }
        });
    }
    pauseAllLoops() {
        Object.values(this.loops).forEach(({ audio }) => audio.pause());
    }
    playOneShot(src, volume, waitForEnd) {
        if (this.muted || !this.unlocked)
            return Promise.resolve();
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = volume;
        audio.muted = this.muted;
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
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done)
                    return;
                done = true;
                cleanup();
                resolve();
            };
            audio.onended = finish;
            audio.onerror = finish;
            void audio.play().catch(finish);
            // Safety guard if a device/browser fails to emit ended/error.
            window.setTimeout(finish, 2400);
        });
    }
}
export const audioDirector = new AudioDirector();
