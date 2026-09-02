import Phaser from 'phaser';
import './styles.css';
import { GAME_BY_ID, GAMES, type GameDefinition } from './games';
import { NetworkClient, type CourtState, type MatchState, type PlayerState, type RoomState } from './network';
import { DodecaAudio, type MusicMode } from './audio';

const DESIGN_W = 1280;
const DESIGN_H = 720;

function esc(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const HEDRON_POINTS = {
  A: [150, 25], B: [550, 25], C: [650, 220], D: [350, 440], E: [50, 220],
  F: [190, 100], G: [350, 135], H: [510, 100], I: [190, 195], J: [350, 205], K: [510, 195],
  L: [275, 240], M: [425, 240], N: [115, 200], O: [235, 325], P: [305, 305], Q: [395, 305],
  R: [465, 325], S: [585, 200], T: [350, 375],
} as const;

type HedronPointKey = keyof typeof HEDRON_POINTS;

const HEDRON_WALLS: ReadonlyArray<readonly [HedronPointKey, HedronPointKey]> = [
  ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'A'],
  ['A', 'F'], ['B', 'H'], ['C', 'S'], ['D', 'T'], ['E', 'N'],
  ['F', 'G'], ['G', 'H'], ['F', 'I'], ['I', 'N'], ['N', 'O'], ['O', 'T'], ['T', 'R'], ['R', 'S'], ['S', 'K'], ['K', 'H'],
  ['G', 'J'], ['K', 'M'], ['R', 'Q'], ['O', 'P'], ['I', 'L'],
  ['J', 'M'], ['M', 'Q'], ['Q', 'P'], ['P', 'L'], ['L', 'J'],
];

const HEDRON_ROOMS: ReadonlyArray<{ value: number; points: readonly HedronPointKey[]; label: readonly [number, number]; ownerLabel?: readonly [number, number] }> = [
  { value: 5, points: ['A', 'B', 'H', 'G', 'F'], label: [350, 75] },
  { value: 9, points: ['A', 'F', 'I', 'N', 'E'], label: [128, 160] },
  { value: 15, points: ['B', 'C', 'S', 'K', 'H'], label: [572, 160] },
  { value: 19, points: ['E', 'N', 'O', 'T', 'D'], label: [110, 232], ownerLabel: [130, 262] },
  { value: 11, points: ['C', 'D', 'T', 'R', 'S'], label: [590, 232], ownerLabel: [570, 262] },
  { value: 13, points: ['F', 'G', 'J', 'L', 'I'], label: [278, 170] },
  { value: 21, points: ['G', 'H', 'K', 'M', 'J'], label: [422, 170] },
  { value: 17, points: ['I', 'L', 'P', 'O', 'N'], label: [252, 265] },
  { value: 7, points: ['K', 'S', 'R', 'Q', 'M'], label: [448, 265] },
  { value: 3, points: ['P', 'Q', 'R', 'T', 'O'], label: [350, 342] },
  { value: 1, points: ['J', 'M', 'Q', 'P', 'L'], label: [350, 258] },
];

class GemBackdrop extends Phaser.Scene {
  create() {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x080b25, 0x111441, 0x06091d, 0x191035, 1);
    bg.fillRect(0, 0, DESIGN_W, DESIGN_H);

    const halo = this.add.graphics();
    halo.fillStyle(0x6d4cff, 0.12);
    halo.fillCircle(220, 120, 260);
    halo.fillStyle(0x12d6e8, 0.09);
    halo.fillCircle(1070, 560, 310);

    for (let i = 0; i < 34; i++) {
      const x = Phaser.Math.Between(-20, DESIGN_W + 20);
      const y = Phaser.Math.Between(-20, DESIGN_H + 20);
      const radius = Phaser.Math.Between(7, 25);
      const sides = Phaser.Math.Between(5, 8);
      const gem = this.add.polygon(x, y, this.makePolygon(radius, sides), 0xffffff, Phaser.Math.FloatBetween(0.025, 0.09));
      gem.setStrokeStyle(1, 0xb9c8ff, Phaser.Math.FloatBetween(0.05, 0.16));
      this.tweens.add({
        targets: gem,
        y: y + Phaser.Math.Between(-24, 24),
        angle: Phaser.Math.Between(-25, 25),
        alpha: Phaser.Math.FloatBetween(0.15, 0.55),
        duration: Phaser.Math.Between(5000, 10000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
  }

  private makePolygon(radius: number, sides: number) {
    const points: number[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
      points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    return points;
  }
}

class StableStage {
  private stage: HTMLElement;
  private keyboardActive = false;
  private resizeQueued?: number;

  constructor(stage: HTMLElement) {
    this.stage = stage;
    this.update = this.update.bind(this);
    this.onFocusIn = this.onFocusIn.bind(this);
    this.onFocusOut = this.onFocusOut.bind(this);
    window.addEventListener('resize', this.update);
    window.addEventListener('orientationchange', this.update);
    window.visualViewport?.addEventListener('resize', this.update);
    document.addEventListener('focusin', this.onFocusIn);
    document.addEventListener('focusout', this.onFocusOut);
    this.update();
  }

  private onFocusIn(event: FocusEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      this.keyboardActive = true;
      document.body.classList.add('keyboard-active');
    }
  }

  private onFocusOut() {
    window.clearTimeout(this.resizeQueued);
    this.resizeQueued = window.setTimeout(() => {
      this.keyboardActive = false;
      document.body.classList.remove('keyboard-active');
      this.update();
    }, 320);
  }

  update() {
    if (this.keyboardActive) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(width / DESIGN_W, height / DESIGN_H);
    const left = (width - DESIGN_W * scale) / 2;
    const top = (height - DESIGN_H * scale) / 2;
    this.stage.style.setProperty('--stage-scale', String(scale));
    this.stage.style.left = `${left}px`;
    this.stage.style.top = `${top}px`;
    document.body.classList.toggle('portrait-device', height > width);
  }
}

type NetStatus = 'connecting' | 'online' | 'offline';

class DodecaApp {
  private stage: HTMLElement;
  private ui: HTMLElement;
  private network: NetworkClient;
  private audio: DodecaAudio;
  private room?: RoomState;
  private meId?: string;
  private isHost = false;
  private status: NetStatus = 'connecting';
  private statusDetail = 'Connecting…';
  private forcedMatchupView = false;
  private forcedMatchupMatchId?: string;
  private spectatingMatchId?: string;
  private spectatorAutoReturnOnOwnMatch = false;
  private loginPending = false;
  private courtViewIndex = 0;
  private courtViewInitialized = false;
  private courtFocusKey = '';
  private courtScrollLeft = 0;
  private courtScrollInitialized = false;
  private courtScrollLockUntil = 0;
  private courtDeferredRenderTimer?: number;
  private toastTimer?: number;
  private dynamicTimer?: number;
  private resultRevealTimer?: number;
  private disconnectCountdownTimer?: number;
  private serverClockOffset = 0;
  private threeHexSelectedFrom?: number;
  private fourStarSelectedFrom?: number;
  private spiralSelectedCounter?: number;
  private multiSelectedToken?: 0 | 1;
  private crayDeepDraft = 0;
  private crayShopBoatDraft = 0;
  private crayShopPotDraft = 0;
  private crayShopSellBoatDraft = 0;
  private crayDraftKey = '';
  private bannedNameNotice?: { name: string; roomCode?: string };
  private presenceRepairAt = 0;

  constructor() {
    const root = document.querySelector<HTMLDivElement>('#app')!;
    root.innerHTML = `
      <div id="stage" class="stage">
        <div id="phaser-bg" class="phaser-bg"></div>
        <div id="ui" class="ui-layer"></div>
        <div id="toast" class="toast" aria-live="polite"></div>
        <button id="sound-toggle" class="sound-toggle sound-start" type="button" aria-label="Mute sound" aria-pressed="false">
          <span class="sound-toggle-icon" aria-hidden="true">🔊</span><span class="sound-toggle-copy">SOUND ON</span>
        </button>
      </div>
      <div class="rotate-overlay">
        <div class="rotate-gem">◆</div>
        <h2>Rotate to landscape</h2>
        <p>Dodeca-Gems is designed for a 16:9 landscape game screen.</p>
      </div>`;
    this.stage = document.querySelector<HTMLElement>('#stage')!;
    this.ui = document.querySelector<HTMLElement>('#ui')!;
    new StableStage(this.stage);

    this.audio = new DodecaAudio(() => this.updateSoundButton());
    this.stage.querySelector('#sound-toggle')?.addEventListener('click', () => this.audio.toggleMuted());
    this.stage.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('#manage-players') : null;
      if (target && this.isHost && this.room) this.openManagePlayers();
    });
    this.updateSoundButton();

    new Phaser.Game({
      type: Phaser.AUTO,
      width: DESIGN_W,
      height: DESIGN_H,
      parent: 'phaser-bg',
      transparent: true,
      audio: { noAudio: true },
      scene: [GemBackdrop],
      render: { antialias: true, roundPixels: false },
    });

    this.network = new NetworkClient({
      onStatus: (status, detail) => {
        this.status = status;
        this.statusDetail = detail || '';
        this.render();
      },
      onJoined: (session) => {
        this.loginPending = false;
        this.meId = session.playerId;
        this.isHost = session.isHost;
        this.bannedNameNotice = undefined;
      },
      onRoomState: (room) => {
        this.serverClockOffset = (room.serverTime || Date.now()) - Date.now();
        this.threeHexSelectedFrom = undefined;
        this.fourStarSelectedFrom = undefined;
        this.spiralSelectedCounter = undefined;
        this.multiSelectedToken = undefined;
        this.room = room;
        if (this.spectatingMatchId && !room.courts.some((court) => court.activeMatch?.id === this.spectatingMatchId)) {
          this.spectatingMatchId = undefined;
          this.spectatorAutoReturnOnOwnMatch = false;
          const ownMatch = this.currentMatchFor(this.meId);
          this.forcedMatchupView = Boolean(ownMatch);
          this.forcedMatchupMatchId = ownMatch?.match.id;
        }
        if (this.spectatingMatchId && this.spectatorAutoReturnOnOwnMatch) {
          const ownLive = this.activeMatchFor(this.meId);
          if (ownLive && ownLive.match.id !== this.spectatingMatchId) {
            this.spectatingMatchId = undefined;
            this.spectatorAutoReturnOnOwnMatch = false;
            this.forcedMatchupView = false;
            this.forcedMatchupMatchId = undefined;
            this.courtViewIndex = ownLive.court.index;
            this.courtViewInitialized = true;
          }
        }
        const session = this.network.session;
        if (session) {
          this.meId = session.playerId;
          this.isHost = session.isHost;
        }

        // A connected browser should never receive a room snapshot that marks
        // its own player identity offline. If that ever happens (for example
        // after an iPad socket replacement race), immediately repair/resume the
        // session instead of leaving the student greyed out while the UI still
        // appears connected. Cooldown prevents a reconnect loop on bad networks.
        const me = this.meId ? room.players.find((player) => player.id === this.meId) : undefined;
        if (me && !me.connected && this.network.isOnline() && Date.now() - this.presenceRepairAt > 4000) {
          this.presenceRepairAt = Date.now();
          this.network.repairRoomSession();
          return;
        }

        if (room.phase === 'lobby') {
          this.forcedMatchupView = false;
          this.forcedMatchupMatchId = undefined;
          this.spectatingMatchId = undefined;
          this.spectatorAutoReturnOnOwnMatch = false;
          this.courtViewIndex = 0;
          this.courtViewInitialized = false;
          this.courtFocusKey = '';
          this.courtScrollLeft = 0;
          this.courtScrollInitialized = false;
        }
        // A host may deliberately open the class Matchups overview during an
        // active match. That choice belongs only to that specific match. Once a
        // NEW host matchup is created, the old overview must not suppress the
        // new game (otherwise a timed or turn-based match can be stranded on Matchups).
        const ownLiveNow = this.activeMatchFor(this.meId);
        if (this.isHost && ownLiveNow && this.forcedMatchupView && this.forcedMatchupMatchId !== ownLiveNow.match.id) {
          this.forcedMatchupView = false;
          this.forcedMatchupMatchId = undefined;
          this.courtViewIndex = ownLiveNow.court.index;
          this.courtViewInitialized = true;
          this.courtFocusKey = '';
          this.courtScrollLeft = 0;
          this.courtScrollInitialized = false;
        }

        if (this.ui.querySelector('.matchup-screen') && Date.now() < this.courtScrollLockUntil) {
          if (this.courtDeferredRenderTimer) window.clearTimeout(this.courtDeferredRenderTimer);
          this.courtDeferredRenderTimer = window.setTimeout(() => {
            this.courtDeferredRenderTimer = undefined;
            this.render();
          }, Math.max(40, this.courtScrollLockUntil - Date.now() + 30));
          return;
        }
        this.render();
      },
      onError: (message) => {
        if (!this.room) {
          this.loginPending = false;
          this.setLoginButtonsPending(false);
        }
        this.showToast(message, true);
      },
      onKicked: (message, bannedName, roomCode) => {
        const previousName = bannedName || this.me?.name || '';
        const previousRoom = roomCode || this.room?.code;
        this.bannedNameNotice = previousName ? { name: previousName, roomCode: previousRoom } : undefined;
        this.room = undefined;
        this.meId = undefined;
        this.isHost = false;
        this.showToast(message, true);
        this.render();
      },
      onResumeFailed: () => {
        this.room = undefined;
        this.meId = undefined;
        this.isHost = false;
        this.showToast('Previous room could not be restored. You can host or join again.');
        this.render();
      },
    });

    this.dynamicTimer = window.setInterval(() => this.updateCountdowns(), 100);
    this.render();
    this.network.start();
  }

  private get me() {
    return this.room?.players.find((p) => p.id === this.meId);
  }

  private get selectedGame(): GameDefinition {
    return GAME_BY_ID.get(this.room?.selectedGameId || '') || GAMES[0];
  }

  private currentMatchFor(playerId?: string): { court: CourtState; match: MatchState } | undefined {
    if (!this.room || !playerId) return undefined;
    for (const court of this.room.courts) {
      if (court.activeMatch?.playerIds.includes(playerId)) return { court, match: court.activeMatch };
    }
    return undefined;
  }

  private activeMatchFor(playerId?: string): { court: CourtState; match: MatchState } | undefined {
    const current = this.currentMatchFor(playerId);
    if (!current || !['countdown', 'playing'].includes(current.match.status)) return undefined;
    return current;
  }

  private canWatchLiveMatch(match?: MatchState) {
    if (!match || !['countdown', 'playing'].includes(match.status)) return false;
    if (this.meId && match.playerIds.includes(this.meId)) return true;
    // Nobody spectates over the top of their own live match. Hosts who want to
    // watch freely can use OPT OUT on the Matchups screen.
    return !this.activeMatchFor(this.meId);
  }

  private currentCourtFor(playerId?: string) {
    if (!this.room || !playerId) return undefined;
    return this.room.courts.find((court) => court.activeMatch?.playerIds.includes(playerId) || court.waiting.includes(playerId));
  }

  private player(id: string) {
    return this.room?.players.find((p) => p.id === id);
  }

  private winnerOverlayReady(resultRevealAt?: number) {
    if (!resultRevealAt) return true;
    const remaining = resultRevealAt - (Date.now() + this.serverClockOffset);
    if (remaining > 0) {
      if (this.resultRevealTimer) window.clearTimeout(this.resultRevealTimer);
      this.resultRevealTimer = window.setTimeout(() => this.render(), remaining + 30);
      return false;
    }
    return true;
  }

  private render() {
    if (this.disconnectCountdownTimer) { window.clearTimeout(this.disconnectCountdownTimer); this.disconnectCountdownTimer = undefined; }
    this.ui.classList.remove('spectator-active', 'player-turn-active');
    if (this.network.session && !this.room) {
      this.renderRestoring();
      this.syncAudioForView('lobby');
      return;
    }
    if (!this.room) {
      this.renderStart();
      this.syncAudioForView('lobby');
      return;
    }
    if (this.room.phase === 'lobby') {
      this.renderLobby();
      this.syncAudioForView('lobby');
      this.renderRoomConnectionWarning();
      return;
    }

    const current = this.currentMatchFor(this.meId);
    if (this.room.phase === 'playing' && this.spectatingMatchId) {
      const watched = this.room.courts.find((court) => court.activeMatch?.id === this.spectatingMatchId);
      if (watched?.activeMatch && ['countdown', 'playing'].includes(watched.activeMatch.status)) {
        this.renderGameShell(watched, watched.activeMatch);
        this.decorateSpectatorView(watched, watched.activeMatch);
        this.syncAudioForView('game', watched.activeMatch);
        this.renderRoomConnectionWarning();
        return;
      }
      this.spectatingMatchId = undefined;
      this.spectatorAutoReturnOnOwnMatch = false;
      this.forcedMatchupView = Boolean(current);
    }

    if (this.room.phase === 'playing' && current && ['countdown', 'playing'].includes(current.match.status) && !this.forcedMatchupView) {
      this.renderGameShell(current.court, current.match);
      this.updatePlayerTurnEdgeGlow(current.match);
      this.syncAudioForView('game', current.match);
      this.renderRoomConnectionWarning();
      return;
    }
    this.renderMatchups();
    this.syncAudioForView('game', current?.match);
    this.renderRoomConnectionWarning();
  }

  private updatePlayerTurnEdgeGlow(match: MatchState) {
    if (!this.meId || this.spectatingMatchId || match.status !== 'playing' || match.disconnectPause || !match.playerIds.includes(this.meId)) {
      this.ui.classList.remove('player-turn-active');
      return;
    }

    // Craypots has simultaneous decision phases rather than a turnPlayerId.
    // Glow only while this player still has an action to submit.
    if (match.craypots) {
      const me = match.craypots.players[this.meId];
      const needsAction = Boolean(me && (
        (match.craypots.phase === 'placing' && !me.placementLocked) ||
        (match.craypots.phase === 'shopping' && !me.shopLocked)
      ));
      this.ui.classList.toggle('player-turn-active', needsAction);
      return;
    }

    const state = match.threeHexagon
      || match.fourStar
      || match.boxes
      || match.neverTouch
      || match.spiral
      || match.hex
      || match.factorGame
      || match.hedron
      || match.multi
      || match.ultimateTtt
      || match.luckyThirteen;

    const isMyTurn = Boolean(state && state.turnPlayerId === this.meId && !['won', 'tied'].includes(state.phase));
    this.ui.classList.toggle('player-turn-active', isMyTurn);
  }

  private renderRoomConnectionWarning() {
    if (!this.room || this.status === 'online') return;
    const detail = this.status === 'connecting' ? 'Rejoining your room…' : 'Connection interrupted — reconnecting automatically…';
    this.ui.insertAdjacentHTML('beforeend', `<div class="room-network-warning" aria-live="assertive"><span class="spinner-gem small">◆</span><div><strong>${esc(detail)}</strong><small>Your place and live match are being preserved. Do not re-enter the room code unless recovery fails.</small></div></div>`);
  }

  private watchMatch(court: CourtState) {
    const match = court.activeMatch;
    if (!this.canWatchLiveMatch(match) || !match) return;
    if (this.meId && match.playerIds.includes(this.meId)) {
      this.spectatingMatchId = undefined;
      this.spectatorAutoReturnOnOwnMatch = false;
      this.forcedMatchupView = false;
      this.forcedMatchupMatchId = undefined;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.render();
      return;
    }
    const ownLiveAtStart = this.activeMatchFor(this.meId);
    this.threeHexSelectedFrom = undefined;
    this.fourStarSelectedFrom = undefined;
    this.spiralSelectedCounter = undefined;
    this.multiSelectedToken = undefined;
    this.spectatingMatchId = match.id;
    this.spectatorAutoReturnOnOwnMatch = !ownLiveAtStart;
    this.forcedMatchupView = true;
    this.forcedMatchupMatchId = ownLiveAtStart?.match.id;
    this.courtViewIndex = court.index;
    this.courtViewInitialized = true;
    this.courtScrollLeft = 0;
    this.courtScrollInitialized = false;
    this.render();
  }

  private decorateSpectatorView(court: CourtState, match: MatchState) {
    if (!this.room || this.spectatingMatchId !== match.id) return;
    this.ui.classList.add('spectator-active');
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const ownMatch = this.currentMatchFor(this.meId);
    this.ui.insertAdjacentHTML('beforeend', `
      <div class="spectator-live-bar" aria-live="polite">
        <div class="spectator-live-copy">
          <span class="spectator-live-badge"><i></i> SPECTATING LIVE</span>
          <strong>${esc(a?.name || 'Player 1')} <em>vs</em> ${esc(b?.name || 'Player 2')}</strong>
          <small>${esc(this.selectedGame.title)} • ${esc(courtLabel)} • server-synchronised read-only view</small>
        </div>
        <div class="spectator-live-actions">
          <button id="spectator-instructions" class="mini-btn">Instructions</button>
          <button id="spectator-back" class="secondary-btn small-btn">← Back to Matchups</button>
          ${ownMatch && ownMatch.match.id !== match.id ? '<button id="spectator-return-mine" class="primary-btn small-btn">Return to My Match →</button>' : ''}
        </div>
      </div>`);
    this.ui.querySelector('#spectator-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#spectator-back')?.addEventListener('click', () => {
      this.spectatingMatchId = undefined;
      this.spectatorAutoReturnOnOwnMatch = false;
      const ownMatch = this.currentMatchFor(this.meId);
      this.forcedMatchupView = Boolean(ownMatch);
      this.forcedMatchupMatchId = ownMatch?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#spectator-return-mine')?.addEventListener('click', () => {
      this.spectatingMatchId = undefined;
      this.spectatorAutoReturnOnOwnMatch = false;
      this.forcedMatchupView = false;
      this.forcedMatchupMatchId = undefined;
      const mine = this.currentMatchFor(this.meId);
      if (mine) {
        this.courtViewIndex = mine.court.index;
        this.courtViewInitialized = true;
      }
      this.render();
    });
  }

  private syncAudioForView(mode: MusicMode, match?: MatchState) {
    this.audio.setMode(mode);
    if (mode === 'game' && match?.status === 'countdown') this.audio.playMatchupCue(match.id);
    else this.audio.stopMatchupCue();
    this.updateSoundButton(mode);
  }

  private updateSoundButton(mode?: MusicMode) {
    const button = this.stage.querySelector<HTMLButtonElement>('#sound-toggle');
    if (!button) return;
    const muted = this.audio.isMuted();
    const currentMode: MusicMode = mode || (!this.room || this.room.phase === 'lobby' ? 'lobby' : 'game');
    button.classList.toggle('sound-start', !this.room);
    button.classList.toggle('sound-lobby', Boolean(this.room && this.room.phase === 'lobby'));
    button.classList.toggle('sound-game', currentMode === 'game');
    button.classList.toggle('muted', muted);
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
    const icon = button.querySelector<HTMLElement>('.sound-toggle-icon');
    const copy = button.querySelector<HTMLElement>('.sound-toggle-copy');
    if (icon) icon.textContent = muted ? '🔇' : '🔊';
    if (copy) copy.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  }

  private logoMarkup(compact = false) {
    return `
      <div class="brand ${compact ? 'brand-compact' : ''}">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 100 100">
            <polygon points="50,4 71,10 88,25 96,47 90,69 75,88 52,97 29,90 11,74 4,52 10,29 27,11" />
            <path d="M50 4 L50 50 L96 47 M10 29 L50 50 L29 90 M88 25 L50 50 L11 74 M75 88 L50 50 L27 11" />
          </svg>
        </div>
        <div>
          <div class="brand-title">DODECA<span>-GEMS</span></div>
          ${compact ? '' : '<div class="brand-subtitle">TWELVE GAMES • ONE COURT • KEEP MOVING RIGHT</div>'}
        </div>
      </div>`;
  }

  private statusMarkup() {
    const online = this.status === 'online';
    return `<div class="server-status ${online ? 'online' : ''}">
      <span class="status-dot"></span>
      <div>
        <strong>${online ? 'Server ready' : 'Connecting to game server'}</strong>
        <span>${online
          ? 'Ready to host or join.'
          : 'A free hosted server can take up to 60 seconds to wake. Dodeca-Gems keeps retrying and does not time out.'}</span>
      </div>
    </div>`;
  }

  private renderRestoring() {
    this.ui.innerHTML = `
      <section class="screen start-screen">
        <div class="restore-card glass-card">
          <div class="spinner-gem">◆</div>
          <h2>Restoring your room…</h2>
          <p>${esc(this.statusDetail || 'Reconnecting automatically. Dodeca-Gems will keep trying without timing out.')}</p>
        </div>
      </section>`;
  }

  private renderStart() {
    const disabled = !this.network.isOnline() || this.loginPending ? 'disabled' : '';
    this.ui.innerHTML = `
      <section class="screen start-screen">
        <div class="login-card glass-card">
          <div class="login-heading">
            <span class="eyebrow">CLASSROOM LOGIN</span>
            <h2>Enter the Gem Court</h2>
          </div>
          ${this.bannedNameNotice ? `<div class="banned-name-warning"><strong>NAME BANNED FOR THIS ROOM</strong><span>The host removed <b>${esc(this.bannedNameNotice.name)}</b>. You must choose a different player name before rejoining${this.bannedNameNotice.roomCode ? ` room <b>${esc(this.bannedNameNotice.roomCode)}</b>` : ''}.</span></div>` : ''}
          <label class="field-label" for="player-name">PLAYER NAME</label>
          <input id="player-name" class="text-input" maxlength="22" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Enter your name" />
          <label class="field-label room-label" for="room-code">ROOM CODE <span>5 digits</span></label>
          <input id="room-code" class="text-input room-input" maxlength="5" inputmode="numeric" pattern="[0-9]*" autocomplete="off" spellcheck="false" placeholder="12345" value="${esc(this.bannedNameNotice?.roomCode || '')}" />
          <div class="login-actions">
            <button id="host-btn" class="primary-btn" ${disabled}><span>◆</span> Host Game</button>
            <button id="join-btn" class="secondary-btn" ${disabled}>Join Room <span>→</span></button>
          </div>
          ${this.statusMarkup()}
        </div>
      </section>`;

    const nameInput = this.ui.querySelector<HTMLInputElement>('#player-name')!;
    const roomInput = this.ui.querySelector<HTMLInputElement>('#room-code')!;
    roomInput.addEventListener('input', () => {
      roomInput.value = roomInput.value.replace(/\D/g, '').slice(0, 5);
    });
    const submitHost = () => {
      const name = nameInput.value.trim();
      if (!name) return this.showToast('Enter your name first.', true);
      this.loginPending = true;
      this.setLoginButtonsPending(true);
      this.network.hostRoom(name);
    };
    const submitJoin = () => {
      const name = nameInput.value.trim();
      const code = roomInput.value.trim();
      if (!name) return this.showToast('Enter your name first.', true);
      if (!/^\d{5}$/.test(code)) return this.showToast('Enter the five-digit room code.', true);
      if (this.bannedNameNotice && code === this.bannedNameNotice.roomCode && name.trim().toLocaleLowerCase() === this.bannedNameNotice.name.trim().toLocaleLowerCase()) {
        return this.showToast(`The name “${this.bannedNameNotice.name}” was banned by the host. Choose a different name.`, true);
      }
      this.loginPending = true;
      this.setLoginButtonsPending(true);
      this.network.joinRoom(name, code);
    };
    this.ui.querySelector('#host-btn')?.addEventListener('click', submitHost);
    this.ui.querySelector('#join-btn')?.addEventListener('click', submitJoin);
    roomInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitJoin();
    });
  }


  private setLoginButtonsPending(pending: boolean) {
    const host = this.ui.querySelector<HTMLButtonElement>('#host-btn');
    const join = this.ui.querySelector<HTMLButtonElement>('#join-btn');
    if (host) {
      host.disabled = pending || !this.network.isOnline();
      host.innerHTML = pending ? '<span>◆</span> Logging in…' : '<span>◆</span> Host Game';
    }
    if (join) {
      join.disabled = pending || !this.network.isOnline();
      join.innerHTML = pending ? 'Please wait…' : 'Join Room <span>→</span>';
    }
  }

  private renderLobby() {
    if (!this.room) return;
    const studentCount = this.room.players.filter((p) => !p.isHost && !p.isBot).length;
    const canStart = this.isHost;
    this.ui.innerHTML = `
      <section class="screen lobby-screen">
        <header class="topbar">
          ${this.logoMarkup(true)}
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
          <div class="topbar-status"><span class="status-dot"></span>${this.room.players.length}/40 connected</div>
        </header>

        <section class="game-select-panel glass-card">
          <div class="section-title-row">
            <div>
              <span class="eyebrow">HOST GAME SELECTION</span>
              <h2>Choose one of the twelve gems</h2>
            </div>
            <button id="lobby-instructions" class="mini-btn">How to Play</button>
          </div>
          <div class="game-carousel-wrap">
            <button id="game-left" class="carousel-arrow left" aria-label="Previous game">‹</button>
            <div id="game-carousel" class="game-carousel">
              <div id="game-track" class="game-track">
                ${GAMES.map((game, index) => this.gameTileMarkup(game, index)).join('')}
              </div>
            </div>
            <button id="game-right" class="carousel-arrow right" aria-label="Next game">›</button>
          </div>
          <div class="selected-game-line">
            <span class="gem-chip">${esc(this.selectedGame.symbol)}</span>
            <div class="selected-game-copy"><strong>${esc(this.selectedGame.title)}</strong><span>${esc(this.selectedGame.tagline)}</span></div>
            <span class="default-timer-hint">Default: ${esc(this.selectedGame.decisionTime)}</span>
            ${this.isHost
              ? `<div class="turn-timer-control" aria-label="Turn timer setting"><span>TURN TIMER</span><button id="timer-minus" type="button" aria-label="Reduce turn timer">−</button><input id="turn-seconds" type="number" inputmode="numeric" min="1" max="120" step="1" value="${this.room.turnSeconds}" aria-label="Turn timer seconds" /><button id="timer-plus" type="button" aria-label="Increase turn timer">+</button><b>SEC</b></div>`
              : `<div class="turn-timer-readonly">⏱ ${this.room.turnSeconds}s per decision</div>`}
          </div>
        </section>

        <section class="player-panel glass-card">
          <div class="player-panel-head">
            <div><span class="eyebrow">PLAYERS</span><strong>${this.room.players.length} / 40</strong></div>
            <span>${this.isHost ? 'Tap × to remove a student' : 'Waiting for the host to start'}</span>
          </div>
          <div class="player-grid">
            ${this.room.players.map((player) => this.playerRowMarkup(player)).join('')}
          </div>
        </section>

        <footer class="lobby-footer">
          <div class="host-participation-note">${studentCount === 0
            ? 'Solo testing: the host will be paired against Gem Bot. You can Opt Out on the Matchups screen.'
            : 'The host enters the ladder by default. Use Opt Out on the Matchups screen to spectate only; Gem Bot automatically fills parity when required.'}</div>
          ${this.isHost
            ? `<button id="start-game-btn" class="primary-btn start-game-btn" ${canStart ? '' : 'disabled'}>Create Matchups <span>→</span></button>`
            : '<div class="waiting-chip"><span class="pulse-dot"></span> Waiting for host</div>'}
        </footer>
      </section>`;

    this.bindLobbyCarousel();
    this.bindTurnTimerControls();
    this.ui.querySelector('#lobby-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#start-game-btn')?.addEventListener('click', () => this.network.send({ type: 'prepare-matchups' }));
    this.ui.querySelectorAll<HTMLElement>('[data-kick-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.kickId;
        if (id) this.network.send({ type: 'kick-player', playerId: id });
      });
    });
  }

  private gameTileMarkup(game: GameDefinition, index: number) {
    const selected = game.id === this.room?.selectedGameId;
    return `<button class="game-tile ${selected ? 'selected' : ''}" data-game-index="${index}" ${this.isHost ? '' : 'aria-disabled="true"'}>
      <span class="game-number">${String(index + 1).padStart(2, '0')}</span>
      <span class="game-symbol">${esc(game.symbol)}</span>
      <strong>${esc(game.shortTitle)}</strong>
      <small>${esc(game.tagline)}</small>
    </button>`;
  }

  private playerRowMarkup(player: PlayerState) {
    const leader = this.isChampLeader(player);
    return `<div class="player-row ${player.isHost ? 'host' : ''} ${!player.connected ? 'disconnected' : ''} ${leader ? 'crown-leader' : ''}">
      <span class="player-status-dot"></span>
      <span class="player-name">${leader ? '👑 ' : ''}${esc(player.name)}</span>
      ${player.isHost ? '<span class="host-badge">HOST</span>' : player.isBot ? '<span class="host-badge bot-badge">BOT</span>' : ''}
      ${player.points > 0 ? `<span class="wins-badge">${player.points}</span>` : ''}
      ${this.isHost && !player.isHost && !player.isBot ? `<button class="kick-x" data-kick-id="${esc(player.id)}" title="Remove player" aria-label="Remove ${esc(player.name)}">×</button>` : ''}
    </div>`;
  }

  private bindTurnTimerControls() {
    if (!this.room || !this.isHost) return;
    const input = this.ui.querySelector<HTMLInputElement>('#turn-seconds');
    if (!input) return;

    const send = (value: number) => {
      const seconds = clamp(Math.round(Number(value) || this.room!.turnSeconds), 1, 120);
      input.value = String(seconds);
      this.network.send({ type: 'set-turn-seconds', seconds });
    };

    this.ui.querySelector('#timer-minus')?.addEventListener('click', () => send(Number(input.value) - 1));
    this.ui.querySelector('#timer-plus')?.addEventListener('click', () => send(Number(input.value) + 1));
    input.addEventListener('change', () => send(Number(input.value)));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  private bindLobbyCarousel() {
    if (!this.room) return;
    let selectedIndex = Math.max(0, GAMES.findIndex((g) => g.id === this.room!.selectedGameId));
    const carousel = this.ui.querySelector<HTMLElement>('#game-carousel')!;
    const focusSelected = (smooth = true) => {
      const tile = this.ui.querySelector<HTMLElement>(`[data-game-index="${selectedIndex}"]`);
      tile?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
    };
    requestAnimationFrame(() => focusSelected(false));

    const select = (index: number) => {
      selectedIndex = (index + GAMES.length) % GAMES.length;
      focusSelected();
      if (this.isHost) this.network.send({ type: 'select-game', gameId: GAMES[selectedIndex].id });
    };
    this.ui.querySelector('#game-left')?.addEventListener('click', () => select(selectedIndex - 1));
    this.ui.querySelector('#game-right')?.addEventListener('click', () => select(selectedIndex + 1));
    this.ui.querySelectorAll<HTMLElement>('[data-game-index]').forEach((tile) => {
      tile.addEventListener('click', () => {
        const index = Number(tile.dataset.gameIndex);
        if (this.isHost) select(index);
      });
    });

    let touchX = 0;
    carousel.addEventListener('touchstart', (event) => { touchX = event.changedTouches[0].clientX; }, { passive: true });
    carousel.addEventListener('touchend', (event) => {
      const dx = event.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) < 45) return;
      select(selectedIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  private renderMatchups() {
    if (!this.room) return;
    const existingViewport = this.ui.querySelector<HTMLElement>('#court-viewport');
    // Only preserve a position after the carousel has completed its first real
    // layout. Capturing scrollLeft=0 from a previous render before that happens
    // races the intended Championship focus and was sending hosts to the
    // left-most desk on busy room-state updates.
    if (existingViewport && this.courtScrollInitialized) {
      this.courtScrollLeft = existingViewport.scrollLeft;
    }
    const myCourt = this.currentCourtFor(this.meId);
    const current = this.currentMatchFor(this.meId);
    const lateJoinWaiting = Boolean(this.meId && this.room.lateJoinQueue?.includes(this.meId));
    const hostOptedIn = this.room.hostOptedIn !== false;
    const lastCourtIndex = Math.max(0, this.room.courts.length - 1);

    // Matchup focus has one unambiguous owner:
    //   • participating host -> the host's own court
    //   • opted-out host     -> Championship (far right)
    //   • student            -> their own court
    // The focus key changes only when that target changes, so normal room-state
    // updates cannot make the carousel fight between two positions. Manual
    // scrolling is still preserved for the remainder of the same matchup.
    const preferredCourtIndex = this.isHost
      ? (hostOptedIn && myCourt ? myCourt.index : lastCourtIndex)
      : (myCourt ? myCourt.index : lastCourtIndex);
    const preferredFocusKey = this.isHost
      ? (hostOptedIn && myCourt
          ? `host:${current?.match.id || `waiting-${myCourt.index}`}`
          : `championship:${this.room.courts.length}`)
      : `player:${current?.match.id || (myCourt ? `waiting-${myCourt.index}` : `fallback-${this.room.courts.length}`)}`;

    if (preferredFocusKey !== this.courtFocusKey) {
      this.courtFocusKey = preferredFocusKey;
      this.courtViewIndex = preferredCourtIndex;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
    } else if (!this.courtViewInitialized) {
      this.courtViewIndex = preferredCourtIndex;
      this.courtViewInitialized = true;
    }
    this.courtViewIndex = clamp(this.courtViewIndex, 0, lastCourtIndex);

    this.ui.innerHTML = `
      <section class="screen matchup-screen">
        <header class="topbar match-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>${esc(this.selectedGame.symbol)}</span><div><small>CURRENT GAME</small><strong>${esc(this.selectedGame.title)}</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <div class="matchup-toolbar">
          <div class="rank-explainer"><strong>King of the Court</strong><span>Win → +1 point & move right • Lose → move left • 👑 = current championship winner</span></div>
          <div class="toolbar-actions">
            <button id="match-instructions" class="mini-btn">Instructions</button>
            ${this.isHost ? `<button id="host-participation" class="host-participation-toggle ${hostOptedIn ? 'opt-out' : 'opt-in'}" title="${hostOptedIn ? 'Stop playing and spectate only' : 'Rejoin from the lowest court'}">${hostOptedIn ? '◌ OPT OUT' : '▶ OPT IN'}</button>` : ''}
            ${this.isHost ? '<button id="manage-players" class="mini-btn manage-btn">Manage Players</button>' : ''}
            ${this.isHost && current && this.forcedMatchupView ? '<button id="return-my-match" class="mini-btn accent">Return to My Match</button>' : ''}
          </div>
        </div>

        <div class="court-carousel-wrap">
          <button id="court-left" class="court-arrow">‹</button>
          <div id="court-viewport" class="court-viewport">
            <div id="court-track" class="court-track">
              ${this.room.courts.map((court) => this.courtCardMarkup(court, myCourt?.index === court.index)).join('')}
            </div>
          </div>
          <button id="court-right" class="court-arrow">›</button>
        </div>

        <div class="matchup-bottom">
          <div class="standing-strip">${this.standingStripMarkup()}</div>
          <div class="match-buttons">
            ${this.isHost && this.room.phase === 'matchups' ? '<button id="begin-btn" class="primary-btn">Begin Matchups <span>→</span></button>' : ''}
            ${this.isHost ? '<button id="return-lobby" class="danger-outline-btn">Return to Lobby</button>' : ''}
            ${!this.isHost && this.room.phase === 'matchups' ? `<div class="waiting-chip"><span class="pulse-dot"></span> ${lateJoinWaiting ? 'Late join — spectating until a safe matchup opens' : 'Host will begin the matches'}</div>` : ''}
            ${!current && this.room.phase === 'playing' ? `<div class="waiting-chip"><span class="pulse-dot"></span> ${lateJoinWaiting ? 'Late join — tap any LIVE court to spectate while you wait' : 'Waiting for your next opponent — tap any LIVE court to spectate'}</div>` : ''}
          </div>
        </div>
      </section>`;

    this.bindCourtCarousel();
    this.bindStandingCarousel();
    this.ui.querySelector('#match-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#host-participation')?.addEventListener('click', () => {
      const optingOut = hostOptedIn;
      const mine = this.activeMatchFor(this.meId);
      if (optingOut && mine) {
        const opponentId = mine.match.playerIds.find((id) => id !== this.meId);
        const opponentName = this.player(opponentId || '')?.name || 'Your opponent';
        if (!window.confirm(`Opt out now? ${opponentName} will receive the win for this match.`)) return;
      }
      this.spectatingMatchId = undefined;
      this.spectatorAutoReturnOnOwnMatch = false;
      // OPT OUT stays on the overview; OPT IN allows the next assigned matchup
      // to take the host into their own game automatically.
      this.forcedMatchupView = optingOut;
      this.forcedMatchupMatchId = undefined;
      // The server may rebuild the ladder when the host opts in/out. Force one
      // fresh focus decision: Championship when out, host court when in.
      this.courtViewInitialized = false;
      this.courtFocusKey = '';
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.network.send({ type: 'set-host-participation', participating: !hostOptedIn });
    });
    this.ui.querySelector('#begin-btn')?.addEventListener('click', () => this.network.send({ type: 'begin-matchups' }));
    this.ui.querySelector('#return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelector('#return-my-match')?.addEventListener('click', () => {
      this.spectatingMatchId = undefined;
      this.spectatorAutoReturnOnOwnMatch = false;
      this.forcedMatchupView = false;
      this.forcedMatchupMatchId = undefined;
      this.render();
    });
    this.ui.querySelectorAll<HTMLElement>('[data-watch-match]').forEach((card) => {
      card.addEventListener('click', () => {
        const matchId = card.dataset.watchMatch;
        const court = this.room?.courts.find((candidate) => candidate.activeMatch?.id === matchId);
        if (court?.activeMatch) this.watchMatch(court);
      });
    });
  }

  private courtCardMarkup(court: CourtState, mine: boolean) {
    if (!this.room) return '';
    const last = this.room.courts.length - 1;
    const match = court.activeMatch;
    const a = match ? this.matchPlayer(match, 0) : undefined;
    const b = match ? this.matchPlayer(match, 1) : undefined;
    const waitingNames = court.waiting.map((id) => this.player(id)?.name).filter(Boolean) as string[];
    const label = court.index === last ? 'CHAMPIONSHIP' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const status = match?.status === 'ready' ? 'Ready' : match?.status === 'countdown' ? 'Starting…' : match?.status === 'playing' ? 'Live' : waitingNames.length ? 'Forming next match' : 'Waiting';
    const watchable = Boolean(this.room.phase === 'playing' && this.canWatchLiveMatch(match));
    const ownLiveMatch = Boolean(match && this.meId && match.playerIds.includes(this.meId) && ['countdown', 'playing'].includes(match.status));
    const waitingOnThisCourt = Boolean(mine && !ownLiveMatch);
    return `<article class="court-card ${mine ? 'my-court' : ''} ${court.index === last ? 'championship' : ''} ${watchable ? 'watchable' : ''}" data-court-index="${court.index}" ${watchable && match ? `data-watch-match="${match.id}"` : ''}>
      <div class="court-card-head"><span>${label}</span><em class="match-status ${match?.status || 'waiting'}">${status}</em></div>
      ${match ? `
        <div class="court-player ${this.isChampLeader(a) ? 'leader' : ''}">
          <span class="avatar-gem">◆</span><strong>${this.playerLabel(a)}</strong>${this.winsMarkup(a)}
        </div>
        <div class="versus-line"><span></span><b>VS</b><span></span></div>
        <div class="court-player ${this.isChampLeader(b) ? 'leader' : ''}">
          <span class="avatar-gem alt">◆</span><strong>${this.playerLabel(b)}</strong>${this.winsMarkup(b)}
        </div>` : `
        <div class="empty-court">
          <span class="spinner-gem small">◆</span>
          <strong>${waitingNames.length ? esc(waitingNames.join(' + ')) : 'Waiting for neighbouring results'}</strong>
          <small>${waitingNames.length === 1 ? 'One player is ready here.' : 'The next pair will start automatically when both players arrive.'}</small>
        </div>`}
      ${mine ? '<div class="my-match-ribbon">YOUR POSITION</div>' : ''}
      ${watchable ? `<div class="host-card-hint live-watch-hint">${ownLiveMatch ? 'YOUR MATCH • Tap to return' : waitingOnThisCourt ? '● LIVE • Tap to watch while waiting' : '● LIVE • Tap to watch'}</div>` : ''}
    </article>`;
  }

  private playerLabel(player?: PlayerState) {
    if (!player) return 'Waiting…';
    return `${this.isChampLeader(player) ? '👑 ' : ''}${esc(player.name)}`;
  }

  private matchPlayer(match: MatchState, index: 0 | 1) {
    const playerId = match.playerIds[index];
    const direct = this.player(playerId);
    if (direct) return direct;

    // Match IDs normally resolve directly. If a reconnect/identity handover
    // briefly leaves a live match pointing at the prior player ID, fall back to
    // the immutable name captured when this matchup was created. This keeps the
    // student's name visible and, when possible, reconnects it to the current
    // room player so points/crown status stay live too.
    const snapshotName = match.playerNames?.[index]?.trim();
    if (!snapshotName) return undefined;
    const normalized = snapshotName.toLocaleLowerCase();
    const byName = this.room?.players.find((player) => player.name.trim().toLocaleLowerCase() === normalized);
    if (byName) return byName;
    return {
      id: playerId,
      name: snapshotName,
      isHost: false,
      connected: false,
      points: 0,
      isBot: snapshotName === 'Gem Bot',
    } satisfies PlayerState;
  }

  private winsMarkup(player?: PlayerState) {
    const points = player?.points ?? 0;
    return `<span class="champ-count ${points === 0 ? 'zero' : ''}">${points}</span>`;
  }

  private isChampLeader(player?: PlayerState) {
    return Boolean(this.room && player && this.room.currentChampionId === player.id);
  }

  private standingStripMarkup() {
    if (!this.room) return '';
    const champion = this.room.currentChampionId ? this.player(this.room.currentChampionId) : undefined;
    const others = [...this.room.players]
      .filter((player) => player.id !== champion?.id)
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    const ranked = champion ? [champion, ...others] : others;
    return `
      <button id="standing-left" class="standing-arrow" aria-label="Previous scores">‹</button>
      <span class="standing-label">MATCH POINTS</span>
      <div id="standing-viewport" class="standing-viewport">
        <div class="standing-track">
          ${ranked.map((player) => `<span class="standing-player ${this.isChampLeader(player) ? 'leader' : ''}">${this.isChampLeader(player) ? '<i class="standing-crown">👑</i>' : ''}<span>${esc(player.name)}</span><b class="standing-score">${player.points}</b></span>`).join('')}
        </div>
      </div>
      <button id="standing-right" class="standing-arrow" aria-label="Next scores">›</button>`;
  }

  private bindStandingCarousel() {
    const viewport = this.ui.querySelector<HTMLElement>('#standing-viewport');
    if (!viewport) return;
    const move = (direction: number) => {
      const distance = Math.max(220, Math.floor(viewport.clientWidth * 0.82));
      viewport.scrollBy({ left: direction * distance, behavior: 'smooth' });
    };
    this.ui.querySelector('#standing-left')?.addEventListener('click', () => move(-1));
    this.ui.querySelector('#standing-right')?.addEventListener('click', () => move(1));
    let touchX = 0;
    viewport.addEventListener('touchstart', (event) => { touchX = event.changedTouches[0].clientX; }, { passive: true });
    viewport.addEventListener('touchend', (event) => {
      const dx = event.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) < 45) return;
      move(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  private bindCourtCarousel() {
    const viewport = this.ui.querySelector<HTMLElement>('#court-viewport');
    const cards = [...this.ui.querySelectorAll<HTMLElement>('[data-court-index]')];
    if (!viewport) return;

    const nearestIndex = () => {
      if (!cards.length) return 0;
      const center = viewport.scrollLeft + viewport.clientWidth / 2;
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      cards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const distance = Math.abs(cardCenter - center);
        if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
      });
      return bestIndex;
    };

    const remember = () => {
      // Ignore delayed RAF/timer callbacks that belong to a matchup DOM tree
      // which has already been replaced by a newer room-state render.
      if (!viewport.isConnected || this.ui.querySelector('#court-viewport') !== viewport) return;
      this.courtScrollLeft = viewport.scrollLeft;
      this.courtScrollInitialized = true;
      this.courtViewIndex = nearestIndex();
      this.courtViewInitialized = true;
    };

    const focus = (smooth = true) => {
      this.courtViewIndex = clamp(this.courtViewIndex, 0, Math.max(0, cards.length - 1));
      cards[this.courtViewIndex]?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
      window.setTimeout(remember, smooth ? 280 : 0);
    };

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!viewport.isConnected || this.ui.querySelector('#court-viewport') !== viewport) return;
      if (this.courtScrollInitialized) {
        const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
        viewport.scrollLeft = clamp(this.courtScrollLeft, 0, max);
        this.courtViewIndex = nearestIndex();
      } else {
        focus(false);
        remember();
      }
    }));

    this.ui.querySelector('#court-left')?.addEventListener('click', () => { this.courtViewIndex--; focus(); });
    this.ui.querySelector('#court-right')?.addEventListener('click', () => { this.courtViewIndex++; focus(); });

    const protectScroll = () => {
      remember();
      this.courtScrollLockUntil = Date.now() + 450;
    };
    viewport.addEventListener('scroll', protectScroll, { passive: true });
    viewport.addEventListener('pointerdown', () => { this.courtScrollLockUntil = Date.now() + 750; }, { passive: true });
    viewport.addEventListener('touchstart', () => { this.courtScrollLockUntil = Date.now() + 750; }, { passive: true });
    viewport.addEventListener('pointerup', protectScroll, { passive: true });
    viewport.addEventListener('touchend', protectScroll, { passive: true });
  }

  private renderDisconnectPause(match: MatchState) {
    const pause = match.disconnectPause;
    if (!pause || match.status !== 'playing') return;
    const remainingMs = pause.graceUntil - (Date.now() + this.serverClockOffset);
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const disconnected = this.player(pause.playerId);
    const name = disconnected?.name || 'Opponent';
    const spectating = this.spectatingMatchId === match.id;
    this.ui.insertAdjacentHTML('beforeend', `
      <div class="disconnect-grace-overlay" aria-live="polite">
        <div class="disconnect-grace-card glass-card">
          <div class="disconnect-grace-icon">⌁</div>
          <span>CONNECTION PAUSED</span>
          <strong>${spectating ? esc(name) : 'Opponent'} disconnected — waiting for reconnection… <b>${seconds}</b></strong>
          <small>${spectating ? `The live match is paused while ${esc(name)} has 20 seconds to reconnect. The board and turn timer are preserved.` : `${esc(name)} has 20 seconds to reconnect. If they do not return, you win by forfeit and receive +1 point.`}</small>
        </div>
      </div>`);
    if (remainingMs > 0) this.disconnectCountdownTimer = window.setTimeout(() => this.render(), Math.min(250, remainingMs + 20));
  }

  private renderGameShell(court: CourtState, match: MatchState) {
    if (!this.room) return;
    if (this.selectedGame.id === 'three-hexagon' && match.status === 'playing' && match.threeHexagon) {
      this.renderThreeHexagon(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'four-star' && match.status === 'playing' && match.fourStar) {
      this.renderFourStar(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'boxes' && match.status === 'playing' && match.boxes) {
      this.renderBoxes(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'never-touch' && match.status === 'playing' && match.neverTouch) {
      this.renderNeverTouch(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'spiral' && match.status === 'playing' && match.spiral) {
      this.renderSpiral(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'hex' && match.status === 'playing' && match.hex) {
      this.renderHex(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'factor-game' && match.status === 'playing' && match.factorGame) {
      this.renderFactorGame(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'hedron' && match.status === 'playing' && match.hedron) {
      this.renderHedron(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'multi' && match.status === 'playing' && match.multi) {
      this.renderMulti(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'ultimate-tic-tac-toe' && match.status === 'playing' && match.ultimateTtt) {
      this.renderUltimateTtt(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'lucky-thirteen' && match.status === 'playing' && match.luckyThirteen) {
      this.renderLuckyThirteen(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    if (this.selectedGame.id === 'craypots' && match.status === 'playing' && match.craypots) {
      this.renderCraypots(court, match);
      this.renderDisconnectPause(match);
      return;
    }
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const isCountdown = match.status === 'countdown';
    this.ui.innerHTML = `
      <section class="screen game-shell-screen">
        <header class="topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>${esc(this.selectedGame.symbol)}</span><div><small>${courtLabel}</small><strong>${esc(this.selectedGame.title)}</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="game-shell-card glass-card">
          <div class="foundation-banner">FOUNDATION BUILD • MATCH FLOW TEST ARENA</div>
          <div class="game-shell-heading">
            <div class="mega-symbol">${esc(this.selectedGame.symbol)}</div>
            <div><span class="eyebrow">SELECTED MINI-GAME</span><h1>${esc(this.selectedGame.title)}</h1><p>${esc(this.selectedGame.tagline)}</p></div>
          </div>
          <div class="versus-players">
            <div class="duel-player ${a?.id === this.meId ? 'me' : ''}"><span>PLAYER 1</span><strong>${this.playerLabel(a)}</strong>${this.winsMarkup(a)}</div>
            <div class="duel-vs">VS</div>
            <div class="duel-player ${b?.id === this.meId ? 'me' : ''}"><span>PLAYER 2</span><strong>${this.playerLabel(b)}</strong>${this.winsMarkup(b)}</div>
          </div>
          <div class="mechanics-note">
            <strong>The multiplayer shell is working; the individual ${esc(this.selectedGame.title)} board is the next build stage.</strong>
            <span>All 12 Dodeca-Gems games are now fully playable. This foundation arena is retained only as a safe fallback if a future game module is temporarily unavailable.</span>
          </div>
          <div class="timing-chip">⏱ Host turn timer: <strong>${this.room.turnSeconds} seconds${this.selectedGame.id === 'craypots' ? ' for each pot-placement and shopping decision' : ' per decision'}</strong></div>
          ${this.isHost ? `<div class="dev-win-controls"><span>HOST TEST CONTROL</span><button data-test-winner="${esc(a?.id || '')}">Award test win to ${esc(a?.name || 'Player 1')}</button><button data-test-winner="${esc(b?.id || '')}">Award test win to ${esc(b?.name || 'Player 2')}</button></div>` : '<div class="student-wait-note">The host can resolve this foundation test match. Full touch controls arrive with the individual mini-game build.</div>'}
        </main>

        <footer class="game-shell-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${isCountdown ? `<div id="next-match-overlay" class="next-match-overlay"><span>NEXT MATCHUP STARTS</span><strong>${esc(a?.name || '')} <em>vs</em> ${esc(b?.name || '')}</strong><div id="next-countdown" data-starts-at="${match.startsAt || 0}">3</div></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLElement>('[data-test-winner]').forEach((button) => {
      button.addEventListener('click', () => {
        const winnerId = button.dataset.testWinner;
        if (winnerId) this.network.send({ type: 'resolve-match', matchId: match.id, winnerId });
      });
    });
    this.updateCountdowns();
  }

  private renderThreeHexagon(court: CourtState, match: MatchState) {
    if (!this.room || !match.threeHexagon) return;
    const state = match.threeHexagon;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const myTurn = state.turnPlayerId === this.meId && state.phase !== 'won';
    const turnPlayer = this.player(state.turnPlayerId);
    const selected = this.threeHexSelectedFrom;
    const positions = [
      { x: 220, y: 105 }, { x: 480, y: 105 }, { x: 90, y: 260 }, { x: 350, y: 260 },
      { x: 610, y: 260 }, { x: 220, y: 415 }, { x: 480, y: 415 },
    ];
    const edges: Array<[number, number]> = [
      [0, 1], [0, 2], [0, 3], [1, 3], [1, 4], [2, 3], [2, 5], [3, 4], [3, 5], [3, 6], [4, 6], [5, 6],
    ];
    const neighbours = (index: number) => edges.flatMap(([x, y]) => x === index ? [y] : y === index ? [x] : []);
    const physicalMoves = state.phase === 'moving' && this.meId
      ? state.board.flatMap((owner, from) => owner === this.meId
        ? neighbours(from).filter((to) => state.board[to] === null).map((to) => ({ from, to }))
        : [])
      : [];
    const previousMove = this.meId ? state.lastMoveByPlayer?.[this.meId] : null;
    const reverseAvailable = !!previousMove && physicalMoves.some((move) => move.from === previousMove.to && move.to === previousMove.from);
    const allowedMoves = previousMove
      ? physicalMoves.filter((move) => !(move.from === previousMove.to && move.to === previousMove.from))
      : physicalMoves;
    const selectedTargets = selected === undefined ? [] : allowedMoves.filter((move) => move.from === selected).map((move) => move.to);
    const winning = new Set(state.winningLine || []);
    const showWinner = state.phase === 'won' && this.winnerOverlayReady(state.resultRevealAt);
    const ownerClass = (owner: string | null) => owner === match.playerIds[0] ? 'p1' : owner === match.playerIds[1] ? 'p2' : 'empty';
    const counterCount = (playerId?: string) => state.board.filter((owner) => owner === playerId).length;
    const phaseText = state.phase === 'placing' ? 'PLACE COUNTERS' : state.phase === 'moving' ? 'SLIDE COUNTERS' : 'MATCH COMPLETE';
    const instruction = state.phase === 'placing'
      ? (myTurn ? 'Tap any empty circle to place your counter.' : `${turnPlayer?.name || 'Opponent'} is placing a counter.`)
      : state.phase === 'moving'
        ? (myTurn
          ? (selected === undefined
            ? (reverseAvailable
              ? 'You may move the same counter again — only moving it straight back is blocked.'
              : 'Tap one of your counters, then tap a connected empty circle.')
            : 'Now tap a highlighted empty circle — the previous space is blocked only if it would immediately reverse your last move.')
          : `${turnPlayer?.name || 'Opponent'} is choosing a slide.`)
        : showWinner
          ? `${this.player(state.winnerId || '')?.name || 'Player'} wins with three counters in a straight line!`
          : 'Three in a row! Watch the highlighted winning line.';

    const nodeMarkup = positions.map((pos, index) => {
      const owner = state.board[index];
      const isMine = owner === this.meId;
      const hasMove = state.phase === 'moving' && isMine && allowedMoves.some((move) => move.from === index);
      const selectable = myTurn && (state.phase === 'placing' ? owner === null : (hasMove || selectedTargets.includes(index)));
      const classes = [
        'threehex-node', ownerClass(owner), selected === index ? 'selected' : '', selectedTargets.includes(index) ? 'target' : '',
        winning.has(index) ? 'winning' : '', selectable ? 'selectable' : '',
      ].filter(Boolean).join(' ');
      const label = owner ? (owner === match.playerIds[0] ? 'Player 1 counter' : 'Player 2 counter') : 'Empty circle';
      return `<button class="${classes}" data-threehex-node="${index}" style="--node-x:${pos.x}px;--node-y:${pos.y}px" ${selectable ? '' : 'disabled'} aria-label="${label}"><span>${owner ? '◆' : ''}</span></button>`;
    }).join('');

    this.ui.innerHTML = `
      <section class="screen threehex-screen">
        <header class="topbar threehex-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>△</span><div><small>${courtLabel}</small><strong>Three Hexagon</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="threehex-main">
          <section class="threehex-board-card glass-card">
            <div class="threehex-board-head">
              <div><span class="eyebrow">${phaseText}</span><strong>${esc(instruction)}</strong></div>
              <div class="turn-number">TURN <b>${state.turnNumber}</b></div>
            </div>
            <div class="threehex-board" aria-label="Three Hexagon playing board">
              <div class="threehex-rails" aria-hidden="true">
                ${edges.map(([x, y]) => {
                  const a = positions[x];
                  const b = positions[y];
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const length = Math.hypot(dx, dy);
                  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                  const horizontal = a.y === b.y;
                  return `<span class="threehex-rail${horizontal ? ' horizontal' : ''}" style="--rail-x:${a.x}px;--rail-y:${a.y - 24}px;--rail-length:${length}px;--rail-angle:${angle}deg"></span>`;
                }).join('')}
              </div>
              ${nodeMarkup}
            </div>
          </section>

          <aside class="threehex-side">
            <div class="threehex-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <span class="eyebrow">CURRENT TURN</span>
              <div class="threehex-turn-name"><i class="counter-dot ${state.turnPlayerId === match.playerIds[0] ? 'p1' : 'p2'}">◆</i><strong>${esc(turnPlayer?.name || '')}</strong></div>
              <div id="turn-countdown" class="turn-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>--</span><small>SECONDS</small></div>
              <p>${myTurn ? 'Your move — the server timer is running.' : 'Both players use the same server-controlled turn time.'}</p>
            </div>

            <div class="threehex-score-card glass-card">
              <div class="mini-player-row ${state.turnPlayerId === a?.id ? 'active' : ''}"><i class="counter-dot p1">◆</i><div><small>PLAYER 1</small><strong>${esc(a?.name || '')}</strong></div><b>${counterCount(a?.id)}/3</b></div>
              <div class="mini-player-row ${state.turnPlayerId === b?.id ? 'active' : ''}"><i class="counter-dot p2">◆</i><div><small>PLAYER 2</small><strong>${esc(b?.name || '')}</strong></div><b>${counterCount(b?.id)}/3</b></div>
            </div>

            <div class="threehex-rule-card glass-card">
              <strong>${state.phase === 'placing' ? 'PLACE ONE COUNTER' : state.phase === 'moving' ? 'SLIDE ALONG ONE LINE' : 'THREE IN A LINE'}</strong>
              <p>${state.phase === 'placing' ? 'Players alternate until all six counters have been placed.' : state.phase === 'moving' ? 'No jumping. You may move the same counter on consecutive turns, but you cannot immediately move it straight back to the space it just came from. If no legal slide remains, you skip the turn.' : 'The winning line is highlighted on the board.'}</p>
            </div>
            <div class="threehex-action-log">${esc(state.phase === 'won' && !showWinner ? 'Winning line complete — showing the path…' : state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer threehex-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${showWinner ? `<div class="threehex-win-overlay"><div class="win-gem">◆</div><span>THREE IN A LINE!</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins</strong><small>Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-threehex-node]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.room || !match.threeHexagon || match.threeHexagon.turnPlayerId !== this.meId || match.threeHexagon.phase === 'won') return;
        const index = Number(button.dataset.threehexNode);
        const owner = match.threeHexagon.board[index];
        if (match.threeHexagon.phase === 'placing') {
          if (owner === null) this.network.send({ type: 'three-hexagon-move', matchId: match.id, action: { kind: 'place', to: index } });
          return;
        }
        if (owner === this.meId) {
          this.threeHexSelectedFrom = this.threeHexSelectedFrom === index ? undefined : index;
          this.renderThreeHexagon(court, match);
          return;
        }
        if (owner === null && this.threeHexSelectedFrom !== undefined && selectedTargets.includes(index)) {
          const from = this.threeHexSelectedFrom;
          this.threeHexSelectedFrom = undefined;
          this.network.send({ type: 'three-hexagon-move', matchId: match.id, action: { kind: 'move', from, to: index } });
        }
      });
    });
    this.updateCountdowns();
  }

  private renderFourStar(court: CourtState, match: MatchState) {
    if (!this.room || !match.fourStar) return;
    const state = match.fourStar;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const myTurn = state.turnPlayerId === this.meId && state.phase !== 'won';
    const turnPlayer = this.player(state.turnPlayerId);
    const selected = this.fourStarSelectedFrom;

    // Geometry follows the supplied Four Star board: one apex, a 4-node row,
    // a 3-node centre row, another 4-node row, then a bottom apex.
    const positions = [
      { x: 350, y: 35 },
      { x: 80, y: 130 }, { x: 260, y: 130 }, { x: 440, y: 130 }, { x: 620, y: 130 },
      { x: 170, y: 225 }, { x: 350, y: 225 }, { x: 530, y: 225 },
      { x: 80, y: 320 }, { x: 260, y: 320 }, { x: 440, y: 320 }, { x: 620, y: 320 },
      { x: 350, y: 415 },
    ];
    const edges: Array<[number, number]> = [
      [0, 2], [0, 3],
      [1, 2], [2, 3], [3, 4],
      [1, 5], [2, 5], [2, 6], [3, 6], [3, 7], [4, 7],
      [5, 6], [6, 7],
      [5, 8], [5, 9], [6, 9], [6, 10], [7, 10], [7, 11],
      [8, 9], [9, 10], [10, 11],
      [9, 12], [10, 12],
    ];
    const neighbours = (index: number) => edges.flatMap(([x, y]) => x === index ? [y] : y === index ? [x] : []);
    const physicalMoves = state.phase === 'moving' && this.meId
      ? state.board.flatMap((owner, from) => owner === this.meId
        ? neighbours(from).filter((to) => state.board[to] === null).map((to) => ({ from, to }))
        : [])
      : [];
    const previousMove = this.meId ? state.lastMoveByPlayer?.[this.meId] : null;
    const reverseAvailable = !!previousMove && physicalMoves.some((move) => move.from === previousMove.to && move.to === previousMove.from);
    const allowedMoves = previousMove
      ? physicalMoves.filter((move) => !(move.from === previousMove.to && move.to === previousMove.from))
      : physicalMoves;
    const selectedTargets = selected === undefined ? [] : allowedMoves.filter((move) => move.from === selected).map((move) => move.to);
    const winning = new Set(state.winningLine || []);
    const showWinner = state.phase === 'won' && this.winnerOverlayReady(state.resultRevealAt);
    const ownerClass = (owner: string | null) => owner === match.playerIds[0] ? 'p1' : owner === match.playerIds[1] ? 'p2' : 'empty';
    const counterCount = (playerId?: string) => state.board.filter((owner) => owner === playerId).length;
    const phaseText = state.phase === 'placing' ? 'PLACE COUNTERS' : state.phase === 'moving' ? 'SLIDE COUNTERS' : 'MATCH COMPLETE';
    const instruction = state.phase === 'placing'
      ? (myTurn ? 'Tap any empty circle to place your counter.' : `${turnPlayer?.name || 'Opponent'} is placing a counter.`)
      : state.phase === 'moving'
        ? (myTurn
          ? (selected === undefined
            ? (reverseAvailable
              ? 'You may move the same counter again — only moving it straight back is blocked.'
              : 'Tap one of your counters, then tap a connected empty circle.')
            : 'Now tap a highlighted empty circle — the previous space is blocked only if it would immediately reverse your last move.')
          : `${turnPlayer?.name || 'Opponent'} is choosing a slide.`)
        : showWinner
          ? `${this.player(state.winnerId || '')?.name || 'Player'} wins with four counters in a straight line!`
          : 'Four in a row! Watch the highlighted winning line.';

    const nodeMarkup = positions.map((pos, index) => {
      const owner = state.board[index];
      const isMine = owner === this.meId;
      const hasMove = state.phase === 'moving' && isMine && allowedMoves.some((move) => move.from === index);
      const selectable = myTurn && (state.phase === 'placing' ? owner === null : (hasMove || selectedTargets.includes(index)));
      const classes = [
        'fourstar-node', ownerClass(owner), selected === index ? 'selected' : '', selectedTargets.includes(index) ? 'target' : '',
        winning.has(index) ? 'winning' : '', selectable ? 'selectable' : '',
      ].filter(Boolean).join(' ');
      const label = owner ? (owner === match.playerIds[0] ? 'Player 1 counter' : 'Player 2 counter') : 'Empty circle';
      return `<button class="${classes}" data-fourstar-node="${index}" style="--node-x:${pos.x}px;--node-y:${pos.y}px" ${selectable ? '' : 'disabled'} aria-label="${label}"><span>${owner ? '◆' : ''}</span></button>`;
    }).join('');

    this.ui.innerHTML = `
      <section class="screen threehex-screen fourstar-screen">
        <header class="topbar threehex-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>✦</span><div><small>${courtLabel}</small><strong>Four Star</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="threehex-main">
          <section class="threehex-board-card glass-card fourstar-board-card">
            <div class="threehex-board-head">
              <div><span class="eyebrow">${phaseText}</span><strong>${esc(instruction)}</strong></div>
              <div class="turn-number">TURN <b>${state.turnNumber}</b></div>
            </div>
            <div class="fourstar-board" aria-label="Four Star playing board">
              <div class="fourstar-rails" aria-hidden="true">
                ${edges.map(([x, y]) => {
                  const from = positions[x];
                  const to = positions[y];
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const length = Math.hypot(dx, dy);
                  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                  const horizontal = from.y === to.y;
                  return `<span class="fourstar-rail${horizontal ? ' horizontal' : ''}" style="--rail-x:${from.x}px;--rail-y:${from.y}px;--rail-length:${length}px;--rail-angle:${angle}deg"></span>`;
                }).join('')}
              </div>
              ${nodeMarkup}
            </div>
          </section>

          <aside class="threehex-side">
            <div class="threehex-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <span class="eyebrow">CURRENT TURN</span>
              <div class="threehex-turn-name"><i class="counter-dot ${state.turnPlayerId === match.playerIds[0] ? 'p1' : 'p2'}">◆</i><strong>${esc(turnPlayer?.name || '')}</strong></div>
              <div id="turn-countdown" class="turn-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>--</span><small>SECONDS</small></div>
              <p>${myTurn ? 'Your move — the server timer is running.' : 'Both players use the same server-controlled turn time.'}</p>
            </div>

            <div class="threehex-score-card glass-card">
              <div class="mini-player-row ${state.turnPlayerId === a?.id ? 'active' : ''}"><i class="counter-dot p1">◆</i><div><small>PLAYER 1</small><strong>${esc(a?.name || '')}</strong></div><b>${counterCount(a?.id)}/4</b></div>
              <div class="mini-player-row ${state.turnPlayerId === b?.id ? 'active' : ''}"><i class="counter-dot p2">◆</i><div><small>PLAYER 2</small><strong>${esc(b?.name || '')}</strong></div><b>${counterCount(b?.id)}/4</b></div>
            </div>

            <div class="threehex-rule-card glass-card">
              <strong>${state.phase === 'placing' ? 'PLACE ONE COUNTER' : state.phase === 'moving' ? 'SLIDE ALONG ONE LINE' : 'FOUR IN A LINE'}</strong>
              <p>${state.phase === 'placing' ? 'Players alternate until all eight counters have been placed.' : state.phase === 'moving' ? 'Move only to an adjacent empty circle. The same counter may move on consecutive turns in different directions; only an immediate move straight back to its previous space is blocked. If that is the only possible slide, the turn is missed.' : 'The winning four-counter line is highlighted on the board.'}</p>
            </div>
            <div class="threehex-action-log">${esc(state.phase === 'won' && !showWinner ? 'Winning line complete — showing the path…' : state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer threehex-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${showWinner ? `<div class="threehex-win-overlay"><div class="win-gem">✦</div><span>FOUR IN A LINE!</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins</strong><small>Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-fourstar-node]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.room || !match.fourStar || match.fourStar.turnPlayerId !== this.meId || match.fourStar.phase === 'won') return;
        const index = Number(button.dataset.fourstarNode);
        const owner = match.fourStar.board[index];
        if (match.fourStar.phase === 'placing') {
          if (owner === null) this.network.send({ type: 'four-star-move', matchId: match.id, action: { kind: 'place', to: index } });
          return;
        }
        if (owner === this.meId) {
          this.fourStarSelectedFrom = this.fourStarSelectedFrom === index ? undefined : index;
          this.renderFourStar(court, match);
          return;
        }
        if (owner === null && this.fourStarSelectedFrom !== undefined && selectedTargets.includes(index)) {
          const from = this.fourStarSelectedFrom;
          this.fourStarSelectedFrom = undefined;
          this.network.send({ type: 'four-star-move', matchId: match.id, action: { kind: 'move', from, to: index } });
        }
      });
    });
    this.updateCountdowns();
  }

  private renderBoxes(court: CourtState, match: MatchState) {
    if (!this.room || !match.boxes) return;
    const state = match.boxes;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const myTurn = state.turnPlayerId === this.meId && state.phase !== 'won';
    const turnPlayer = this.player(state.turnPlayerId);
    const dotX = [95, 265, 435, 605];
    const dotY = [55, 175, 295, 415];
    const horizontalEdges: Array<{ index: number; row: number; col: number }> = [];
    const verticalEdges: Array<{ index: number; row: number; col: number }> = [];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) horizontalEdges.push({ index: row * 3 + col, row, col });
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) verticalEdges.push({ index: 12 + row * 4 + col, row, col });
    const scoreA = state.scores[a?.id || ''] || 0;
    const scoreB = state.scores[b?.id || ''] || 0;
    const completed = new Set(state.lastCompletedBoxes || []);
    const instruction = state.phase === 'won'
      ? `${this.player(state.winnerId || '')?.name || 'Player'} wins by claiming the most boxes.`
      : myTurn
        ? 'Tap any open horizontal or vertical line between neighbouring dots.'
        : `${turnPlayer?.name || 'Opponent'} is choosing a line.`;

    const squareMarkup = state.boxes.map((owner, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      const ownerClass = owner === match.playerIds[0] ? 'p1' : owner === match.playerIds[1] ? 'p2' : 'empty';
      const ownerPlayer = owner ? this.player(owner) : undefined;
      const shortName = ownerPlayer?.name ? ownerPlayer.name.trim().slice(0, 2).toUpperCase() : '';
      return `<div class="boxes-square ${ownerClass} ${completed.has(index) ? 'fresh' : ''}" style="--box-left:${dotX[col]}px;--box-top:${dotY[row]}px;--box-width:${dotX[col + 1] - dotX[col]}px;--box-height:${dotY[row + 1] - dotY[row]}px"><span>${esc(shortName)}</span></div>`;
    }).join('');

    const edgeMarkup = [
      ...horizontalEdges.map(({ index, row, col }) => {
        const owner = state.edges[index];
        const ownerClass = owner === match.playerIds[0] ? 'p1' : owner === match.playerIds[1] ? 'p2' : 'open';
        const clickable = myTurn && owner === null;
        return `<button class="boxes-edge horizontal ${ownerClass} ${clickable ? 'selectable' : ''}" data-boxes-edge="${index}" style="--edge-left:${dotX[col]}px;--edge-top:${dotY[row]}px;--edge-length:${dotX[col + 1] - dotX[col]}px" ${clickable ? '' : 'disabled'} aria-label="${owner ? 'Drawn horizontal line' : 'Open horizontal line'}"><span></span></button>`;
      }),
      ...verticalEdges.map(({ index, row, col }) => {
        const owner = state.edges[index];
        const ownerClass = owner === match.playerIds[0] ? 'p1' : owner === match.playerIds[1] ? 'p2' : 'open';
        const clickable = myTurn && owner === null;
        return `<button class="boxes-edge vertical ${ownerClass} ${clickable ? 'selectable' : ''}" data-boxes-edge="${index}" style="--edge-left:${dotX[col]}px;--edge-top:${dotY[row]}px;--edge-length:${dotY[row + 1] - dotY[row]}px" ${clickable ? '' : 'disabled'} aria-label="${owner ? 'Drawn vertical line' : 'Open vertical line'}"><span></span></button>`;
      }),
    ].join('');

    const dotsMarkup = dotY.flatMap((y) => dotX.map((x) => `<span class="boxes-dot" style="--dot-x:${x}px;--dot-y:${y}px"></span>`)).join('');

    this.ui.innerHTML = `
      <section class="screen threehex-screen boxes-screen">
        <header class="topbar threehex-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>□</span><div><small>${courtLabel}</small><strong>Square Boxes</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="threehex-main">
          <section class="threehex-board-card glass-card boxes-board-card">
            <div class="threehex-board-head">
              <div><span class="eyebrow">${state.phase === 'won' ? 'BOARD COMPLETE' : 'DRAW ONE LINE'}</span><strong>${esc(instruction)}</strong></div>
              <div class="turn-number">TURN <b>${state.turnNumber}</b></div>
            </div>
            <div class="boxes-board" aria-label="Square Boxes 4 by 4 dot playing board">
              ${squareMarkup}
              ${edgeMarkup}
              ${dotsMarkup}
            </div>
          </section>

          <aside class="threehex-side">
            <div class="threehex-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <span class="eyebrow">CURRENT TURN</span>
              <div class="threehex-turn-name"><i class="counter-dot ${state.turnPlayerId === match.playerIds[0] ? 'p1' : 'p2'}">◆</i><strong>${esc(turnPlayer?.name || '')}</strong></div>
              <div id="turn-countdown" class="turn-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>--</span><small>SECONDS</small></div>
              <p>${myTurn ? 'Choose one open line. Complete a box and you immediately get another turn.' : 'The server controls the same turn time for both players.'}</p>
            </div>

            <div class="threehex-score-card glass-card boxes-score-card">
              <div class="mini-player-row ${state.turnPlayerId === a?.id ? 'active' : ''}"><i class="counter-dot p1">◆</i><div><small>PLAYER 1</small><strong>${esc(a?.name || '')}</strong></div><b>${scoreA}</b></div>
              <div class="mini-player-row ${state.turnPlayerId === b?.id ? 'active' : ''}"><i class="counter-dot p2">◆</i><div><small>PLAYER 2</small><strong>${esc(b?.name || '')}</strong></div><b>${scoreB}</b></div>
            </div>

            <div class="threehex-rule-card glass-card">
              <strong>${state.phase === 'won' ? 'MOST BOXES WINS' : 'COMPLETE A BOX = GO AGAIN'}</strong>
              <p>${state.phase === 'won' ? `Final score: ${scoreA}–${scoreB}.` : 'Join neighbouring dots horizontally or vertically only. No diagonal lines. A completed square belongs to the player who draws its final side.'}</p>
            </div>
            <div class="threehex-action-log">${esc(state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer threehex-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'won' ? `<div class="threehex-win-overlay boxes-win-overlay"><div class="win-gem">□</div><span>BOARD COMPLETE!</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins ${Math.max(scoreA, scoreB)}-${Math.min(scoreA, scoreB)}</strong><small>Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-boxes-edge]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!match.boxes || match.boxes.phase === 'won' || match.boxes.turnPlayerId !== this.meId) return;
        const edge = Number(button.dataset.boxesEdge);
        if (!Number.isInteger(edge) || match.boxes.edges[edge] !== null) return;
        this.network.send({ type: 'boxes-move', matchId: match.id, action: { kind: 'draw', edge } });
      });
    });
    this.updateCountdowns();
  }

  private renderNeverTouch(court: CourtState, match: MatchState) {
    if (!this.room || !match.neverTouch) return;
    const state = match.neverTouch;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const myTurn = state.turnPlayerId === this.meId && state.phase !== 'won';
    const turnPlayer = this.player(state.turnPlayerId);
    const xPlayerId = state.startingPlayerId;
    const oPlayerId = match.playerIds.find((id) => id !== xPlayerId) || match.playerIds[1];
    const xPlayer = this.player(xPlayerId);
    const oPlayer = this.player(oPlayerId);

    const neighbours = (index: number) => {
      const row = Math.floor(index / 4);
      const col = index % 4;
      const result: number[] = [];
      if (row > 0) result.push(index - 4);
      if (row < 3) result.push(index + 4);
      if (col > 0) result.push(index - 1);
      if (col < 3) result.push(index + 1);
      return result;
    };
    const isLegalFor = (index: number, playerId: string) => state.board[index] === null
      && !neighbours(index).some((candidate) => state.board[candidate] === playerId);
    const legalForCurrent = state.phase === 'won' ? [] : state.board
      .map((_, index) => index)
      .filter((index) => isLegalFor(index, state.turnPlayerId));
    const xCount = state.board.filter((owner) => owner === xPlayerId).length;
    const oCount = state.board.filter((owner) => owner === oPlayerId).length;
    const instruction = state.phase === 'won'
      ? `${this.player(state.winnerId || '')?.name || 'Player'} made the last legal mark.`
      : myTurn
        ? `Choose any highlighted square for your ${this.meId === xPlayerId ? 'X' : 'O'}.`
        : `${turnPlayer?.name || 'Opponent'} is choosing a square.`;

    const cells = state.board.map((owner, index) => {
      const isX = owner === xPlayerId;
      const isO = owner === oPlayerId;
      const open = owner === null;
      const legal = myTurn && open && legalForCurrent.includes(index);
      const blocked = myTurn && open && !legal;
      const mark = isX ? 'X' : isO ? 'O' : '';
      const ownerClass = isX ? 'x-mark' : isO ? 'o-mark' : 'empty';
      const recent = state.lastPlacedIndex === index ? 'recent' : '';
      return `<button class="never-touch-cell ${ownerClass} ${legal ? 'legal' : ''} ${blocked ? 'blocked' : ''} ${recent}" data-never-touch-cell="${index}" ${legal ? '' : 'disabled'} aria-label="${owner ? `${mark} mark` : legal ? 'Legal empty square' : 'Unavailable square'}"><span>${mark}</span></button>`;
    }).join('');

    this.ui.innerHTML = `
      <section class="screen threehex-screen never-touch-screen">
        <header class="topbar threehex-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>×○</span><div><small>${courtLabel}</small><strong>Never Touch!</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="threehex-main">
          <section class="threehex-board-card glass-card never-touch-board-card">
            <div class="threehex-board-head">
              <div><span class="eyebrow">${state.phase === 'won' ? 'NO LEGAL MOVE REMAINS' : 'PLACE ONE MARK'}</span><strong>${esc(instruction)}</strong></div>
              <div class="turn-number">TURN <b>${state.turnNumber}</b></div>
            </div>
            <div class="never-touch-board" aria-label="Never Touch four by four playing board">
              ${cells}
            </div>
            <div class="never-touch-board-key"><span><i class="legal-swatch"></i> Legal move</span><span><i class="blocked-swatch"></i> Your own marks may not share an edge</span></div>
          </section>

          <aside class="threehex-side never-touch-side">
            <div class="threehex-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <span class="eyebrow">CURRENT TURN</span>
              <div class="threehex-turn-name"><i class="never-touch-mini-mark ${state.turnPlayerId === xPlayerId ? 'x' : 'o'}">${state.turnPlayerId === xPlayerId ? 'X' : 'O'}</i><strong>${esc(turnPlayer?.name || '')}</strong></div>
              <div id="turn-countdown" class="turn-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>--</span><small>SECONDS</small></div>
              <p>${myTurn ? 'Tap one glowing legal square. If time runs out, the server chooses a random legal square for you.' : 'Both players receive the same server-controlled decision time.'}</p>
            </div>

            <div class="threehex-score-card glass-card never-touch-player-card">
              <div class="mini-player-row ${state.turnPlayerId === xPlayerId ? 'active' : ''}"><i class="never-touch-mini-mark x">X</i><div><small>STARTING SYMBOL</small><strong>${esc(xPlayer?.name || '')}</strong></div><b>${xCount}</b></div>
              <div class="mini-player-row ${state.turnPlayerId === oPlayerId ? 'active' : ''}"><i class="never-touch-mini-mark o">O</i><div><small>SECOND SYMBOL</small><strong>${esc(oPlayer?.name || '')}</strong></div><b>${oCount}</b></div>
            </div>

            <div class="threehex-rule-card glass-card">
              <strong>${state.phase === 'won' ? 'LAST LEGAL MARK WINS' : 'NEVER TOUCH YOUR OWN MARK'}</strong>
              <p>${state.phase === 'won' ? `${esc(this.player(state.winnerId || '')?.name || 'Player')} leaves the opponent with no legal square.` : 'Your X marks or O marks may touch diagonally, but two of your own marks may never share a horizontal or vertical edge.'}</p>
            </div>
            <div class="threehex-action-log">${esc(state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer threehex-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'won' ? `<div class="threehex-win-overlay never-touch-win-overlay"><div class="win-gem">×○</div><span>NO LEGAL MOVE!</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins</strong><small>They made the final legal mark. Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-never-touch-cell]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!match.neverTouch || match.neverTouch.phase === 'won' || match.neverTouch.turnPlayerId !== this.meId) return;
        const to = Number(button.dataset.neverTouchCell);
        if (!Number.isInteger(to) || !isLegalFor(to, this.meId)) return;
        this.network.send({ type: 'never-touch-move', matchId: match.id, action: { kind: 'place', to } });
      });
    });
    this.updateCountdowns();
  }

  private renderSpiral(court: CourtState, match: MatchState) {
    if (!this.room || !match.spiral) return;
    const state = match.spiral;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const myTurn = state.turnPlayerId === this.meId && state.phase !== 'won';
    const turnPlayer = this.player(state.turnPlayerId);
    const finish = 18;
    const startStars = new Set([0, 5, 10, 14]);
    // Deliberately spaced rectangular spiral. Each successive ring has roughly
    // 60-70 px of breathing room so the board reads cleanly on phones/iPads
    // as well as laptops. The centre star is also separated from its first
    // destination so the opening move is visually obvious.
    const positions = [
      { x: 350, y: 250 }, { x: 350, y: 175 }, { x: 440, y: 175 }, { x: 440, y: 285 },
      { x: 260, y: 285 }, { x: 260, y: 110 }, { x: 530, y: 110 }, { x: 530, y: 230 },
      { x: 530, y: 350 }, { x: 350, y: 350 }, { x: 170, y: 350 }, { x: 170, y: 230 },
      { x: 170, y: 45 }, { x: 395, y: 45 }, { x: 620, y: 45 }, { x: 620, y: 230 },
      { x: 620, y: 415 }, { x: 350, y: 415 },
    ];
    const home = { x: 90, y: 415 };
    const occupancy = new Map<number, number>();
    state.counters.forEach((position, counter) => { if (position < finish) occupancy.set(position, counter); });
    const legalMoves = state.phase === 'won' ? [] : state.counters.flatMap((from, counter) => {
      if (from >= finish) return [];
      const moves: Array<{ counter: number; steps: number; to: number }> = [];
      for (let steps = 1; steps <= 3; steps++) {
        const to = from + steps;
        if (to > finish) continue;
        const blocked = state.counters.some((position, otherCounter) => otherCounter !== counter && position < finish && position > from && position <= to);
        if (!blocked) moves.push({ counter, steps, to });
      }
      return moves;
    });
    const selected = this.spiralSelectedCounter;
    const selectedMoves = selected === undefined ? [] : legalMoves.filter((move) => move.counter === selected);
    const targetStep = new Map(selectedMoves.map((move) => [move.to, move.steps]));
    const counterColours = ['cyan', 'pink', 'gold', 'violet'];
    const counterNames = ['1', '2', '3', '4'];
    const finishedCount = state.counters.filter((position) => position >= finish).length;

    const railPoints = [...positions, home];
    const railSegments = railPoints.slice(0, -1).map((from, index) => {
      const to = railPoints[index + 1];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      return { from, to, length, angle, index };
    });
    const rails = railSegments.map(({ from, length, angle }) =>
      `<span class="spiral-rail" style="--rail-x:${from.x}px;--rail-y:${from.y}px;--rail-length:${length}px;--rail-angle:${angle}deg"></span>`
    ).join('');

    // Strong directional markers placed on uncluttered rail sections. They use
    // the exact rail angle, so every arrow visibly points forward toward HOME.
    const arrowEdges = new Set([0, 1, 4, 6, 9, 11, 13, 15, 17]);
    const arrows = railSegments.filter(({ index }) => arrowEdges.has(index)).map(({ from, to, angle }) => {
      const x = (from.x + to.x) / 2;
      const y = (from.y + to.y) / 2;
      return `<span class="spiral-arrow" style="--arrow-x:${x}px;--arrow-y:${y}px;--arrow-angle:${angle}deg" aria-hidden="true"></span>`;
    }).join('');

    const spots = positions.map((pos, index) => {
      const steps = targetStep.get(index);
      const target = myTurn && steps !== undefined;
      const occupied = occupancy.has(index);
      const star = startStars.has(index);
      return `<button class="spiral-spot ${star ? 'star' : ''} ${target ? 'target' : ''} ${occupied ? 'occupied' : ''}" style="--spot-x:${pos.x}px;--spot-y:${pos.y}px" data-spiral-target="${index}" ${target ? '' : 'disabled'} aria-label="${target ? `Move ${steps} spot${steps === 1 ? '' : 's'}` : star ? 'Starting star' : 'Spiral spot'}"><span>${target ? `+${steps}` : star ? '★' : ''}</span></button>`;
    }).join('');

    const counters = state.counters.map((position, counter) => {
      if (position >= finish) return '';
      const pos = positions[position];
      const canMove = myTurn && legalMoves.some((move) => move.counter === counter);
      const isSelected = selected === counter;
      const justMoved = state.lastMovedCounter === counter;
      return `<button class="spiral-counter ${counterColours[counter]} ${canMove ? 'selectable' : ''} ${isSelected ? 'selected' : ''} ${justMoved ? 'recent' : ''}" style="--counter-x:${pos.x}px;--counter-y:${pos.y}px" data-spiral-counter="${counter}" ${canMove ? '' : 'disabled'} aria-label="Counter ${counter + 1}${canMove ? ', selectable' : ''}"><span>${counterNames[counter]}</span></button>`;
    }).join('');

    const homeTargets = targetStep.get(finish);
    const homeTarget = myTurn && homeTargets !== undefined;
    const finishedGems = state.counters.map((position, counter) => position >= finish ? `<i class="spiral-home-gem ${counterColours[counter]}">${counter + 1}</i>` : '').join('');
    const instruction = state.phase === 'won'
      ? `${this.player(state.winnerId || '')?.name || 'Player'} moved the final counter into HOME!`
      : myTurn
        ? selected === undefined
          ? 'Tap any glowing counter, then choose a highlighted destination.'
          : `Counter ${selected + 1} selected — move it 1, 2 or 3 spots.`
        : `${turnPlayer?.name || 'Opponent'} is choosing a counter to move.`;

    const progressRows = state.counters.map((position, counter) => {
      const homeText = position >= finish ? 'HOME' : `${finish - position} left`;
      return `<div class="spiral-progress-row"><i class="spiral-mini-gem ${counterColours[counter]}">${counter + 1}</i><span>COUNTER ${counter + 1}</span><b>${homeText}</b></div>`;
    }).join('');

    this.ui.innerHTML = `
      <section class="screen threehex-screen spiral-screen">
        <header class="topbar threehex-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>◎</span><div><small>${courtLabel}</small><strong>Spiral</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="threehex-main">
          <section class="threehex-board-card glass-card spiral-board-card">
            <div class="threehex-board-head">
              <div><span class="eyebrow">MOVE TOWARD HOME</span><strong>${esc(instruction)}</strong></div>
              <div class="turn-number">TURN <b>${state.turnNumber}</b></div>
            </div>
            <div class="spiral-board" aria-label="Spiral counter race board">
              <div class="spiral-rails">${rails}</div>
              <div class="spiral-arrows">${arrows}</div>
              ${spots}
              ${counters}
              <button class="spiral-home ${homeTarget ? 'target' : ''}" style="--home-x:${home.x}px;--home-y:${home.y}px" data-spiral-target="${finish}" ${homeTarget ? '' : 'disabled'} aria-label="HOME${homeTarget ? `, move ${homeTargets} spots` : ''}">
                <strong>HOME</strong><small>${homeTarget ? `+${homeTargets}` : `${finishedCount}/4`}</small><div>${finishedGems}</div>
              </button>
              <div class="spiral-direction">FOLLOW THE SPIRAL <span>TO HOME</span></div>
            </div>
          </section>

          <aside class="threehex-side spiral-side">
            <div class="threehex-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <span class="eyebrow">CURRENT TURN</span>
              <div class="threehex-turn-name"><i class="player-gem ${state.turnPlayerId === match.playerIds[0] ? 'p1' : 'p2'}">◆</i><strong>${esc(turnPlayer?.name || '')}</strong></div>
              <div id="turn-countdown" class="turn-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>--</span><small>SECONDS</small></div>
              <p>${myTurn ? 'Choose one counter and move it 1, 2 or 3 spots. If time expires, the server makes a legal move.' : 'Both players use the same server-controlled decision time.'}</p>
            </div>

            <div class="glass-card spiral-progress-card">
              <div class="spiral-progress-head"><span>SHARED COUNTERS</span><strong>${finishedCount}/4 HOME</strong></div>
              ${progressRows}
            </div>

            <div class="threehex-rule-card glass-card">
              <strong>NO LANDING • NO JUMPING • NO BACKWARDS</strong>
              <p>The four counters are shared. Stars count as spots. Move any counter forward 1–3 spots; the player who sends the final counter HOME wins.</p>
            </div>
            <div class="threehex-action-log">${esc(state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer threehex-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'won' ? `<div class="threehex-win-overlay spiral-win-overlay"><div class="win-gem">◎</div><span>FINAL COUNTER HOME!</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins</strong><small>Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-spiral-counter]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!match.spiral || match.spiral.phase === 'won' || match.spiral.turnPlayerId !== this.meId) return;
        const counter = Number(button.dataset.spiralCounter);
        if (!Number.isInteger(counter) || !legalMoves.some((move) => move.counter === counter)) return;
        this.spiralSelectedCounter = counter;
        this.renderSpiral(court, match);
      });
    });
    this.ui.querySelectorAll<HTMLButtonElement>('[data-spiral-target]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!match.spiral || match.spiral.phase === 'won' || match.spiral.turnPlayerId !== this.meId || this.spiralSelectedCounter === undefined) return;
        const to = Number(button.dataset.spiralTarget);
        const move = legalMoves.find((candidate) => candidate.counter === this.spiralSelectedCounter && candidate.to === to);
        if (!move) return;
        this.network.send({ type: 'spiral-move', matchId: match.id, action: { kind: 'move', counter: move.counter, steps: move.steps } });
      });
    });
    this.updateCountdowns();
  }


  private renderHex(court: CourtState, match: MatchState) {
    if (!this.room || !match.hex) return;
    const state = match.hex;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const myTurn = state.turnPlayerId === this.meId && state.phase !== 'won';
    const turnPlayer = this.player(state.turnPlayerId);
    const size = 11;
    const winning = new Set(state.winningPath || []);
    const showWinner = state.phase === 'won' && this.winnerOverlayReady(state.resultRevealAt);
    const claimedA = state.board.filter((owner) => owner === a?.id).length;
    const claimedB = state.board.filter((owner) => owner === b?.id).length;
    const myIndex = match.playerIds.indexOf(this.meId || '');
    const instruction = state.phase === 'won'
      ? (showWinner ? `${this.player(state.winnerId || '')?.name || 'Player'} completed an unbroken chain!` : 'Chain complete! Watch the highlighted winning path.')
      : myTurn
        ? `Your goal: ${myIndex === 0 ? 'connect LEFT ↔ RIGHT' : 'connect TOP ↕ BOTTOM'}. Tap any glowing empty hex.`
        : `${turnPlayer?.name || 'Opponent'} is choosing a mini-hexagon.`;

    const cells = state.board.map((owner, index) => {
      const row = Math.floor(index / size);
      const col = index % size;
      const ownerClass = owner === match.playerIds[0] ? 'p1' : owner === match.playerIds[1] ? 'p2' : 'empty';
      const selectable = myTurn && owner === null;
      const recent = state.lastPlacedIndex === index;
      const win = winning.has(index);
      const x = 80 + col * 40 + row * 20;
      const y = 45 + row * 34.64;
      return `<button class="hex-cell ${ownerClass} ${selectable ? 'selectable' : ''} ${recent ? 'recent' : ''} ${win ? 'winning' : ''}" style="--hex-x:${x}px;--hex-y:${y}px" data-hex-cell="${index}" ${selectable ? '' : 'disabled'} aria-label="${owner ? 'Claimed mini-hexagon' : `Empty mini-hexagon row ${row + 1}, column ${col + 1}`}"><span>${owner ? '◆' : ''}</span></button>`;
    }).join('');
    const goalEdgeSegments = Array.from({ length: size }, () => '<i></i>').join('');
    const hexHalfW = 20.4;
    const hexUpperY = 11.7;
    const leftBorderPoints = Array.from({ length: size }, (_, row) => {
      const x = 80 + row * 20;
      const y = 45 + row * 34.64;
      return `${(x - hexHalfW).toFixed(1)},${(y - hexUpperY).toFixed(1)} ${(x - hexHalfW).toFixed(1)},${(y + hexUpperY).toFixed(1)}`;
    }).join(' ');
    const rightBorderPoints = Array.from({ length: size }, (_, row) => {
      const x = 80 + (size - 1) * 40 + row * 20;
      const y = 45 + row * 34.64;
      return `${(x + hexHalfW).toFixed(1)},${(y - hexUpperY).toFixed(1)} ${(x + hexHalfW).toFixed(1)},${(y + hexUpperY).toFixed(1)}`;
    }).join(' ');

    const playerGoal = (playerId?: string) => playerId === match.playerIds[0] ? 'LEFT ↔ RIGHT' : 'TOP ↕ BOTTOM';
    const playerCount = (playerId?: string) => playerId === a?.id ? claimedA : claimedB;

    this.ui.innerHTML = `
      <section class="screen threehex-screen hex-screen">
        <header class="topbar threehex-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>⬡</span><div><small>${courtLabel}</small><strong>Hex</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="threehex-main">
          <section class="threehex-board-card glass-card hex-board-card">
            <div class="threehex-board-head">
              <div><span class="eyebrow">BUILD THE UNBROKEN CHAIN</span><strong>${esc(instruction)}</strong></div>
              <div class="turn-number">TURN <b>${state.turnNumber}</b></div>
            </div>
            <div class="hex-arena" aria-label="11 by 11 Hex board">
              <div class="hex-goal-zig hex-goal-top">${goalEdgeSegments}</div>
              <div class="hex-goal-zig hex-goal-bottom">${goalEdgeSegments}</div>
              <svg class="hex-side-border-svg" aria-hidden="true">
                <polyline class="hex-side-border left" points="${leftBorderPoints}" />
                <polyline class="hex-side-border right" points="${rightBorderPoints}" />
              </svg>
              <div class="hex-board-glow"></div>
              ${cells}
              <div class="hex-side-goal-label goal-left"><strong>CONNECT<br>LEFT ↔ RIGHT</strong></div>
              <div class="hex-side-goal-label goal-right"><strong>CONNECT<br>LEFT ↔ RIGHT</strong></div>
              <div class="hex-top-goal-label goal-top">CONNECT TOP ↕ BOTTOM</div>
              <div class="hex-top-goal-label goal-bottom">CONNECT TOP ↕ BOTTOM</div>
            </div>
          </section>

          <aside class="threehex-side hex-side">
            <div class="threehex-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <span class="eyebrow">CURRENT TURN</span>
              <div class="threehex-turn-name"><i class="player-gem ${state.turnPlayerId === match.playerIds[0] ? 'p1' : 'p2'}">◆</i><strong>${esc(turnPlayer?.name || '')}</strong></div>
              <div id="turn-countdown" class="turn-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>--</span><small>SECONDS</small></div>
              <p>${myTurn ? 'Claim one empty mini-hexagon before the timer expires.' : 'Both players use the same server-controlled decision time.'}</p>
            </div>

            <div class="glass-card hex-player-card">
              <div class="mini-player-row ${state.turnPlayerId === a?.id ? 'active' : ''}"><i class="hex-mini-gem p1">◆</i><div><small>PLAYER 1 • ${playerGoal(a?.id)}</small><strong>${esc(a?.name || '')}</strong></div><b>${playerCount(a?.id)}</b></div>
              <div class="mini-player-row ${state.turnPlayerId === b?.id ? 'active' : ''}"><i class="hex-mini-gem p2">◆</i><div><small>PLAYER 2 • ${playerGoal(b?.id)}</small><strong>${esc(b?.name || '')}</strong></div><b>${playerCount(b?.id)}</b></div>
            </div>

            <div class="threehex-rule-card glass-card hex-rule-card">
              <strong>ONE HEX • ONE TURN • NO DRAWS</strong>
              <p>Claim any empty mini-hexagon. Your chain can bend and branch as long as your claimed hexes touch edge-to-edge. Corner hexagons are normal neutral cells: the cyan and pink goal rails meet behind them, so either player can claim a corner and use it in a connected path.</p>
            </div>
            <div class="threehex-action-log">${esc(state.phase === 'won' && !showWinner ? 'Winning chain complete — showing the path…' : state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer threehex-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${showWinner ? `<div class="threehex-win-overlay hex-win-overlay"><div class="win-gem">⬡</div><span>CHAIN COMPLETE!</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins</strong><small>${state.winnerId === match.playerIds[0] ? 'LEFT ↔ RIGHT connected' : 'TOP ↕ BOTTOM connected'} • Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-hex-cell]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!match.hex || match.hex.phase === 'won' || match.hex.turnPlayerId !== this.meId) return;
        const to = Number(button.dataset.hexCell);
        if (!Number.isInteger(to) || match.hex.board[to] !== null) return;
        this.network.send({ type: 'hex-move', matchId: match.id, action: { kind: 'place', to } });
      });
    });
    this.updateCountdowns();
  }

  private renderFactorGame(court: CourtState, match: MatchState) {
    if (!this.room || !match.factorGame) return;
    const state = match.factorGame;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const myTurn = state.turnPlayerId === this.meId && state.phase === 'playing';
    const turnPlayer = this.player(state.turnPlayerId);
    const remainingCount = state.board.filter((owner) => owner === null).length;
    const lastFactors = new Set(state.lastScoredFactors || []);
    const playerClass = (owner: string | null) => owner === match.playerIds[0] ? 'p1' : owner === match.playerIds[1] ? 'p2' : '';
    const cells = state.board.map((owner, index) => {
      const number = index + 1;
      const selectable = myTurn && owner === null;
      const selected = state.lastSelectedNumber === number;
      const scoredFactor = lastFactors.has(number);
      const classes = ['factor-cell', owner ? 'claimed' : 'available', playerClass(owner), selected ? 'recent-selected' : '', scoredFactor ? 'recent-factor' : ''].filter(Boolean).join(' ');
      const ownerName = owner ? this.player(owner)?.name || 'Player' : '';
      const hint = owner ? `${number}, scored by ${ownerName}` : `${number}, available`;
      return `<button class="${classes}" data-factor-number="${number}" ${selectable ? '' : 'disabled'} aria-label="${esc(hint)}" title="${esc(hint)}"><span>${number}</span>${owner === null ? '' : '<small>SCORED</small>'}</button>`;
    }).join('');
    const scoreA = state.scores[a?.id || ''] || 0;
    const scoreB = state.scores[b?.id || ''] || 0;
    const instruction = state.phase === 'tied'
      ? 'Scores are tied — a fresh board will begin automatically.'
      : state.phase === 'won'
        ? `${this.player(state.winnerId || '')?.name || 'Player'} has the highest score.`
        : myTurn
          ? 'Choose any available number.'
          : `${turnPlayer?.name || 'Opponent'} is choosing a number.`;
    const timeoutForfeit = Boolean(state.lastForfeitNumber && state.lastAction.startsWith('Time expired'));
    const turnSummary = state.lastForfeitNumber
      ? `${state.lastAction} Turn passes to ${turnPlayer?.name || 'the opponent'}.`
      : state.lastSelectedNumber
        ? `Last turn: ${this.player(state.lastSelectingPlayerId || '')?.name || 'Player'} chose ${state.lastSelectedNumber}; opponent received ${state.lastScoredFactors.join(', ')}.`
        : 'Choose carefully: your opponent receives every factor that is still available.';

    this.ui.innerHTML = `
      <section class="screen threehex-screen factor-screen">
        <header class="topbar threehex-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>÷</span><div><small>${courtLabel}</small><strong>The Factor Game</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="threehex-main factor-main">
          <section class="threehex-board-card glass-card factor-board-card">
            <div class="threehex-board-head factor-board-head">
              <div><span class="eyebrow">NUMBER BOARD • 1–49</span><strong>${esc(instruction)}</strong></div>
              <div class="factor-board-stats"><span><b>${remainingCount}</b> numbers left</span></div>
            </div>
            <div class="factor-grid" aria-label="Factor Game number board">${cells}</div>
            <div class="factor-key"><span><i class="factor-key-dot available"></i>Available</span><span><i class="factor-key-dot p1"></i>Player 1 scored</span><span><i class="factor-key-dot p2"></i>Player 2 scored</span></div>
          </section>

          <aside class="threehex-side factor-side">
            <div class="threehex-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <span class="eyebrow">CURRENT TURN</span>
              <div class="threehex-turn-name"><i class="counter-dot ${state.turnPlayerId === match.playerIds[0] ? 'p1' : 'p2'}">◆</i><strong>${esc(turnPlayer?.name || '')}</strong></div>
              ${state.phase === 'playing' ? `<div id="turn-countdown" class="turn-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>--</span><small>SECONDS</small></div>` : ''}
              <p>${myTurn ? 'Your decision — any available number can be tapped.' : state.phase === 'playing' ? 'The server-controlled timer is running.' : 'This board is no longer accepting moves.'}</p>
            </div>

            <div class="threehex-score-card glass-card factor-score-card">
              <div class="mini-player-row ${state.turnPlayerId === a?.id ? 'active' : ''}"><i class="counter-dot p1">◆</i><div><small>PLAYER 1</small><strong>${esc(a?.name || '')}</strong></div><b>${scoreA}</b></div>
              <div class="mini-player-row ${state.turnPlayerId === b?.id ? 'active' : ''}"><i class="counter-dot p2">◆</i><div><small>PLAYER 2</small><strong>${esc(b?.name || '')}</strong></div><b>${scoreB}</b></div>
            </div>

            <div class="threehex-rule-card glass-card factor-rule-card">
              <strong>YOU SCORE THE NUMBER • OPPONENT GETS ITS FACTORS</strong>
              <p>Only factors still showing on the board are awarded. If your choice has no remaining factors, you score 0 and forfeit the turn.</p>
            </div>
            <div class="threehex-action-log factor-action-log ${state.lastForfeitNumber ? 'forfeit-feedback' : ''}">${state.lastForfeitNumber ? `<strong>${timeoutForfeit ? 'TIME EXPIRED — 0 POINTS' : 'NO REMAINING FACTORS — 0 POINTS'}</strong><span>${esc(turnSummary)}</span>` : `${esc(turnSummary)}<br>${esc(state.lastAction)}`}</div>
          </aside>
        </main>

        <footer class="game-shell-footer threehex-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'won' ? `<div class="threehex-win-overlay factor-win-overlay"><div class="win-gem">÷</div><span>FACTOR GAME COMPLETE</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins ${state.scores[state.winnerId || ''] || 0}-${state.scores[otherFactorPlayer(state.winnerId || '')] || 0}</strong><small>Returning to King of the Court…</small></div>` : ''}
        ${state.phase === 'tied' ? `<div class="threehex-win-overlay factor-tie-overlay"><div class="win-gem">=</div><span>SCORES TIED</span><strong>${scoreA} – ${scoreB}</strong><small>Fresh board starting automatically…</small></div>` : ''}
      </section>`;

    function otherFactorPlayer(playerId: string) {
      return match.playerIds[0] === playerId ? match.playerIds[1] : match.playerIds[0];
    }

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-factor-number]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!match.factorGame || match.factorGame.phase !== 'playing' || match.factorGame.turnPlayerId !== this.meId) return;
        const number = Number(button.dataset.factorNumber);
        if (!Number.isInteger(number) || number < 1 || number > 49 || match.factorGame.board[number - 1] !== null) return;
        this.network.send({ type: 'factor-game-move', matchId: match.id, action: { kind: 'select', number } });
      });
    });
    this.updateCountdowns();
  }

  private renderHedron(court: CourtState, match: MatchState) {
    if (!this.room || !match.hedron) return;
    const state = match.hedron;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const myTurn = state.turnPlayerId === this.meId && state.phase === 'playing';
    const turnPlayer = this.player(state.turnPlayerId);
    const remainingWalls = state.walls.filter((owner) => owner === null).length;
    const remainingRooms = state.rooms.filter((owner) => owner === null).length;
    const scoreA = state.scores[a?.id || ''] || 0;
    const scoreB = state.scores[b?.id || ''] || 0;
    const roomsA = state.rooms.filter((owner) => owner === a?.id).length;
    const roomsB = state.rooms.filter((owner) => owner === b?.id).length;
    const recentRooms = new Set(state.lastClaimedRooms || []);
    const playerClass = (owner: string | null) => owner === match.playerIds[0] ? 'p1' : owner === match.playerIds[1] ? 'p2' : '';

    const point = (key: HedronPointKey) => HEDRON_POINTS[key];
    const polygonPoints = (keys: readonly HedronPointKey[]) => keys.map((key) => point(key).join(',')).join(' ');
    const roomMarkup = HEDRON_ROOMS.map((room, index) => {
      const owner = state.rooms[index] || null;
      const [x, y] = room.label;
      const [ownerX, ownerY] = room.ownerLabel || [x, y + 24];
      const classes = ['hedron-room', owner ? 'claimed' : 'open', playerClass(owner), recentRooms.has(index) ? 'recent-claim' : ''].filter(Boolean).join(' ');
      return `<g class="hedron-room-group"><polygon class="${classes}" points="${polygonPoints(room.points)}" vector-effect="non-scaling-stroke"></polygon><text class="hedron-room-value ${playerClass(owner)}" x="${x}" y="${y + 7}" text-anchor="middle">${room.value}</text>${owner ? `<text class="hedron-room-owner ${playerClass(owner)}" x="${ownerX}" y="${ownerY}" text-anchor="middle">CLAIMED</text>` : ''}</g>`;
    }).join('');

    const wallMarkup = HEDRON_WALLS.map(([fromKey, toKey], index) => {
      const owner = state.walls[index] || null;
      const [x1, y1] = point(fromKey);
      const [x2, y2] = point(toKey);
      const selectable = myTurn && owner === null;
      const ownerName = owner ? this.player(owner)?.name || 'Player' : '';
      const label = owner ? `Wall ${index + 1}, claimed by ${ownerName}` : `Wall ${index + 1}, available`;
      const classes = ['hedron-wall-group', owner ? 'claimed' : 'open', playerClass(owner), selectable ? 'selectable' : '', state.lastWallIndex === index ? 'recent' : ''].filter(Boolean).join(' ');
      return `<g class="${classes}" data-hedron-wall="${index}" role="button" tabindex="${selectable ? '0' : '-1'}" aria-label="${esc(label)}"><line class="hedron-wall-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" vector-effect="non-scaling-stroke"></line><line class="hedron-wall-visible" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" vector-effect="non-scaling-stroke"></line></g>`;
    }).join('');

    const instruction = state.phase === 'won'
      ? `${this.player(state.winnerId || '')?.name || 'Player'} has the highest room total.`
      : myTurn
        ? 'Choose any unclaimed wall. Every wall has a large touch target.'
        : `${turnPlayer?.name || 'Opponent'} is choosing a wall.`;

    this.ui.innerHTML = `
      <section class="screen threehex-screen hedron-screen">
        <header class="topbar threehex-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title"><span>◇</span><div><small>${courtLabel}</small><strong>Hedron</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="threehex-main hedron-main">
          <section class="threehex-board-card glass-card hedron-board-card">
            <div class="threehex-board-head hedron-board-head">
              <div><span class="eyebrow">11 ROOMS • 30 WALLS</span><strong>${esc(instruction)}</strong></div>
              <div class="hedron-board-stats"><span><b>${remainingRooms}</b> rooms left</span><span><b>${remainingWalls}</b> walls left</span></div>
            </div>
            <div class="hedron-board-wrap">
              <svg class="hedron-board" viewBox="20 0 660 455" role="img" aria-label="Hedron board with eleven numbered pentagonal rooms and selectable walls">
                <g class="hedron-room-layer">${roomMarkup}</g>
                <g class="hedron-wall-layer">${wallMarkup}</g>
              </svg>
            </div>
            <div class="hedron-key"><span><i class="hedron-key-line available"></i>Available wall</span><span><i class="hedron-key-line p1"></i>Player 1 wall</span><span><i class="hedron-key-line p2"></i>Player 2 wall</span><span><i class="hedron-key-room"></i>3 of 5 walls secures a room</span></div>
          </section>

          <aside class="threehex-side hedron-side">
            <div class="threehex-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <span class="eyebrow">CURRENT TURN</span>
              <div class="threehex-turn-name"><i class="counter-dot ${state.turnPlayerId === match.playerIds[0] ? 'p1' : 'p2'}">◆</i><strong>${esc(turnPlayer?.name || '')}</strong></div>
              ${state.phase === 'playing' ? `<div id="turn-countdown" class="turn-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>--</span><small>SECONDS</small></div>` : ''}
              <p>${myTurn ? 'Tap or click one wall. Claimed walls cannot be selected again.' : state.phase === 'playing' ? 'The server-controlled timer is running.' : 'This board is complete.'}</p>
            </div>

            <div class="threehex-score-card glass-card hedron-score-card">
              <div class="mini-player-row ${state.turnPlayerId === a?.id ? 'active' : ''}"><i class="counter-dot p1">◆</i><div><small>PLAYER 1 • ${roomsA} ROOM${roomsA === 1 ? '' : 'S'}</small><strong>${esc(a?.name || '')}</strong></div><b>${scoreA}</b></div>
              <div class="mini-player-row ${state.turnPlayerId === b?.id ? 'active' : ''}"><i class="counter-dot p2">◆</i><div><small>PLAYER 2 • ${roomsB} ROOM${roomsB === 1 ? '' : 'S'}</small><strong>${esc(b?.name || '')}</strong></div><b>${scoreB}</b></div>
            </div>

            <div class="threehex-rule-card glass-card hedron-rule-card">
              <strong>CONTROL MORE WALLS • CLAIM THE ROOM</strong>
              <p>Every room has five walls. Once you own three of them, your opponent cannot overtake you, so that room is secured and its printed value is added to your score.</p>
            </div>
            <div class="threehex-action-log hedron-action-log ${recentRooms.size ? 'room-claim-feedback' : ''}">${recentRooms.size ? `<strong>ROOM SECURED</strong><span>${esc(state.lastAction)}</span>` : esc(state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer threehex-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'won' ? `<div class="threehex-win-overlay hedron-win-overlay"><div class="win-gem">◇</div><span>HEDRON COMPLETE</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins ${state.scores[state.winnerId || ''] || 0}-${state.scores[otherHedronPlayer(state.winnerId || '')] || 0}</strong><small>Returning to King of the Court…</small></div>` : ''}
      </section>`;

    function otherHedronPlayer(playerId: string) {
      return match.playerIds[0] === playerId ? match.playerIds[1] : match.playerIds[0];
    }

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());

    const chooseWall = (wallGroup: SVGGElement) => {
      if (!match.hedron || match.hedron.phase !== 'playing' || match.hedron.turnPlayerId !== this.meId) return;
      const wall = Number(wallGroup.dataset.hedronWall);
      if (!Number.isInteger(wall) || wall < 0 || wall >= HEDRON_WALLS.length || match.hedron.walls[wall] !== null) return;
      if (wallGroup.classList.contains('pending')) return;
      wallGroup.classList.add('pending');
      this.network.send({ type: 'hedron-move', matchId: match.id, action: { kind: 'select-wall', wall } });
    };

    this.ui.querySelectorAll<SVGGElement>('[data-hedron-wall]').forEach((wallGroup) => {
      wallGroup.addEventListener('click', () => chooseWall(wallGroup));
      wallGroup.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        chooseWall(wallGroup);
      });
    });
    this.updateCountdowns();
  }


  private renderMulti(court: CourtState, match: MatchState) {
    if (!this.room || !match.multi) return;
    const state = match.multi;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const xPlayer = this.player(state.xPlayerId);
    const oPlayer = this.player(state.oPlayerId);
    const isMyTurn = state.turnPlayerId === this.meId && !['won', 'tied'].includes(state.phase);
    const winningBoards = new Set(state.winningLine || []);
    const recentBoards = new Set(state.lastResolvedBoards || []);
    const recentCells = new Set(state.lastClaimedCells || []);
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

    let forcedToken: 0 | 1 | undefined;
    if (state.phase === 'opening-first' || state.phase === 'bonus-first') forcedToken = 0;
    else if (state.phase === 'opening-second' || state.phase === 'bonus-second') forcedToken = 1;
    const selectedToken = forcedToken ?? (state.phase === 'normal' ? this.multiSelectedToken : undefined);
    const canChooseFactor = isMyTurn && selectedToken !== undefined;

    const markFor = (playerId: string | null) => playerId === state.xPlayerId ? 'X' : playerId === state.oPlayerId ? 'O' : '';
    const playerClass = (playerId: string | null) => playerId === match.playerIds[0] ? 'p1' : playerId === match.playerIds[1] ? 'p2' : '';
    const boardMarkup = Array.from({ length: 9 }, (_, board) => {
      const owner = state.largeBoards[board];
      const bigMark = owner === 'wild' ? 'X/O' : owner ? markFor(owner) : '';
      const cells = Array.from({ length: 9 }, (_, local) => {
        const index = board * 9 + local;
        const cellOwner = state.cells[index];
        const product = (board + 1) * (local + 1);
        return `<div class="multi-cell ${cellOwner ? `claimed ${playerClass(cellOwner)}` : ''} ${recentCells.has(index) ? 'recent' : ''}">
          <span class="multi-product">${product}</span>
          <small>${board + 1}×${local + 1}</small>
          ${cellOwner ? `<b class="multi-mark ${playerClass(cellOwner)}">${markFor(cellOwner)}</b>` : ''}
        </div>`;
      }).join('');
      return `<section class="multi-mini-board factor-${board + 1} ${owner ? `resolved ${owner === 'wild' ? 'wild' : playerClass(owner)}` : ''} ${winningBoards.has(board) ? 'global-win' : ''} ${recentBoards.has(board) ? 'recent-resolve' : ''}">
        <div class="multi-mini-label"><b>${board + 1}</b><span>× 1–9</span></div>
        <div class="multi-mini-grid">${cells}</div>
        ${owner ? `<div class="multi-big-mark ${owner === 'wild' ? 'wild' : playerClass(owner)}"><strong>${bigMark}</strong><span>${owner === 'wild' ? 'WILD' : 'WON'}</span></div>` : ''}
      </section>`;
    }).join('');

    const factorMarkup = Array.from({ length: 9 }, (_, i) => {
      const factor = i + 1;
      const tokenA = state.tokenValues[0] === factor;
      const tokenB = state.tokenValues[1] === factor;
      // Deliberately do not reveal whether a factor would produce an available
      // multiplication square. Every 1–9 tile keeps the same visual availability.
      return `<button class="multi-factor factor-${factor} ${canChooseFactor ? 'ready' : ''}" data-multi-factor="${factor}" aria-label="Choose factor ${factor}">
        <strong>${factor}</strong>
        <span class="factor-tokens">${tokenA ? '<i class="token-a">A</i>' : ''}${tokenB ? '<i class="token-b">B</i>' : ''}</span>
      </button>`;
    }).join('');

    const phaseTitle = state.phase === 'opening-first' ? 'FIRST TURN • TOKEN A'
      : state.phase === 'opening-second' ? 'FIRST TURN • CHOOSE TOKEN B'
      : state.phase === 'bonus-first' ? 'FREE REPOSITION • TOKEN A'
      : state.phase === 'bonus-second' ? 'FREE REPOSITION • TOKEN B'
      : state.phase === 'normal' ? 'CHOOSE A OR B • THEN A NUMBER'
      : state.phase === 'tied' ? 'CAT’S GAME • RESETTING'
      : 'MULTI COMPLETE';
    const phaseHelp = state.phase === 'opening-first' ? 'Choose a number from 1–9.'
      : state.phase === 'opening-second' ? 'Token A is locked on 1. Choose any 1–9 value for Token B; your product is 1 × B.'
      : state.phase === 'bonus-first' ? 'Your opponent had no scoring move. Reposition Token A first.'
      : state.phase === 'bonus-second' ? 'Now reposition Token B. Work out which product can still claim a square.'
      : state.phase === 'normal' ? (selectedToken === undefined ? 'Choose Token A or Token B below. Then choose its new number on the Factor Board.' : `Token ${selectedToken === 0 ? 'A' : 'B'} selected — now choose any number 1–9 on the Factor Board.`)
      : state.lastAction;
    const currentMark = state.turnPlayerId === state.xPlayerId ? 'X' : 'O';
    const currentName = this.player(state.turnPlayerId)?.name || 'Player';
    const productPreview = state.tokenValues[0] && state.tokenValues[1] ? state.tokenValues[0] * state.tokenValues[1] : undefined;
    const factorBoardPrompt = state.phase === 'opening-second'
      ? 'CHOOSE TOKEN B • 1–9'
      : selectedToken === undefined
        ? 'SELECT A OR B ABOVE'
        : `MOVE TOKEN ${selectedToken === 0 ? 'A' : 'B'} • CHOOSE 1–9`;
    const resolvedCount = state.largeBoards.filter(Boolean).length;
    const winnerReady = state.phase === 'won' && this.winnerOverlayReady(state.resultRevealAt);

    this.ui.innerHTML = `
      <section class="screen multi-screen">
        <header class="topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title multi-title"><span>×</span><div><small>${courtLabel}</small><strong>Multi</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="multi-main">
          <section class="multi-board-card glass-card">
            <div class="multi-board-head">
              <div><span class="eyebrow">MULTI BOARD • 9 TIC-TAC-TOE ROOMS</span><strong>Win 3 colourful large squares in a row</strong></div>
              <div class="multi-board-stat"><b>${resolvedCount}</b><span>/ 9 resolved</span></div>
            </div>
            <div class="multi-board-grid">${boardMarkup}</div>
            <div class="multi-board-key"><span><i class="x-key">X</i>${esc(xPlayer?.name || 'Player')}</span><span><i class="o-key">O</i>${esc(oPlayer?.name || 'Player')}</span><span><i class="wild-key">X/O</i>Wild counts for either player</span></div>
          </section>

          <aside class="multi-side">
            <section class="multi-turn-card glass-card">
              <div class="multi-turn-head"><div><span class="eyebrow">${esc(phaseTitle)}</span><strong><i>${currentMark}</i> ${esc(currentName)}</strong></div>${!['won','tied'].includes(state.phase) ? `<div id="turn-countdown" class="turn-countdown multi-turn-ring" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>${this.room.turnSeconds}</span><small>SECONDS</small></div>` : ''}</div>
              <p>${esc(phaseHelp)}</p>
              ${state.phase === 'opening-second' && isMyTurn ? `<div class="multi-opening-tokens"><div class="locked"><i class="token-a">A</i><span>1</span><small>LOCKED</small></div><div class="selected"><i class="token-b">B</i><span>${state.tokenValues[1] ?? '?'}</span><small>CHOOSE BELOW</small></div></div>` : ''}
              ${state.phase === 'normal' && isMyTurn ? `<div class="multi-token-choice"><button data-multi-token="0" class="${this.multiSelectedToken === 0 ? 'selected' : ''}"><i class="token-a">A</i><strong>Token A</strong><span>${state.tokenValues[0] ?? '—'}</span></button><button data-multi-token="1" class="${this.multiSelectedToken === 1 ? 'selected' : ''}"><i class="token-b">B</i><strong>Token B</strong><span>${state.tokenValues[1] ?? '—'}</span></button></div>` : ''}
            </section>

            <section class="multi-factor-card glass-card ${canChooseFactor ? 'choice-active' : ''}">
              <div class="multi-factor-head"><div><span class="eyebrow">FACTOR BOARD</span><strong>${esc(factorBoardPrompt)}</strong></div><div class="multi-product-chip"><span>PRODUCT</span><b>${productPreview ?? '—'}</b></div></div>
              <div class="multi-factor-grid">${factorMarkup}</div>
            </section>

            <section class="multi-player-card glass-card">
              <div class="multi-player-row ${state.xPlayerId === this.meId ? 'me' : ''}"><i class="multi-symbol x">X</i><div><small>PLAYER X</small><strong>${esc(xPlayer?.name || '')}</strong></div><b>${state.largeBoards.filter((owner) => owner === state.xPlayerId).length}</b></div>
              <div class="multi-player-row ${state.oPlayerId === this.meId ? 'me' : ''}"><i class="multi-symbol o">O</i><div><small>PLAYER O</small><strong>${esc(oPlayer?.name || '')}</strong></div><b>${state.largeBoards.filter((owner) => owner === state.oPlayerId).length}</b></div>
            </section>

            <div class="multi-action-log ${state.lastResolvedBoards.length ? 'resolved' : ''}">${esc(state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer multi-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'tied' ? `<div class="multi-result-overlay"><div class="multi-result-gem">×</div><span>CAT’S GAME</span><strong>No overall three-in-a-row</strong><small>Fresh Multi board starting with the other player as X…</small></div>` : ''}
        ${winnerReady ? `<div class="multi-result-overlay"><div class="multi-result-gem">${state.winnerId === state.xPlayerId ? 'X' : 'O'}</div><span>THREE LARGE SQUARES IN A ROW</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins Multi!</strong><small>Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLElement>('[data-multi-token]').forEach((button) => button.addEventListener('click', () => {
      if (!isMyTurn || state.phase !== 'normal') return;
      const token = Number(button.dataset.multiToken);
      if (token !== 0 && token !== 1) return;
      this.multiSelectedToken = token as 0 | 1;
      this.renderMulti(court, match);
    }));
    this.ui.querySelectorAll<HTMLButtonElement>('[data-multi-factor]').forEach((button) => button.addEventListener('click', () => {
      if (!isMyTurn || selectedToken === undefined) return;
      const factor = Number(button.dataset.multiFactor);
      if (!Number.isInteger(factor) || factor < 1 || factor > 9) return;
      // Send the attempted factor to the authoritative server without exposing
      // whether the resulting product can still claim a square.
      this.network.send({ type: 'multi-move', matchId: match.id, action: { kind: 'move-token', token: selectedToken, factor } });
    }));
    this.updateCountdowns();
  }

  private renderUltimateTtt(court: CourtState, match: MatchState) {
    if (!this.room || !match.ultimateTtt) return;
    const state = match.ultimateTtt;
    const last = this.room.courts.length - 1;
    const courtLabel = court.index === last ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const xPlayer = this.player(state.xPlayerId);
    const oPlayer = this.player(state.oPlayerId);
    const turnPlayer = this.player(state.turnPlayerId);
    const myTurn = state.phase === 'playing' && state.turnPlayerId === this.meId;
    const winningBoards = new Set(state.winningLine || []);
    const lastPlaced = state.lastPlacedIndex;
    const forcedBoard = state.phase === 'playing' ? state.forcedBoard : null;
    const boardHasSpace = (board: number) => state.localBoards[board] === null && state.cells.slice(board * 9, board * 9 + 9).some((owner) => owner === null);
    const allowedBoards = forcedBoard !== null && boardHasSpace(forcedBoard)
      ? [forcedBoard]
      : Array.from({ length: 9 }, (_, board) => board).filter(boardHasSpace);
    const allowedSet = new Set(allowedBoards);
    const markFor = (playerId: string | null) => playerId === state.xPlayerId ? 'X' : playerId === state.oPlayerId ? 'O' : '';
    const currentMark = state.turnPlayerId === state.xPlayerId ? 'X' : 'O';
    const xBoards = state.localBoards.filter((owner) => owner === state.xPlayerId).length;
    const oBoards = state.localBoards.filter((owner) => owner === state.oPlayerId).length;
    const closedBoards = state.localBoards.filter((owner) => owner !== null).length;

    const localBoards = Array.from({ length: 9 }, (_, board) => {
      const owner = state.localBoards[board];
      const isForced = forcedBoard === board && boardHasSpace(board);
      const canUseBoard = state.phase === 'playing' && allowedSet.has(board);
      const cells = Array.from({ length: 9 }, (_, local) => {
        const index = board * 9 + local;
        const cellOwner = state.cells[index];
        const selectable = myTurn && canUseBoard && cellOwner === null;
        const mark = markFor(cellOwner);
        const cellClass = cellOwner === state.xPlayerId ? 'x' : cellOwner === state.oPlayerId ? 'o' : 'empty';
        return `<button class="ultimate-cell ${cellClass} ${selectable ? 'selectable' : ''} ${lastPlaced === index ? 'last' : ''}" data-ultimate-cell="${index}" ${selectable ? '' : 'disabled'} aria-label="Local board ${board + 1}, square ${local + 1}${mark ? `, ${mark}` : ''}">${mark ? `<span>${mark}</span>` : ''}</button>`;
      }).join('');
      const ownerClass = owner === state.xPlayerId ? 'x-won' : owner === state.oPlayerId ? 'o-won' : owner === 'draw' ? 'drawn' : '';
      const resolvedMark = owner === 'draw' ? 'X/O' : owner ? markFor(owner) : '';
      return `<section class="ultimate-local-board ${ownerClass} ${isForced ? 'forced' : ''} ${canUseBoard && forcedBoard === null ? 'free-choice' : ''} ${winningBoards.has(board) ? 'global-win' : ''} ${state.lastResolvedBoard === board ? 'just-resolved' : ''}">
        <div class="ultimate-local-label"><span>LOCAL</span><b>${board + 1}</b></div>
        <div class="ultimate-local-grid">${cells}</div>
        ${owner ? `<div class="ultimate-local-result ${ownerClass}"><strong>${resolvedMark}</strong><span>${owner === 'draw' ? 'WILD' : 'WON'}</span></div>` : ''}
      </section>`;
    }).join('');

    const targetGuide = Array.from({ length: 9 }, (_, board) => {
      const open = boardHasSpace(board);
      const active = forcedBoard === board && open;
      return `<span class="${active ? 'active' : ''} ${open ? 'open' : 'closed'}">${board + 1}</span>`;
    }).join('');

    const turnHeadline = state.phase === 'won'
      ? 'GLOBAL BOARD WON'
      : state.phase === 'tied'
        ? 'LOCAL BOARD WINS TIED'
        : forcedBoard === null
          ? 'FREE CHOICE'
          : `PLAY IN LOCAL BOARD ${forcedBoard + 1}`;
    const turnHelp = state.phase !== 'playing'
      ? state.lastAction
      : forcedBoard === null
        ? 'Choose any empty square in any local board that is still open.'
        : `Your opponent sent you to local board ${forcedBoard + 1}. Choose one empty square inside that board.`;
    const routeCopy = forcedBoard === null
      ? 'The previous destination is closed or this is the opening move, so any open local board may be used.'
      : `Whichever square you choose inside board ${forcedBoard + 1} sends your opponent to the matching local-board position.`;
    const winnerReady = state.phase === 'won' && this.winnerOverlayReady(state.resultRevealAt);

    this.ui.innerHTML = `
      <section class="screen ultimate-screen">
        <header class="topbar ultimate-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title ultimate-title"><span>#</span><div><small>${courtLabel}</small><strong>Ultimate Tic-Tac-Toe</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="ultimate-main">
          <section class="ultimate-board-card glass-card">
            <div class="ultimate-board-head">
              <div><span class="eyebrow">9 LOCAL BOARDS • 1 GLOBAL BOARD</span><strong>Win three local boards in a row</strong></div>
              <div class="ultimate-board-stat"><b>${closedBoards}</b><span>/ 9 closed</span></div>
            </div>
            <div class="ultimate-global-grid" aria-label="Ultimate Tic-Tac-Toe global board">${localBoards}</div>
            <div class="ultimate-board-key"><span><i class="x-key">X</i>${esc(xPlayer?.name || 'Player X')}</span><span><i class="o-key">O</i>${esc(oPlayer?.name || 'Player O')}</span><span><i class="ultimate-target-key"></i>Required local board</span></div>
          </section>

          <aside class="ultimate-side">
            <section class="ultimate-turn-card glass-card">
              <div class="ultimate-turn-head">
                <div><span class="eyebrow">${esc(turnHeadline)}</span><strong><i class="${currentMark === 'X' ? 'x' : 'o'}">${currentMark}</i>${esc(turnPlayer?.name || 'Player')}</strong></div>
                ${state.phase === 'playing' ? `<div id="turn-countdown" class="turn-countdown ultimate-turn-ring" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>${this.room.turnSeconds}</span><small>SECONDS</small></div>` : ''}
              </div>
              <p>${esc(turnHelp)}</p>
            </section>

            <section class="ultimate-route-card glass-card ${forcedBoard !== null ? 'forced' : 'free'}">
              <div><span class="eyebrow">WHERE DOES THE NEXT MOVE GO?</span><strong>${forcedBoard === null ? 'ANY OPEN LOCAL BOARD' : `LOCAL BOARD ${forcedBoard + 1}`}</strong></div>
              <div class="ultimate-route-grid">${targetGuide}</div>
              <p>${esc(routeCopy)}</p>
            </section>

            <section class="ultimate-player-card glass-card">
              <div class="ultimate-player-row ${state.xPlayerId === this.meId ? 'me' : ''}"><i class="ultimate-symbol x">X</i><div><small>PLAYER X • STARTED</small><strong>${esc(xPlayer?.name || '')}</strong></div><b>${xBoards}</b></div>
              <div class="ultimate-player-row ${state.oPlayerId === this.meId ? 'me' : ''}"><i class="ultimate-symbol o">O</i><div><small>PLAYER O</small><strong>${esc(oPlayer?.name || '')}</strong></div><b>${oBoards}</b></div>
            </section>

            <div class="ultimate-action-log ${state.lastResolvedBoard !== undefined ? 'resolved' : ''}">${esc(state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer ultimate-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'tied' ? `<div class="ultimate-result-overlay"><div class="ultimate-result-gem">#</div><span>NO OVERALL LINE</span><strong>Little-board wins are tied too</strong><small>Fresh board starting with the other player as X…</small></div>` : ''}
        ${winnerReady ? `<div class="ultimate-result-overlay"><div class="ultimate-result-gem ${state.winnerId === state.xPlayerId ? 'x' : 'o'}">${state.winnerId === state.xPlayerId ? 'X' : 'O'}</div><span>THREE LOCAL BOARDS IN A ROW</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins Ultimate TTT!</strong><small>Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-ultimate-cell]').forEach((button) => button.addEventListener('click', () => {
      if (!myTurn) return;
      const index = Number(button.dataset.ultimateCell);
      if (!Number.isInteger(index) || index < 0 || index >= 81) return;
      this.network.send({ type: 'ultimate-ttt-move', matchId: match.id, action: { kind: 'place', index } });
    }));
    this.updateCountdowns();
  }

  private luckyDieMarkup(value: number) {
    const pips: Record<number, number[]> = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8],
    };
    const active = new Set(pips[value] || []);
    return `<div class="lucky-die die-${value}" aria-label="Rolled ${value}">${Array.from({ length: 9 }, (_, index) => `<i class="${active.has(index) ? 'on' : ''}"></i>`).join('')}<b>${value}</b></div>`;
  }

  private renderLuckyThirteen(court: CourtState, match: MatchState) {
    if (!this.room || !match.luckyThirteen) return;
    const state = match.luckyThirteen;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const turnPlayer = this.player(state.turnPlayerId);
    const myTurn = state.phase === 'playing' && state.turnPlayerId === this.meId;
    const lastCourt = this.room.courts.length - 1;
    const courtLabel = court.index === lastCourt ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const winning = new Set(state.winningLine || []);
    const filled = state.values.filter((value) => value !== null).length;
    const showWinner = state.phase === 'won' && this.winnerOverlayReady(state.resultRevealAt);
    const playerClass = (playerId: string | null) => playerId === match.playerIds[0] ? 'p1' : playerId === match.playerIds[1] ? 'p2' : '';
    const playerPlaced = (playerId?: string) => state.owners.filter((owner) => owner === playerId).length;
    const winningEquation = state.winningLine?.map((index) => state.values[index]).join(' + ') || '';

    const cells = state.values.map((value, index) => {
      const owner = state.owners[index];
      const selectable = myTurn && value === null;
      const classes = [
        'lucky-cell', value === null ? 'empty' : 'filled', owner ? playerClass(owner) : '', value !== null ? `value-${value}` : '',
        state.lastPlacedIndex === index ? 'last' : '', winning.has(index) ? 'winning' : '', selectable ? 'selectable' : '',
      ].filter(Boolean).join(' ');
      return `<button class="${classes}" data-lucky-cell="${index}" ${selectable ? '' : 'disabled'} aria-label="${value === null ? `Empty square ${index + 1}` : `Square ${index + 1}, number ${value}`}">
        ${value !== null ? `<span class="lucky-number">${value}</span><i class="lucky-owner ${playerClass(owner)}">◆</i>` : '<span class="lucky-empty-mark">+</span>'}
      </button>`;
    }).join('');

    const phaseTitle = state.phase === 'won'
      ? (showWinner ? 'LUCKY 13!' : 'WINNING LINE FOUND')
      : state.phase === 'tied'
        ? 'GRID FULL'
        : 'PLACE YOUR ROLL';
    const phaseHelp = state.phase === 'won'
      ? (showWinner
        ? `${this.player(state.winnerId || '')?.name || 'Player'} made ${winningEquation} = 13.`
        : `Watch the highlighted three numbers: ${winningEquation} = 13.`)
      : state.phase === 'tied'
        ? 'No line totalled 13. A fresh grid is about to start.'
        : myTurn
          ? `You rolled ${state.rolledValue}. Tap any empty square.`
          : `${turnPlayer?.name || 'Opponent'} rolled ${state.rolledValue} and is choosing a square.`;

    this.ui.innerHTML = `
      <section class="screen lucky-screen">
        <header class="topbar lucky-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title lucky-title"><span>13</span><div><small>${courtLabel}</small><strong>Lucky Thirteen</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="lucky-main">
          <section class="lucky-board-card glass-card">
            <div class="lucky-board-head">
              <div><span class="eyebrow">4 × 4 NUMBER GRID</span><strong>Make 3 neighbouring numbers in a straight line total 13</strong></div>
              <div class="lucky-grid-stat"><b>${filled}</b><span>/ 16 filled</span></div>
            </div>
            <div class="lucky-board-wrap">
              <div class="lucky-grid" aria-label="Lucky Thirteen four by four grid">${cells}</div>
            </div>
            <div class="lucky-board-key">
              <span><i class="lucky-key p1">◆</i>${esc(a?.name || 'Player 1')} placed it</span>
              <span><i class="lucky-key p2">◆</i>${esc(b?.name || 'Player 2')} placed it</span>
              <span><i class="lucky-key shared">13</i>The winning 3 numbers may mix both colours</span>
            </div>
          </section>

          <aside class="lucky-side">
            <section class="lucky-turn-card glass-card ${myTurn ? 'my-turn' : ''}">
              <div class="lucky-turn-copy"><span class="eyebrow">${esc(phaseTitle)}</span><strong><i class="counter-dot ${state.turnPlayerId === match.playerIds[0] ? 'p1' : 'p2'}">◆</i>${esc(turnPlayer?.name || '')}</strong><p>${esc(phaseHelp)}</p></div>
              ${state.phase === 'playing' ? `<div class="lucky-roll-column">${this.luckyDieMarkup(state.rolledValue)}<div id="turn-countdown" class="turn-countdown lucky-countdown" data-deadline="${state.turnDeadline}" data-total="${this.room.turnSeconds}"><span>${this.room.turnSeconds}</span><small>SECONDS</small></div></div>` : ''}
            </section>

            <section class="lucky-players-card glass-card">
              <div class="mini-player-row ${state.turnPlayerId === a?.id ? 'active' : ''}"><i class="counter-dot p1">◆</i><div><small>PLAYER 1 • NUMBERS PLACED</small><strong>${esc(a?.name || '')}</strong></div><b>${playerPlaced(a?.id)}</b></div>
              <div class="mini-player-row ${state.turnPlayerId === b?.id ? 'active' : ''}"><i class="counter-dot p2">◆</i><div><small>PLAYER 2 • NUMBERS PLACED</small><strong>${esc(b?.name || '')}</strong></div><b>${playerPlaced(b?.id)}</b></div>
            </section>

            <section class="lucky-rule-card glass-card">
              <strong>ROLL → PLACE → MAKE 13</strong>
              <p>The die is rolled automatically. Put that number anywhere empty. A winning line is exactly 3 neighbouring squares horizontally, vertically or diagonally, and those numbers can belong to either player.</p>
              <div class="lucky-example"><span>5</span><b>+</b><span>2</span><b>+</b><span>6</span><strong>= 13</strong></div>
            </section>

            <div class="lucky-action-log">${esc(state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer lucky-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'tied' ? `<div class="lucky-result-overlay"><div class="lucky-result-badge">13</div><span>GRID FULL</span><strong>No Lucky 13 line this time</strong><small>Fresh grid starting with the other player…</small></div>` : ''}
        ${showWinner ? `<div class="lucky-result-overlay won"><div class="lucky-result-badge">13</div><span>LUCKY THIRTEEN!</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins</strong><div class="lucky-winning-equation">${esc(winningEquation)} = 13</div><small>Returning to King of the Court…</small></div>` : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-lucky-cell]').forEach((button) => button.addEventListener('click', () => {
      if (!myTurn || !match.luckyThirteen || match.luckyThirteen.phase !== 'playing') return;
      const index = Number(button.dataset.luckyCell);
      if (!Number.isInteger(index) || index < 0 || index >= 16 || match.luckyThirteen.values[index] !== null) return;
      this.network.send({ type: 'lucky-thirteen-move', matchId: match.id, action: { kind: 'place', index } });
    }));
    this.updateCountdowns();
  }

  private crayPotDots(count: number, tone: 'cyan' | 'pink' | 'neutral' = 'neutral') {
    if (count <= 0) return '<span class="cray-pot-empty">none</span>';
    const shown = Math.min(10, count);
    return `<span class="cray-pot-dots ${tone}">${Array.from({ length: shown }, () => '<i></i>').join('')}${count > shown ? `<b>×${count}</b>` : ''}</span>`;
  }

  private crayBoatIcons(count: number, tone: 'cyan' | 'pink') {
    if (count <= 0) return '<span class="cray-boat-icons empty"><em>NO BOATS</em></span>';
    const rows = count <= 5 ? 1 : count <= 12 ? 2 : 3;
    const columns = Math.max(1, Math.ceil(count / rows));
    const scale = count <= 5 ? 1 : count <= 10 ? 0.86 : count <= 15 ? 0.7 : 0.58;
    const boats = Array.from({ length: count }, (_, index) => `<i class="cray-boat" style="--boat-delay:${(-0.14 * (index % 7)).toFixed(2)}s"><span class="cray-boat-cabin"></span><span class="cray-boat-pot"></span></i>`).join('');
    return `<span class="cray-boat-icons ${tone}" style="--boat-cols:${columns};--boat-scale:${scale}">${boats}</span>`;
  }

  private renderCraypots(court: CourtState, match: MatchState) {
    if (!this.room || !match.craypots) return;
    const state = match.craypots;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const me = this.meId ? state.players[this.meId] : undefined;
    const meOutForSeason = Boolean(me && me.pots === 0 && me.cash < 5 && me.boats <= 1);
    const lastCourt = this.room.courts.length - 1;
    const courtLabel = court.index === lastCourt ? 'CHAMPIONSHIP MATCH' : court.index === 0 ? 'LOWEST DESK' : `DESK ${court.index + 1}`;
    const showWinner = state.phase === 'won' && this.winnerOverlayReady(state.resultRevealAt);
    const phaseDeadline = state.phase === 'placing' || state.phase === 'shopping' ? state.phaseDeadline : 0;

    const draftKey = `${state.day}:${state.phase}:${me?.pots ?? 0}:${me?.placementLocked ? 1 : 0}:${me?.shopLocked ? 1 : 0}`;
    if (this.crayDraftKey !== draftKey) {
      this.crayDraftKey = draftKey;
      if (state.phase === 'placing' && me && !me.placementLocked) this.crayDeepDraft = Math.max(0, Math.min(me.pots, Math.round(me.pots * 0.4)));
      if (state.phase === 'shopping') {
        this.crayShopBoatDraft = 0;
        this.crayShopPotDraft = 0;
        this.crayShopSellBoatDraft = 0;
      }
    }
    if (me) this.crayDeepDraft = Math.max(0, Math.min(me.pots, this.crayDeepDraft));

    const playerCard = (player: PlayerState | undefined, tone: 'cyan' | 'pink') => {
      if (!player) return '';
      const resource = state.players[player.id];
      if (!resource) return '';
      const activeMe = player.id === this.meId;
      const locked = state.phase === 'placing' ? resource.placementLocked : state.phase === 'shopping' ? resource.shopLocked : false;
      const outForSeason = resource.pots === 0 && resource.cash < 5 && resource.boats <= 1;
      return `<div class="cray-player-card ${tone} ${activeMe ? 'me' : ''} ${outForSeason ? 'season-out' : ''}">
        <div class="cray-player-name"><i>◆</i><div><small>${activeMe ? 'YOU' : tone === 'cyan' ? 'PLAYER 1' : 'PLAYER 2'}</small><strong>${esc(player.name)}</strong></div>${outForSeason ? '<span class="cray-locked season-out">OUT</span>' : locked ? '<span class="cray-locked">LOCKED</span>' : ''}</div>
        <div class="cray-resource-grid">
          <span><small>CASH</small><b>$${resource.cash}</b></span>
          <span><small>BOATS</small><b>${resource.boats}</b></span>
          <span><small>POTS</small><b>${resource.pots}</b></span>
          <span><small>CAPACITY</small><b>${resource.pots}/${resource.boats * 10}</b></span>
        </div>
        ${state.phase === 'weather' || state.phase === 'shopping' || state.phase === 'won' ? `<div class="cray-day-result"><span class="income">+ $${resource.lastIncome}</span>${resource.destroyedDeep ? `<span class="lost">${resource.destroyedDeep} deep pot${resource.destroyedDeep === 1 ? '' : 's'} lost</span>` : '<span class="safe">fleet survived</span>'}</div>` : ''}
      </div>`;
    };

    const allocationFor = (player: PlayerState | undefined, tone: 'cyan' | 'pink') => {
      if (!player) return '';
      const resource = state.players[player.id];
      if (!resource) return '';
      const isMe = player.id === this.meId;
      const hidden = state.phase === 'placing' && !isMe;
      const shallow = state.phase === 'placing' && isMe && !resource.placementLocked ? resource.pots - this.crayDeepDraft : resource.shallow;
      const deep = state.phase === 'placing' && isMe && !resource.placementLocked ? this.crayDeepDraft : resource.deep;
      const outForSeason = resource.pots === 0 && resource.cash < 5 && resource.boats <= 1;
      const lockedText = outForSeason ? 'OUT OF SEASON' : resource.placementLocked ? 'FLEET LOCKED' : 'CHOOSING…';
      const showSinking = state.phase === 'weather' && state.weather === 'bad' && resource.destroyedDeep > 0;
      const sinkingPieces = showSinking
        ? Array.from({ length: Math.min(10, resource.destroyedDeep) }, (_, index) => {
          const left = 10 + ((index * 13) % 70);
          const delay = (index * 0.09).toFixed(2);
          const drift = (((index % 2 === 0 ? -1 : 1) * (8 + (index % 3) * 4))).toFixed(1);
          const depth = (36 + (index % 4) * 10).toFixed(1);
          return `<i style="--sink-left:${left}%;--sink-delay:${delay}s;--sink-drift:${drift}px;--sink-depth:${depth}px"></i>`;
        }).join('')
        : '';
      const sinkingOverlay = showSinking
        ? `<div class="cray-sink-overlay ${tone}"><div class="cray-sink-surface"></div>${sinkingPieces}${resource.destroyedDeep > 10 ? `<b>×${resource.destroyedDeep}</b>` : ''}<span>DEEP POTS LOST</span></div>`
        : '';
      return `<div class="cray-fleet-row ${tone}">
        <div class="cray-fleet-owner"><i>◆</i><strong>${esc(player.name)}</strong>${this.crayBoatIcons(resource.boats, tone)}</div>
        <div class="cray-fleet-zone shallow"><span>SHALLOW</span>${hidden ? `<em>${lockedText}</em>` : `<b>${shallow}</b>${this.crayPotDots(shallow, tone)}`}</div>
        <div class="cray-fleet-zone deep ${showSinking ? 'sinking' : ''}"><span>DEEP</span>${hidden ? `<em>${lockedText}</em>` : `<b>${deep}</b>${this.crayPotDots(deep, tone)}${sinkingOverlay}`}</div>
      </div>`;
    };

    const weatherName = state.weather === 'good' ? 'GOOD WEATHER' : state.weather === 'bad' ? 'BAD WEATHER' : 'WEATHER HIDDEN';
    const weatherIcon = state.weather === 'good' ? '☀️' : state.weather === 'bad' ? '⛈️' : '🎲';
    const weatherCopy = state.weather === 'good'
      ? 'Shallow $3/pot • Deep $8/pot'
      : state.weather === 'bad'
        ? 'Shallow $5/pot • Deep pots destroyed'
        : 'Both players lock their pots before the weather die is rolled.';

    let controls = '';
    if (!me) {
      controls = `<div class="cray-control-wait"><span>👀</span><strong>SPECTATING</strong><p>Watch both fleets play through the ten-day season.</p></div>`;
    } else if (state.phase === 'placing') {
      if (me.placementLocked) {
        controls = meOutForSeason
          ? `<div class="cray-control-wait season-out"><span>🚫</span><strong>SEASON TURNS SKIPPED</strong><p>You have 0 pots, less than $5 and only one boat left. The server will skip your remaining deployment and harbour-market turns automatically so your opponent never has to wait.</p></div>`
          : me.pots === 0
            ? `<div class="cray-control-wait"><span>🪤</span><strong>NO POTS TO DEPLOY</strong><p>Your deployment is skipped automatically. You can recover at the Harbour Market if you still have a spare boat to sell.</p></div>`
            : `<div class="cray-control-wait"><span>⚓</span><strong>FLEET LOCKED</strong><p>Your pots are committed. Waiting for the other player before the weather is revealed.</p></div>`;
      } else {
        const shallowDraft = me.pots - this.crayDeepDraft;
        controls = `<div class="cray-control-title"><span>STEP 1</span><strong>DEPLOY YOUR ${me.pots} POTS</strong><p>All pots must go shallow or deep before you know the weather.</p></div>
          <div class="cray-allocation-control">
            <div class="cray-allocation-box shallow"><span>🏖️ SHALLOW</span><b>${shallowDraft}</b><small>Good $3 • Bad $5</small></div>
            <div class="cray-depth-picker"><button data-cray-deep-delta="-1" ${this.crayDeepDraft <= 0 ? 'disabled' : ''}>−</button><div><small>DEEP POTS</small><b>${this.crayDeepDraft}</b></div><button data-cray-deep-delta="1" ${this.crayDeepDraft >= me.pots ? 'disabled' : ''}>+</button></div>
            <div class="cray-allocation-box deep"><span>🌊 DEEP</span><b>${this.crayDeepDraft}</b><small>Good $8 • Bad = LOST</small></div>
          </div>
          <button id="cray-lock-placement" class="cray-primary-action">DEPLOY FLEET</button>`;
      }
    } else if (state.phase === 'weather') {
      controls = `<div class="cray-control-wait weather ${state.weather || ''}"><span>${weatherIcon}</span><strong>${weatherName}</strong><p>${weatherCopy}</p><div class="cray-weather-die-small">🎲 <b>${state.weatherRoll ?? '?'}</b></div></div>`;
    } else if (state.phase === 'shopping') {
      if (me.shopLocked) {
        controls = meOutForSeason
          ? `<div class="cray-control-wait season-out"><span>🚫</span><strong>HARBOUR TURN SKIPPED</strong><p>You cannot afford another pot and have no spare boat to sell. The server has ended your market turn automatically and will keep skipping your remaining season turns.</p></div>`
          : `<div class="cray-control-wait"><span>🏪</span><strong>SHOPPING LOCKED</strong><p>Your purchases are complete. Waiting for the other player to finish at the harbour market.</p></div>`;
      } else {
        const recoverySale = me.pots === 0 && me.cash < 5 && me.boats > 1;
        const saleCredit = this.crayShopSellBoatDraft * 50;
        const purchaseCost = this.crayShopBoatDraft * 100 + this.crayShopPotDraft * 5;
        const netCost = purchaseCost - saleCredit;
        const availableCash = me.cash + saleCredit;
        const projectedBoats = me.boats - this.crayShopSellBoatDraft + this.crayShopBoatDraft;
        const projectedPots = me.pots + this.crayShopPotDraft;
        const capacity = projectedBoats * 10;
        const canAddBoat = this.crayShopSellBoatDraft === 0 && purchaseCost + 100 <= availableCash;
        const canAddPot = purchaseCost + 5 <= availableCash && projectedPots < capacity;
        const canSellBoat = recoverySale && this.crayShopBoatDraft === 0 && this.crayShopSellBoatDraft < me.boats - 1;
        controls = `<div class="cray-control-title"><span>STEP 3</span><strong>HARBOUR MARKET</strong><p>Reinvest for tomorrow or keep your cash. 1 boat carries at most 10 pots.</p></div>
          ${recoverySale ? `<div class="cray-recovery-sale"><div><span>🛟 RECOVERY SALE</span><strong>YOU HAVE NO POTS</strong><small>Sell spare boats for $50 each to get fishing again.</small></div><div class="cray-recovery-controls"><button data-cray-sell-boat="-1" ${this.crayShopSellBoatDraft <= 0 ? 'disabled' : ''}>−</button><b>${this.crayShopSellBoatDraft}</b><button data-cray-sell-boat="1" ${canSellBoat ? '' : 'disabled'}>+</button></div></div>` : ''}
          <div class="cray-shop-row"><div><span>🛥️ BOATS</span><small>$100 each</small></div><button data-cray-shop-boat="-1" ${this.crayShopBoatDraft <= 0 ? 'disabled' : ''}>−</button><b>${this.crayShopBoatDraft}</b><button data-cray-shop-boat="1" ${canAddBoat ? '' : 'disabled'}>+</button></div>
          <div class="cray-shop-row"><div><span>🪤 POTS</span><small>$5 each</small></div><button data-cray-shop-pot="-1" ${this.crayShopPotDraft <= 0 ? 'disabled' : ''}>−</button><b>${this.crayShopPotDraft}</b><button data-cray-shop-pot="1" ${canAddPot ? '' : 'disabled'}>+</button></div>
          <div class="cray-shop-summary"><span>${saleCredit ? 'Net cost' : 'Cost'} <b>${netCost < 0 ? `+$${Math.abs(netCost)}` : `$${netCost}`}</b></span><span>After market <b>$${availableCash - purchaseCost}</b></span><span>Capacity <b>${projectedPots}/${capacity}</b></span></div>
          <button id="cray-lock-shop" class="cray-primary-action">${this.crayShopSellBoatDraft ? 'SELL / BUY & END DAY' : purchaseCost ? 'BUY & END DAY' : 'BANK CASH & END DAY'}</button>`;
      }
    } else if (state.phase === 'won') {
      controls = `<div class="cray-control-wait"><span>🏆</span><strong>SEASON COMPLETE</strong><p>Ten days are finished. Cash + boats + pots decide the winner.</p></div>`;
    } else {
      controls = `<div class="cray-control-wait"><span>🔁</span><strong>EXACT TIE</strong><p>A fresh ten-day season is about to start.</p></div>`;
    }

    const dayPips = Array.from({ length: 10 }, (_, index) => {
      const day = index + 1;
      const cls = day < state.day ? 'done' : day === state.day ? 'current' : '';
      return `<span class="${cls}"><i>${day < state.day ? '✓' : day}</i></span>`;
    }).join('');

    this.ui.innerHTML = `
      <section class="screen cray-screen">
        <header class="topbar cray-topbar">
          ${this.logoMarkup(true)}
          <div class="match-game-title cray-title"><span>⚓</span><div><small>${courtLabel}</small><strong>Craypots</strong></div></div>
          <div class="room-pill"><span>ROOM</span><strong>${esc(this.room.code)}</strong></div>
        </header>

        <main class="cray-main">
          <section class="cray-ocean-card glass-card">
            <div class="cray-ocean-head">
              <div><span class="eyebrow">TEN-DAY CRAYFISH SEASON</span><strong>DAY ${state.day} <small>OF 10</small></strong></div>
              <div class="cray-ocean-status">
                ${phaseDeadline ? `<div id="turn-countdown" class="turn-countdown cray-head-countdown" data-deadline="${phaseDeadline}" data-total="${this.room.turnSeconds}"><span>${this.room.turnSeconds}</span><small>SECONDS</small></div>` : ''}
                <div class="cray-weather-chip ${state.weather || 'hidden'}"><span>${weatherIcon}</span><div><small>${state.phase === 'placing' ? 'WEATHER' : 'TODAY'}</small><b>${weatherName}</b></div></div>
              </div>
            </div>
            <div class="cray-seascape ${state.phase === 'weather' ? `weather-${state.weather}` : ''}">
              <div class="cray-sky"><i class="sun"></i><i class="cloud c1"></i><i class="cloud c2"></i>${state.weather === 'bad' ? '<i class="rain r1"></i><i class="rain r2"></i><i class="lightning">ϟ</i>' : ''}</div>
              <div class="cray-horizon"><span class="island"></span><span class="lighthouse"><i class="beam"></i><i class="roof"></i><i class="lantern"><b></b></i><i class="balcony"></i><i class="tower"><b class="window w1"></b><b class="window w2"></b></i><i class="base"></i></span></div>
              <div class="cray-water deep-water"></div>
              <div class="cray-water shallow-water"></div>
              <div class="cray-fleets">
                ${allocationFor(a, 'cyan')}
                ${allocationFor(b, 'pink')}
              </div>
              <div class="cray-water-label-row">
                <div class="spacer"></div>
                <div class="cray-water-bottom-label shallow"><strong>SHALLOW WATER</strong><small>SAFER • LOWER RETURN</small></div>
                <div class="cray-water-bottom-label deep"><strong>DEEP WATER</strong><small>RISKIER • HIGHER RETURNS</small></div>
              </div>
              ${state.phase === 'weather' ? `<div class="cray-weather-reveal ${state.weather}"><div class="cray-weather-orb"><span>${weatherIcon}</span><b>${state.weatherRoll}</b></div><div><small>WEATHER DIE</small><strong>${weatherName}</strong><p>${weatherCopy}</p></div></div>` : ''}
            </div>
            <div class="cray-day-track"><b>SEASON</b>${dayPips}</div>
          </section>

          <aside class="cray-side">
            <section class="cray-score-stack">
              ${playerCard(a, 'cyan')}
              ${playerCard(b, 'pink')}
            </section>
            <section class="cray-control-card glass-card ${state.phase}${state.phase === 'shopping' && me && me.pots === 0 && me.cash < 5 && me.boats > 1 ? ' recovery-mode' : ''}">
              ${controls}
            </section>
            <section class="cray-rates-card glass-card">
              <span><i class="good">☀</i><b>GOOD</b><small>Shallow $3 • Deep $8</small></span>
              <span><i class="bad">☂</i><b>BAD</b><small>Shallow $5 • Deep destroyed</small></span>
              <span><i class="repeat">4</i><b>DIE 4</b><small>Same as previous day</small></span>
            </section>
            <div class="cray-action-log">${esc(state.lastAction)}</div>
          </aside>
        </main>

        <footer class="game-shell-footer cray-footer">
          <button id="game-instructions" class="mini-btn">Instructions</button>
          ${this.isHost ? '<button id="view-matchups" class="secondary-btn small-btn">View Matchups</button><button id="manage-players" class="secondary-btn small-btn manage-btn">Manage Players</button><button id="game-return-lobby" class="danger-outline-btn">Return to Lobby</button>' : '<span class="live-chip"><i></i> Match connected</span>'}
        </footer>

        ${state.phase === 'tied' ? `<div class="cray-result-overlay"><div class="cray-result-anchor">⚓</div><span>EXACT ASSET TIE</span><strong>Fresh Craypots season starting…</strong><small>The court needs one winner.</small></div>` : ''}
        ${showWinner ? (() => {
          const winnerResource = state.players[state.winnerId || ''];
          const finalCash = winnerResource?.cash ?? 0;
          const boatValue = (winnerResource?.boats ?? 0) * 100;
          const potValue = (winnerResource?.pots ?? 0) * 5;
          const totalAssets = finalCash + boatValue + potValue;
          return `<div class="cray-result-overlay won"><div class="cray-result-anchor">⚓</div><span>CRAYPOTS CHAMPION</span><strong>${esc(this.player(state.winnerId || '')?.name || 'Player')} wins</strong><div class="cray-final-assets"><div><small>CASH</small><b>$${finalCash}</b></div><div><small>BOATS</small><b>$${boatValue}</b></div><div><small>POTS</small><b>$${potValue}</b></div></div><div class="cray-final-cash"><small>TOTAL ASSETS</small>$${totalAssets}</div><small>+1 match point • returning to King of the Court…</small></div>`;
        })() : ''}
      </section>`;

    this.ui.querySelector('#game-instructions')?.addEventListener('click', () => this.openInstructions(this.selectedGame));
    this.ui.querySelector('#view-matchups')?.addEventListener('click', () => {
      this.forcedMatchupView = true;
      this.forcedMatchupMatchId = this.currentMatchFor(this.meId)?.match.id;
      this.courtViewIndex = court.index;
      this.courtViewInitialized = true;
      this.courtScrollLeft = 0;
      this.courtScrollInitialized = false;
      this.render();
    });
    this.ui.querySelector('#game-return-lobby')?.addEventListener('click', () => this.confirmReturnLobby());
    this.ui.querySelectorAll<HTMLButtonElement>('[data-cray-deep-delta]').forEach((button) => button.addEventListener('click', () => {
      if (!me || state.phase !== 'placing' || me.placementLocked) return;
      this.crayDeepDraft = Math.max(0, Math.min(me.pots, this.crayDeepDraft + Number(button.dataset.crayDeepDelta || 0)));
      this.renderCraypots(court, match);
    }));
    this.ui.querySelector('#cray-lock-placement')?.addEventListener('click', () => {
      if (!me || state.phase !== 'placing' || me.placementLocked) return;
      this.network.send({ type: 'craypots-move', matchId: match.id, action: { kind: 'place-pots', deep: this.crayDeepDraft } });
    });
    this.ui.querySelectorAll<HTMLButtonElement>('[data-cray-sell-boat]').forEach((button) => button.addEventListener('click', () => {
      if (!me || state.phase !== 'shopping' || me.shopLocked) return;
      const delta = Number(button.dataset.craySellBoat || 0);
      const next = Math.max(0, Math.min(me.boats - 1, this.crayShopSellBoatDraft + delta));
      if (me.pots === 0 && me.cash < 5 && this.crayShopBoatDraft === 0) this.crayShopSellBoatDraft = next;
      const availableCash = me.cash + this.crayShopSellBoatDraft * 50;
      const capacity = (me.boats - this.crayShopSellBoatDraft) * 10;
      this.crayShopPotDraft = Math.min(this.crayShopPotDraft, Math.floor(availableCash / 5), Math.max(0, capacity - me.pots));
      this.renderCraypots(court, match);
    }));
    this.ui.querySelectorAll<HTMLButtonElement>('[data-cray-shop-boat]').forEach((button) => button.addEventListener('click', () => {
      if (!me || state.phase !== 'shopping' || me.shopLocked) return;
      const delta = Number(button.dataset.crayShopBoat || 0);
      const next = Math.max(0, this.crayShopBoatDraft + delta);
      if (this.crayShopSellBoatDraft > 0) return;
      const cost = next * 100 + this.crayShopPotDraft * 5;
      if (cost <= me.cash) this.crayShopBoatDraft = next;
      this.renderCraypots(court, match);
    }));
    this.ui.querySelectorAll<HTMLButtonElement>('[data-cray-shop-pot]').forEach((button) => button.addEventListener('click', () => {
      if (!me || state.phase !== 'shopping' || me.shopLocked) return;
      const delta = Number(button.dataset.crayShopPot || 0);
      const next = Math.max(0, this.crayShopPotDraft + delta);
      const availableCash = me.cash + this.crayShopSellBoatDraft * 50;
      const cost = this.crayShopBoatDraft * 100 + next * 5;
      const capacity = (me.boats - this.crayShopSellBoatDraft + this.crayShopBoatDraft) * 10;
      if (cost <= availableCash && me.pots + next <= capacity) this.crayShopPotDraft = next;
      this.renderCraypots(court, match);
    }));
    this.ui.querySelector('#cray-lock-shop')?.addEventListener('click', () => {
      if (!me || state.phase !== 'shopping' || me.shopLocked) return;
      this.network.send({ type: 'craypots-move', matchId: match.id, action: { kind: 'shop', boats: this.crayShopBoatDraft, pots: this.crayShopPotDraft, sellBoats: this.crayShopSellBoatDraft } });
    });
    this.updateCountdowns();
  }


  private updateCountdowns() {
    const next = document.querySelector<HTMLElement>('#next-countdown');
    if (next) {
      const startsAt = Number(next.dataset.startsAt || 0);
      if (startsAt) {
        const remaining = Math.max(0, startsAt - (Date.now() + this.serverClockOffset));
        next.textContent = String(Math.max(1, Math.ceil(remaining / 1000)));
      }
    }
    const turn = document.querySelector<HTMLElement>('#turn-countdown');
    if (turn) {
      const deadline = Number(turn.dataset.deadline || 0);
      const total = Math.max(1, Number(turn.dataset.total || 5));
      const remaining = Math.max(0, deadline - (Date.now() + this.serverClockOffset));
      const seconds = Math.max(0, Math.ceil(remaining / 1000));
      const value = turn.querySelector<HTMLElement>('span');
      if (value) value.textContent = String(seconds);
      const ratio = Math.max(0, Math.min(1, remaining / (total * 1000)));
      turn.style.setProperty('--turn-progress', `${Math.round(ratio * 100)}%`);
      turn.classList.toggle('urgent', seconds <= 2);
    }
  }

  private openManagePlayers() {
    if (!this.room || !this.isHost) return;
    const candidates = this.room.players.filter((player) => !player.isHost && !player.isBot);
    const statusFor = (player: PlayerState) => {
      if (!player.connected) return { text: 'Offline / inactive', cls: 'offline' };
      const live = this.currentMatchFor(player.id);
      if (live) {
        const last = this.room!.courts.length - 1;
        const desk = live.court.index === last ? 'Championship' : live.court.index === 0 ? 'Lowest Desk' : `Desk ${live.court.index + 1}`;
        return { text: `${live.match.status === 'countdown' ? 'Starting' : live.match.status === 'playing' ? 'Playing' : 'Matched'} • ${desk}`, cls: 'playing' };
      }
      if (this.room!.lateJoinQueue.includes(player.id)) return { text: 'Late join • waiting', cls: 'waiting' };
      const waiting = this.room!.courts.find((court) => court.waiting.includes(player.id));
      if (waiting) return { text: `Waiting • Desk ${waiting.index + 1}`, cls: 'waiting' };
      return { text: 'Connected • spectating', cls: 'connected' };
    };

    const overlay = document.createElement('div');
    overlay.className = 'modal-layer';
    overlay.innerHTML = `
      <div class="manage-modal glass-card">
        <div class="modal-head"><div><small>HOST CONTROLS</small><h2>Manage Players</h2></div><button class="modal-close" aria-label="Close player manager">×</button></div>
        <div class="manage-note"><strong>Remove inactive or inappropriate players</strong><span>Removing a player forfeits their current matchup. Their current name is banned from this room and they must choose a different name to rejoin. Your live game timer keeps running while this panel is open.</span></div>
        <div class="manage-list">
          ${candidates.length ? candidates.map((player) => {
            const status = statusFor(player);
            return `<div class="manage-player-row">
              <span class="manage-player-gem">◆</span>
              <div><strong>${esc(player.name)}</strong><span class="manage-status ${status.cls}">${esc(status.text)}</span></div>
              <button class="manage-remove" data-manage-kick-id="${esc(player.id)}">Remove</button>
            </div>`;
          }).join('') : '<div class="manage-empty">No student players are currently in the room.</div>'}
        </div>
      </div>`;
    this.stage.appendChild(overlay);
    overlay.querySelector('.modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelectorAll<HTMLElement>('[data-manage-kick-id]').forEach((button) => button.addEventListener('click', () => {
      const playerId = button.dataset.manageKickId;
      if (!playerId) return;
      this.network.send({ type: 'kick-player', playerId });
      overlay.remove();
    }));
  }

  private instructionExampleCard(title: string, copy: string, svg: string, wide = false) {
    return `<article class="instruction-example-card ${wide ? 'wide' : ''}"><div class="instruction-example-title">${esc(title)}</div><div class="instruction-example-graphic">${svg}</div><p class="instruction-example-copy">${esc(copy)}</p></article>`;
  }

  private instructionScene(content: string, viewBox = '0 0 240 130') {
    return `<svg viewBox="${viewBox}" class="instruction-example-svg">${content}</svg>`;
  }

  private instructionToken(x: number, y: number, color: string, glyph = '◆', r = 14) {
    return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="${color}22" stroke="${color}" stroke-width="4"/>${glyph ? `<text x="${x}" y="${y + 5}" text-anchor="middle" fill="${color}" font-size="16" font-weight="900">${glyph}</text>` : ''}</g>`;
  }

  private instructionNode(x: number, y: number, active = false) {
    return `<circle cx="${x}" cy="${y}" r="${active ? 15 : 12}" fill="${active ? 'rgba(255,227,107,.12)' : 'rgba(255,255,255,.03)'}" stroke="${active ? '#ffe36b' : '#8ea2ec'}" stroke-width="${active ? 4 : 3}"/>`;
  }

  private instructionArrow(x1: number, y1: number, x2: number, y2: number, color = '#ffe36b') {
    return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${color}" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M${x2 - 7} ${y2 - 5} L${x2} ${y2} L${x2 - 7} ${y2 + 5}" stroke="${color}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
  }

  private instructionCross(x: number, y: number, size = 10) {
    return `<path d="M${x - size} ${y - size} L${x + size} ${y + size} M${x + size} ${y - size} L${x - size} ${y + size}" stroke="#ff7b90" stroke-width="4" stroke-linecap="round"/>`;
  }

  private instructionGrid(xs: number[], ys: number[], stroke = '#8397ea') {
    const parts: string[] = [];
    ys.forEach((y) => parts.push(`<path d="M${xs[0]} ${y}H${xs[xs.length - 1]}" stroke="${stroke}" stroke-width="3"/>`));
    xs.forEach((x) => parts.push(`<path d="M${x} ${ys[0]}V${ys[ys.length - 1]}" stroke="${stroke}" stroke-width="3"/>`));
    xs.forEach((x) => ys.forEach((y) => parts.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="#f1f5ff"/>`)));
    return parts.join('');
  }
  private threeHexMiniBoard(tokens: Record<number, string>, active: number[] = [], line: number[] = [], move?: [number, number], blocked?: [number, number]) {
    const positions = [
      { x: 86, y: 30 }, { x: 154, y: 30 }, { x: 52, y: 65 }, { x: 120, y: 65 }, { x: 188, y: 65 }, { x: 86, y: 100 }, { x: 154, y: 100 },
    ];
    const edges: Array<[number, number]> = [[0, 1], [0, 2], [0, 3], [1, 3], [1, 4], [2, 3], [2, 5], [3, 4], [3, 5], [3, 6], [4, 6], [5, 6]];
    const rails = edges.map(([a, b]) => `<path d="M${positions[a].x} ${positions[a].y}L${positions[b].x} ${positions[b].y}" stroke="#8194f7" stroke-width="6" stroke-linecap="round"/>`).join('');
    const glow = line.length ? `<path d="M${line.map((index) => `${positions[index].x},${positions[index].y}`).join(' L ')}" stroke="#ffe36b" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".24"/>` : '';
    const nodes = positions.map((pos, index) => tokens[index]
      ? this.instructionToken(pos.x, pos.y, tokens[index], '◆', 12)
      : this.instructionNode(pos.x, pos.y, active.includes(index))).join('');
    const legalMove = move ? this.instructionArrow(positions[move[0]].x + 3, positions[move[0]].y - 3, positions[move[1]].x - 3, positions[move[1]].y + 3) : '';
    const blockedMove = blocked ? `<path d="M${positions[blocked[0]].x} ${positions[blocked[0]].y}L${positions[blocked[1]].x} ${positions[blocked[1]].y}" stroke="#ff7b90" stroke-width="5" stroke-linecap="round" stroke-dasharray="6 5"/>${this.instructionCross((positions[blocked[0]].x + positions[blocked[1]].x) / 2, (positions[blocked[0]].y + positions[blocked[1]].y) / 2, 9)}` : '';
    return this.instructionScene(`${glow}${rails}${nodes}${legalMove}${blockedMove}`);
  }

  private fourStarMiniBoard(tokens: Record<number, string>, active: number[] = [], line: number[] = [], move?: [number, number], blocked?: [number, number]) {
    const positions = [
      { x: 120, y: 18 },
      { x: 38, y: 46 }, { x: 92, y: 46 }, { x: 148, y: 46 }, { x: 202, y: 46 },
      { x: 64, y: 74 }, { x: 120, y: 74 }, { x: 176, y: 74 },
      { x: 38, y: 102 }, { x: 92, y: 102 }, { x: 148, y: 102 }, { x: 202, y: 102 },
      { x: 120, y: 126 },
    ];
    const edges: Array<[number, number]> = [[0, 2], [0, 3], [1, 2], [2, 3], [3, 4], [1, 5], [2, 5], [2, 6], [3, 6], [3, 7], [4, 7], [5, 6], [6, 7], [5, 8], [5, 9], [6, 9], [6, 10], [7, 10], [7, 11], [8, 9], [9, 10], [10, 11], [9, 12], [10, 12]];
    const rails = edges.map(([a, b]) => `<path d="M${positions[a].x} ${positions[a].y}L${positions[b].x} ${positions[b].y}" stroke="#8194f7" stroke-width="5.5" stroke-linecap="round"/>`).join('');
    const glow = line.length ? `<path d="M${line.map((index) => `${positions[index].x},${positions[index].y}`).join(' L ')}" stroke="#ffe36b" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".24"/>` : '';
    const nodes = positions.map((pos, index) => tokens[index]
      ? this.instructionToken(pos.x, pos.y, tokens[index], '◆', 10.5)
      : this.instructionNode(pos.x, pos.y, active.includes(index))).join('');
    const legalMove = move ? this.instructionArrow(positions[move[0]].x + 2, positions[move[0]].y - 2, positions[move[1]].x - 2, positions[move[1]].y + 2) : '';
    const blockedMove = blocked ? `<path d="M${positions[blocked[0]].x} ${positions[blocked[0]].y}L${positions[blocked[1]].x} ${positions[blocked[1]].y}" stroke="#ff7b90" stroke-width="5" stroke-linecap="round" stroke-dasharray="6 5"/>${this.instructionCross((positions[blocked[0]].x + positions[blocked[1]].x) / 2, (positions[blocked[0]].y + positions[blocked[1]].y) / 2, 8)}` : '';
    return this.instructionScene(`${glow}${rails}${nodes}${legalMove}${blockedMove}`);
  }


  private instructionExamples(gameId: string, pageIndex: number) {
    switch (`${gameId}:${pageIndex}`) {
      case 'three-hexagon:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Place on empty circles', 'Start by taking turns putting your 3 counters on empty circles.', this.threeHexMiniBoard({ 0: '#75ebf5', 2: '#75ebf5', 3: '#ff77d0' }, [1, 4, 5, 6])) +
          this.instructionExampleCard('Straight line wins', 'A win is only 3 counters in one real straight line through the board.', this.threeHexMiniBoard({ 2: '#75ebf5', 3: '#75ebf5', 4: '#75ebf5', 0: '#ff77d0', 6: '#ff77d0' }, [], [2, 3, 4]))
        }</div>`;
      }

      case 'three-hexagon:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Slide to a neighbour', 'After all 6 counters are placed, slide 1 counter along 1 printed line to a nearby empty circle.', this.threeHexMiniBoard({ 0: '#75ebf5', 2: '#75ebf5', 5: '#75ebf5', 3: '#ff77d0', 4: '#ff77d0', 6: '#ff77d0' }, [1], [], [0, 1])) +
          this.instructionExampleCard('No straight-back repeat', 'Moving the same counter again is okay, but you cannot just move it straight back to the spot it came from.', this.threeHexMiniBoard({ 1: '#75ebf5', 2: '#75ebf5', 5: '#75ebf5', 3: '#ff77d0', 4: '#ff77d0', 6: '#ff77d0' }, [0], [], undefined, [1, 0]))
        }</div>`;
      }

      case 'four-star:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Place your 4 counters', 'Take turns placing counters on empty circles until all 8 counters are on the board.', this.fourStarMiniBoard({ 0: '#ff77d0', 2: '#75ebf5', 3: '#ff77d0', 5: '#75ebf5', 10: '#75ebf5' }, [1, 4, 6, 7, 8, 9, 11, 12])) +
          this.instructionExampleCard('Make a real line of 4', 'You win only when your 4 counters are on one actual straight line.', this.fourStarMiniBoard({ 1: '#75ebf5', 2: '#75ebf5', 3: '#75ebf5', 4: '#75ebf5', 0: '#ff77d0', 9: '#ff77d0', 12: '#ff77d0' }, [], [1, 2, 3, 4]))
        }</div>`;
      }

      case 'four-star:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Slide along 1 line', 'After placing is over, slide 1 counter to a connected empty circle. No jumping.', this.fourStarMiniBoard({ 1: '#ff77d0', 2: '#75ebf5', 3: '#75ebf5', 4: '#ff77d0', 5: '#75ebf5', 7: '#ff77d0', 9: '#75ebf5', 10: '#ff77d0' }, [6], [], [5, 6])) +
          this.instructionExampleCard('Do not move straight back', 'You may use the same counter again next turn, but not straight back to where it just came from unless it is the only move.', this.fourStarMiniBoard({ 1: '#ff77d0', 2: '#75ebf5', 3: '#75ebf5', 4: '#ff77d0', 6: '#75ebf5', 7: '#ff77d0', 9: '#75ebf5', 10: '#ff77d0' }, [5], [], undefined, [6, 5]))
        }</div>`;
      }

      case 'boxes:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Draw 1 side', 'Choose 1 horizontal or vertical line between neighbouring dots.', this.instructionScene(`${this.instructionGrid([48,96,144],[34,82,130])}<path d="M48 82H96" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/>`)) +
          this.instructionExampleCard('No diagonals', 'Diagonal lines are not allowed in Boxes.', this.instructionScene(`${this.instructionGrid([48,96,144],[34,82,130])}<path d="M48 34L96 82" stroke="#ff7b90" stroke-width="7" stroke-linecap="round" stroke-dasharray="7 6"/>${this.instructionCross(120,46)}`))
        }</div>`;
      }
      case 'boxes:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Complete a box', 'If your line makes the final side of a box, you claim it and score it.', this.instructionScene(`${this.instructionGrid([38,86,134],[24,72,120])}<path d="M38 24H86M86 24V72M38 72H86" stroke="#7f93ff" stroke-width="6" stroke-linecap="round"/><path d="M38 24V72" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><rect x="42" y="29" width="40" height="38" rx="10" fill="rgba(117,235,245,.25)" stroke="#75ebf5" stroke-width="3"/><text x="62" y="54" text-anchor="middle" fill="#75ebf5" font-size="20" font-weight="900">1</text>`)) +
          this.instructionExampleCard('Score and go again', 'Sometimes 1 line can finish 2 boxes. When you score, you keep the turn.', this.instructionScene(`${this.instructionGrid([28,76,124,172],[26,74,122])}<path d="M28 26H124M28 74H124M28 122H124M28 26V122M76 26V122M124 26V122" stroke="#7f93ff" stroke-width="6" stroke-linecap="round"/><path d="M172 26V122" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><rect x="80" y="30" width="40" height="38" rx="10" fill="rgba(117,235,245,.22)" stroke="#75ebf5" stroke-width="3"/><rect x="80" y="78" width="40" height="38" rx="10" fill="rgba(117,235,245,.22)" stroke="#75ebf5" stroke-width="3"/><text x="100" y="54" text-anchor="middle" fill="#75ebf5" font-size="18" font-weight="900">1</text><text x="100" y="102" text-anchor="middle" fill="#75ebf5" font-size="18" font-weight="900">2</text>`))
        }</div>`;
      }
      case 'never-touch:0': {
        const grid = `${this.instructionGrid([40,90,140,190],[28,58,88,118])}`;
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Your own marks must not touch', 'X cannot be directly next to another X up, down, left or right.', this.instructionScene(`${grid}<text x="65" y="48" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><text x="115" y="78" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><rect x="94" y="61" width="42" height="22" rx="10" fill="rgba(255,123,144,.18)" stroke="#ff7b90" stroke-width="3"/>${this.instructionCross(115,72,7)}`)) +
          this.instructionExampleCard('Diagonals are okay', 'You may place your own mark diagonally from another one.', this.instructionScene(`${grid}<text x="65" y="48" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><text x="115" y="78" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><path d="M72 50L108 73" stroke="#ffe36b" stroke-width="4" stroke-dasharray="5 5"/><text x="170" y="77" fill="#9ed6a8" font-size="16" font-weight="900">legal</text>`))
        }</div>`;
      }
      case 'never-touch:1': {
        const grid = `${this.instructionGrid([40,90,140,190],[28,58,88,118])}`;
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Opponent contact is allowed', 'You may be next to your opponent’s marks.', this.instructionScene(`${grid}<text x="65" y="48" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><text x="115" y="48" text-anchor="middle" fill="#ff77d0" font-size="22" font-weight="900">O</text><rect x="46" y="33" width="88" height="22" rx="10" fill="rgba(255,227,107,.12)" stroke="#ffe36b" stroke-width="3"/>`)) +
          this.instructionExampleCard('No legal move = lose', 'Keep going until a player has nowhere legal to place a mark.', this.instructionScene(`${grid}<text x="65" y="48" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><text x="115" y="48" text-anchor="middle" fill="#ff77d0" font-size="22" font-weight="900">O</text><text x="165" y="48" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><text x="65" y="78" text-anchor="middle" fill="#ff77d0" font-size="22" font-weight="900">O</text><text x="115" y="78" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><text x="165" y="78" text-anchor="middle" fill="#ff77d0" font-size="22" font-weight="900">O</text><text x="65" y="108" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><text x="115" y="108" text-anchor="middle" fill="#ff77d0" font-size="22" font-weight="900">O</text><text x="165" y="108" text-anchor="middle" fill="#75ebf5" font-size="22" font-weight="900">X</text><text x="205" y="78" fill="#ff7b90" font-size="15" font-weight="900">stuck</text>`))
        }</div>`;
      }
      case 'spiral:0': {
        const track = `<path d="M202 24H86V96H178V50H54V112H218" fill="none" stroke="#7e93ff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
        const dots = [[202,24],[168,24],[134,24],[100,24],[86,52],[86,82],[114,96],[146,96],[178,80],[178,50],[150,50],[122,50],[94,50],[54,68],[54,96],[82,112],[116,112],[150,112],[184,112],[218,112]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="8" fill="#0b1234" stroke="#a0b0ef" stroke-width="3"/>`).join('');
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Move exactly 1, 2 or 3', 'Pick any 1 shared counter and move it forward 1, 2 or 3 spaces.', this.instructionScene(`${track}${dots}${this.instructionToken(150,50,'#75ebf5','',10)}${this.instructionArrow(150,42,178,42)}<text x="184" y="35" fill="#ffe36b" font-size="14" font-weight="900">+1</text>`)) +
          this.instructionExampleCard('Any shared counter can be used', 'Both players use the same 4 counters on the spiral track.', this.instructionScene(`${track}${dots}${this.instructionToken(168,24,'#75ebf5','',10)}${this.instructionToken(122,50,'#ff77d0','',10)}${this.instructionToken(82,112,'#75ebf5','',10)}${this.instructionToken(178,80,'#ff77d0','',10)}<text x="182" y="124" fill="#dce5ff" font-size="13" font-weight="800">4 shared counters</text>`))
        }</div>`;
      }
      case 'spiral:1': {
        const track = `<path d="M202 24H86V96H178V50H54V112H218" fill="none" stroke="#7e93ff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
        const dots = [[202,24],[168,24],[134,24],[100,24],[86,52],[86,82],[114,96],[146,96],[178,80],[178,50],[150,50],[122,50],[94,50],[54,68],[54,96],[82,112],[116,112],[150,112],[184,112],[218,112]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="8" fill="#0b1234" stroke="#a0b0ef" stroke-width="3"/>`).join('');
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Do not jump over counters', 'A counter cannot land on, pass or jump over another counter.', this.instructionScene(`${track}${dots}${this.instructionToken(122,50,'#75ebf5','',10)}${this.instructionToken(150,50,'#ff77d0','',10)}${this.instructionArrow(122,42,150,42,'#ff7b90')}${this.instructionCross(137,34,7)}`)) +
          this.instructionExampleCard('Last into HOME wins', 'The player who moves the last counter into HOME wins the game.', this.instructionScene(`${track}${dots}${this.instructionToken(184,112,'#75ebf5','',10)}${this.instructionArrow(184,104,214,104)}<text x="194" y="92" fill="#ffe36b" font-size="14" font-weight="900">HOME</text><circle cx="218" cy="112" r="10" fill="rgba(255,227,107,.16)" stroke="#ffe36b" stroke-width="4"/>`))
        }</div>`;
      }
      case 'hex:0': {
        const sideMarks = `<path d="M26 18L40 26L40 104L26 112" stroke="#75ebf5" stroke-width="7" fill="none"/><path d="M214 18L200 26L200 104L214 112" stroke="#75ebf5" stroke-width="7" fill="none"/><path d="M56 12H184" stroke="#ff77d0" stroke-width="7"/><path d="M56 118H184" stroke="#ff77d0" stroke-width="7"/>`;
        const hexes = [[72,30],[96,30],[120,30],[144,30],[84,51],[108,51],[132,51],[156,51],[96,72],[120,72],[144,72],[108,93],[132,93]].map(([x,y],i) => {
          const color = [0,4,8,11].includes(i) ? '#75ebf5' : [3,7,10].includes(i) ? '#ff77d0' : '#7f93ff';
          const fill = [0,4,8,11].includes(i) ? '#75ebf522' : [3,7,10].includes(i) ? '#ff77d022' : 'rgba(255,255,255,.03)';
          return `<polygon points="${x-12},${y} ${x-6},${y-10} ${x+6},${y-10} ${x+12},${y} ${x+6},${y+10} ${x-6},${y+10}" fill="${fill}" stroke="${color}" stroke-width="3"/>`;
        }).join('');
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Cyan joins left to right', 'Cyan wins by making one connected chain from the left side to the right side.', this.instructionScene(`${sideMarks}${hexes}<path d="M72 30L84 51L96 72L108 93" stroke="#75ebf5" stroke-width="6" opacity=".35"/>`)) +
          this.instructionExampleCard('Pink joins top to bottom', 'Pink wins by making one connected chain from the top side to the bottom side.', this.instructionScene(`${sideMarks}${hexes}<path d="M144 30L156 51L144 72L132 93" stroke="#ff77d0" stroke-width="6" opacity=".35"/>`))
        }</div>`;
      }
      case 'hex:1': {
        const sideMarks = `<path d="M26 18L40 26L40 104L26 112" stroke="#75ebf5" stroke-width="7" fill="none"/><path d="M214 18L200 26L200 104L214 112" stroke="#75ebf5" stroke-width="7" fill="none"/><path d="M56 12H184" stroke="#ff77d0" stroke-width="7"/><path d="M56 118H184" stroke="#ff77d0" stroke-width="7"/>`;
        const hexes = [[72,30],[96,30],[120,30],[144,30],[84,51],[108,51],[132,51],[156,51],[96,72],[120,72],[144,72],[108,93],[132,93]].map(([x,y],i) => {
          const cyan = [0,4,8].includes(i);
          const pink = [3,6,10].includes(i);
          const block = i === 5;
          const color = block ? '#ffe36b' : cyan ? '#75ebf5' : pink ? '#ff77d0' : '#7f93ff';
          const fill = block ? 'rgba(255,227,107,.22)' : cyan ? '#75ebf522' : pink ? '#ff77d022' : 'rgba(255,255,255,.03)';
          return `<polygon points="${x-12},${y} ${x-6},${y-10} ${x+6},${y-10} ${x+12},${y} ${x+6},${y+10} ${x-6},${y+10}" fill="${fill}" stroke="${color}" stroke-width="3"/>`;
        }).join('');
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Block the other path', 'A clever move can block your opponent while helping your own chain.', this.instructionScene(`${sideMarks}${hexes}<text x="118" y="54" text-anchor="middle" fill="#172040" font-size="13" font-weight="900">block</text>`)) +
          this.instructionExampleCard('Claimed hexes stay yours', 'Once a mini-hex is claimed, it stays that colour for the whole game.', this.instructionScene(`${sideMarks}${hexes}<text x="120" y="112" text-anchor="middle" fill="#dce5ff" font-size="13" font-weight="800">build • block • connect</text>`))
        }</div>`;
      }
      case 'factor-game:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Choose 1 number', 'If you choose 28, you score 28 points for yourself.', this.instructionScene(`${this.factorMiniScene(28, [1,2,4,7,14], false)}`)) +
          this.instructionExampleCard('Opponent gets the factors', 'Your opponent then scores the available factors of 28: 1, 2, 4, 7 and 14.', this.instructionScene(`${this.factorMiniScene(28, [1,2,4,7,14], true)}`))
        }</div>`;
      }
      case 'factor-game:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Bad choice = 0 points', 'If you pick a number with no factors left, you lose the turn and score 0.', this.instructionScene(`${this.factorNoFactorScene()}`)) +
          this.instructionExampleCard('Slow play = lowest number', 'If time runs out, the game gives you the lowest number still left on the board.', this.instructionScene(`${this.factorTimeoutScene()}`))
        }</div>`;
      }
      case 'hedron:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Claim 1 wall', 'On each turn, tap 1 unclaimed wall. Shared walls can help more than 1 room.', this.instructionScene(`${this.hedronMiniScene('claim')}`)) +
          this.instructionExampleCard('Shared walls matter', 'A smart wall pick can help you in 2 nearby rooms at once.', this.instructionScene(`${this.hedronMiniScene('shared')}`))
        }</div>`;
      }
      case 'hedron:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('3 walls secures a room', 'As soon as you own 3 of a room’s 5 walls, that room is yours.', this.instructionScene(`${this.hedronMiniScene('secure')}`)) +
          this.instructionExampleCard('Score the room number', 'When you secure a room, you add its printed number to your total score.', this.instructionScene(`${this.hedronMiniScene('score')}`))
        }</div>`;
      }
      case 'multi:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Start with Token A locked on 1', 'On the first turn, choose Token B and give it a number.', this.instructionScene(`${this.multiExampleScene('opening')}`)) +
          this.instructionExampleCard('Product decides the squares', 'If A = 1 and B = 7, the product is 7, so you can claim all “7” multiplication squares.', this.instructionScene(`${this.multiExampleScene('product')}`))
        }</div>`;
      }
      case 'multi:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Choose A or B each turn', 'After the opening turn, choose Token A or Token B, then pick its new number.', this.instructionScene(`${this.multiExampleScene('switch')}`)) +
          this.instructionExampleCard('Win a small board', 'Get 3 in a row inside a small board to win that big square.', this.instructionScene(`${this.multiExampleScene('smallwin')}`))
        }</div>`;
      }
      case 'multi:2': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Drawn small board becomes wild', 'If a small board fills with no winner, it becomes X/O and can help either player.', this.instructionScene(`${this.multiExampleScene('wild')}`)) +
          this.instructionExampleCard('3 big squares in a row wins', 'The whole match is won by getting 3 big squares in a row on the large board.', this.instructionScene(`${this.multiExampleScene('bigwin')}`))
        }</div>`;
      }
      case 'ultimate-tic-tac-toe:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('9 little boards make 1 big board', 'X goes first and may open on any empty square.', this.instructionScene(`${this.ultimateExampleScene('opening')}`)) +
          this.instructionExampleCard('Opening move can be anywhere', 'Only open little boards can be used.', this.instructionScene(`${this.ultimateExampleScene('openchoice')}`))
        }</div>`;
      }
      case 'ultimate-tic-tac-toe:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Your square sends your opponent', 'If you play in the top-right square of a little board, your opponent must go to the top-right little board next.', this.instructionScene(`${this.ultimateExampleScene('send')}`)) +
          this.instructionExampleCard('Closed target = free choice', 'If the target little board is already closed, the next player may choose any open little board.', this.instructionScene(`${this.ultimateExampleScene('free')}`))
        }</div>`;
      }
      case 'ultimate-tic-tac-toe:2': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Local draw becomes wild', 'A full little board with no winner becomes X/O and counts for both players.', this.instructionScene(`${this.ultimateExampleScene('wild')}`)) +
          this.instructionExampleCard('No big line? Count local wins', 'If all 9 little boards close with no overall line, the player with more local-board wins wins the match.', this.instructionScene(`${this.ultimateExampleScene('countwins')}`))
        }</div>`;
      }
      case 'lucky-thirteen:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Place the number you rolled', 'The die is rolled for you. Put that number in any empty square.', this.instructionScene(`${this.luckyThirteenMiniScene('place')}`)) +
          this.instructionExampleCard('Complete 13 to win', 'Here the player rolls 2 and places it between 5 and 6: 5 + 2 + 6 = 13.', this.instructionScene(`${this.luckyThirteenMiniScene('vertical-win')}`))
        }</div>`;
      }
      case 'lucky-thirteen:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Both colours can be in the line', 'The winning three numbers do not all have to belong to you. Your move only needs to complete the line.', this.instructionScene(`${this.luckyThirteenMiniScene('mixed-win')}`)) +
          this.instructionExampleCard('Horizontal, vertical or diagonal', 'Any 3 neighbouring squares in one straight line can win if their total is exactly 13.', this.instructionScene(`${this.luckyThirteenMiniScene('directions')}`))
        }</div>`;
      }
      case 'craypots:0': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Start with a small fleet', 'Each player begins with 2 boats, 5 pots and $50.', this.instructionScene(`${this.craypotsMiniScene('start')}`)) +
          this.instructionExampleCard('Ten days to make money', 'Your cash rises when your pots catch crayfish. After Day 10, the higher cash total wins.', this.instructionScene(`${this.craypotsMiniScene('season')}`))
        }</div>`;
      }
      case 'craypots:1': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Split pots before the weather', 'Put every pot in shallow water or deep water before the weather die is shown.', this.instructionScene(`${this.craypotsMiniScene('split')}`)) +
          this.instructionExampleCard('Deep water is risky', 'Deep pots earn much more in good weather, but bad weather destroys every deep pot.', this.instructionScene(`${this.craypotsMiniScene('risk')}`))
        }</div>`;
      }
      case 'craypots:2': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Weather die 1–3 = good', 'Good weather pays $3 for every shallow pot and $8 for every deep pot.', this.instructionScene(`${this.craypotsMiniScene('good')}`)) +
          this.instructionExampleCard('5–6 = bad • 4 repeats', 'Bad weather pays $5 for shallow pots and destroys deep pots. A 4 repeats yesterday’s weather.', this.instructionScene(`${this.craypotsMiniScene('bad')}`))
        }</div>`;
      }
      case 'craypots:3': {
        return `<div class="instruction-example-grid">${
          this.instructionExampleCard('Reinvest at the harbour', 'Between days, buy pots for $5 and boats for $100, or keep your cash.', this.instructionScene(`${this.craypotsMiniScene('shop')}`)) +
          this.instructionExampleCard('Watch boat capacity', 'One boat can support at most 10 pots. You may need another boat before buying more pots.', this.instructionScene(`${this.craypotsMiniScene('capacity')}`))
        }</div>`;
      }
      default:
        return '';
    }
  }

  private luckyThirteenMiniScene(mode: 'place' | 'vertical-win' | 'mixed-win' | 'directions') {
    const cell = 28;
    const ox = 64;
    const oy = 8;
    const grid = Array.from({ length: 16 }, (_, index) => {
      const row = Math.floor(index / 4);
      const col = index % 4;
      return `<rect x="${ox + col * cell}" y="${oy + row * cell}" width="${cell}" height="${cell}" fill="rgba(255,255,255,.025)" stroke="#8194df" stroke-width="2"/>`;
    }).join('');
    const number = (index: number, value: number, color = '#f5f7ff') => {
      const row = Math.floor(index / 4);
      const col = index % 4;
      const x = ox + col * cell + cell / 2;
      const y = oy + row * cell + 19;
      return `<text x="${x}" y="${y}" text-anchor="middle" fill="${color}" font-size="17" font-weight="950">${value}</text>`;
    };
    const highlight = (indices: number[], color = '#ffe36b') => indices.map((index) => {
      const row = Math.floor(index / 4);
      const col = index % 4;
      return `<rect x="${ox + col * cell + 2}" y="${oy + row * cell + 2}" width="${cell - 4}" height="${cell - 4}" rx="5" fill="${color}18" stroke="${color}" stroke-width="3"/>`;
    }).join('');
    const owner = (index: number, color: string) => {
      const row = Math.floor(index / 4);
      const col = index % 4;
      return `<circle cx="${ox + col * cell + 7}" cy="${oy + row * cell + 7}" r="3.5" fill="${color}"/>`;
    };

    if (mode === 'place') {
      return `${grid}${number(1, 4, '#ff77d0')}${number(6, 5, '#75ebf5')}${number(11, 6, '#ff77d0')}${highlight([8])}<rect x="12" y="36" width="38" height="38" rx="10" fill="#55b96a" stroke="#baf6c4" stroke-width="3"/><text x="31" y="62" text-anchor="middle" fill="#fff" font-size="22" font-weight="950">3</text>${this.instructionArrow(50,55,82,75)}`;
    }
    if (mode === 'vertical-win') {
      return `${grid}${number(2, 5, '#75ebf5')}${number(10, 6, '#ff77d0')}${highlight([2,6,10])}${number(6, 2, '#ffe36b')}${owner(2,'#75ebf5')}${owner(10,'#ff77d0')}<path d="M${ox + 2.5 * cell} ${oy + 5}V${oy + 3 * cell - 5}" stroke="#ffe36b" stroke-width="7" opacity=".2"/>`;
    }
    if (mode === 'mixed-win') {
      return `${grid}${highlight([4,5,6])}${number(4,4,'#75ebf5')}${number(5,4,'#ffe36b')}${number(6,5,'#ff77d0')}${owner(4,'#75ebf5')}${owner(5,'#75ebf5')}${owner(6,'#ff77d0')}<path d="M${ox + 4} ${oy + 1.5 * cell}H${ox + 3 * cell - 4}" stroke="#ffe36b" stroke-width="7" opacity=".2"/>`;
    }
    return `${grid}${highlight([0,1,2], '#75ebf5')}${number(0,4,'#75ebf5')}${number(1,4,'#75ebf5')}${number(2,5,'#75ebf5')}${highlight([3,7,11], '#ff77d0')}${number(3,5,'#ff77d0')}${number(7,2,'#ff77d0')}${number(11,6,'#ff77d0')}${highlight([5,10,15], '#ffe36b')}${number(5,3,'#ffe36b')}${number(10,5,'#ffe36b')}${number(15,5,'#ffe36b')}`;
  }

  private craypotsMiniScene(mode: 'start' | 'season' | 'split' | 'risk' | 'good' | 'bad' | 'shop' | 'capacity') {
    const sea = `<rect x="8" y="10" width="224" height="110" rx="15" fill="#0a284f"/><rect x="8" y="50" width="224" height="70" rx="0" fill="#0e5e82"/><rect x="8" y="88" width="224" height="32" rx="0 0 15 15" fill="#328d8e"/><path d="M8 50H232" stroke="#62dce8" stroke-width="2" opacity=".35"/><path d="M8 88H232" stroke="#8feee8" stroke-width="2" opacity=".25"/>`;
    const boat = (x: number, y: number, color = '#75ebf5') => `<path d="M${x - 18} ${y}H${x + 18}L${x + 11} ${y + 9}H${x - 11}Z" fill="${color}" opacity=".88"/><path d="M${x} ${y - 18}V${y}" stroke="#f5f7ff" stroke-width="2"/><path d="M${x} ${y - 17}L${x + 13} ${y - 6}H${x}Z" fill="#f5f7ff" opacity=".8"/>`;
    const pot = (x: number, y: number, color = '#75ebf5') => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="3" fill="${color}" stroke="rgba(255,255,255,.45)" stroke-width="1"/>`;
    if (mode === 'start') {
      return `${sea}${boat(68,72)}${boat(122,72)}${[48,66,84,102,120].map((x) => pot(x,103)).join('')}<rect x="155" y="23" width="58" height="28" rx="9" fill="rgba(255,227,107,.13)" stroke="#ffe36b" stroke-width="2"/><text x="184" y="42" text-anchor="middle" fill="#ffe36b" font-size="15" font-weight="950">$50</text>`;
    }
    if (mode === 'season') {
      return `${sea}${Array.from({ length: 10 }, (_, i) => `<circle cx="${25 + i * 21}" cy="32" r="7" fill="${i < 4 ? '#75ebf5' : 'rgba(255,255,255,.08)'}" stroke="${i === 4 ? '#ffe36b' : '#768bc8'}" stroke-width="2"/><text x="${25 + i * 21}" y="35" text-anchor="middle" fill="#fff" font-size="7" font-weight="900">${i + 1}</text>`).join('')}${boat(72,80)}${boat(142,80,'#ff77d0')}<text x="120" y="111" text-anchor="middle" fill="#ffe36b" font-size="16" font-weight="950">$ → $ → $</text>`;
    }
    if (mode === 'split') {
      return `${sea}${boat(120,68)}${[45,60,75].map((x) => pot(x,102)).join('')}${[155,172].map((x) => pot(x,69)).join('')}<path d="M105 69L82 95" stroke="#ffe36b" stroke-width="4"/><path d="M135 69L158 73" stroke="#ffe36b" stroke-width="4"/>`;
    }
    if (mode === 'risk') {
      return `${sea}${[55,72,89].map((x) => pot(x,103,'#75ebf5')).join('')}${[152,170,188].map((x) => pot(x,70,'#ff77d0')).join('')}<circle cx="184" cy="28" r="19" fill="#4d5c92"/><path d="M168 31H200" stroke="#9ecbff" stroke-width="7" stroke-linecap="round"/><path d="M178 38L172 49M188 38L182 49M198 38L192 49" stroke="#8ec9ff" stroke-width="3"/><path d="M146 64L194 76M194 64L146 76" stroke="#ff7b90" stroke-width="5"/>`;
    }
    if (mode === 'good') {
      return `${sea}<circle cx="44" cy="29" r="18" fill="#ffe36b"/><text x="84" y="35" fill="#ffe36b" font-size="20" font-weight="950">1–3</text>${[48,66,84].map((x) => pot(x,103)).join('')}${[150,168,186].map((x) => pot(x,69,'#ff77d0')).join('')}<text x="67" y="84" text-anchor="middle" fill="#d7f7fb" font-size="12" font-weight="900">$3</text><text x="168" y="52" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">$8</text>`;
    }
    if (mode === 'bad') {
      return `${sea}<circle cx="44" cy="29" r="18" fill="#526aa7"/><text x="84" y="35" fill="#9ec9ff" font-size="20" font-weight="950">5–6</text>${[48,66,84].map((x) => pot(x,103)).join('')}${[150,168,186].map((x) => pot(x,69,'#ff77d0')).join('')}<text x="67" y="84" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">$5</text><path d="M145 61L193 77M193 61L145 77" stroke="#ff7b90" stroke-width="5"/><circle cx="207" cy="30" r="13" fill="rgba(181,133,234,.18)" stroke="#c6a8f2" stroke-width="2"/><text x="207" y="35" text-anchor="middle" fill="#cdb3f4" font-size="14" font-weight="950">4</text>`;
    }
    if (mode === 'shop') {
      return `${sea}<rect x="22" y="23" width="196" height="78" rx="14" fill="rgba(9,16,49,.82)" stroke="#8498da" stroke-width="2"/>${boat(68,59)}<text x="68" y="91" text-anchor="middle" fill="#dce5ff" font-size="11" font-weight="900">$100</text>${pot(154,59,'#ff77d0')}<text x="154" y="91" text-anchor="middle" fill="#dce5ff" font-size="11" font-weight="900">$5</text>`;
    }
    return `${sea}${boat(72,67)}${boat(126,67)}${Array.from({ length: 12 }, (_, i) => pot(44 + (i % 6) * 20, 94 + Math.floor(i / 6) * 15, i < 10 ? '#75ebf5' : '#ff77d0')).join('')}<rect x="173" y="32" width="44" height="46" rx="10" fill="rgba(255,227,107,.1)" stroke="#ffe36b" stroke-width="2"/><text x="195" y="51" text-anchor="middle" fill="#ffe36b" font-size="11" font-weight="950">2 boats</text><text x="195" y="67" text-anchor="middle" fill="#dce5ff" font-size="10" font-weight="900">20 pots</text>`;
  }


  private threeHexMiniScene(mode: 'placing' | 'win' | 'slide' | 'stall') {
    const positions = [
      { x: 70, y: 24 }, { x: 170, y: 24 }, { x: 20, y: 65 }, { x: 120, y: 65 },
      { x: 220, y: 65 }, { x: 70, y: 106 }, { x: 170, y: 106 },
    ];
    const edges: Array<[number, number]> = [[0,1],[0,2],[0,3],[1,3],[1,4],[2,3],[2,5],[3,4],[3,5],[3,6],[4,6],[5,6]];
    const board = edges.map(([a,b]) => `<path d="M${positions[a].x} ${positions[a].y}L${positions[b].x} ${positions[b].y}" stroke="#8ea2ff" stroke-width="6" stroke-linecap="round"/>`).join('');
    const emptyNodes = [0,1,2,3,4,5,6].map((i) => this.instructionNode(positions[i].x, positions[i].y)).join('');
    const tokenAt = (i: number, color: string) => this.instructionToken(positions[i].x, positions[i].y, color);
    if (mode === 'placing') {
      return `${board}${emptyNodes}${tokenAt(2,'#75ebf5')}${tokenAt(0,'#ff77d0')}${tokenAt(5,'#75ebf5')}<circle cx="${positions[1].x}" cy="${positions[1].y}" r="17" fill="none" stroke="#ffe36b" stroke-width="4"/><text x="120" y="126" text-anchor="middle" fill="#dce5ff" font-size="12" font-weight="800">empty circles wait for the next counters</text>`;
    }
    if (mode === 'win') {
      return `${board}${emptyNodes}${tokenAt(2,'#75ebf5')}${tokenAt(3,'#75ebf5')}${tokenAt(4,'#75ebf5')}${tokenAt(0,'#ff77d0')}${tokenAt(6,'#ff77d0')}<path d="M18 65H222" stroke="#ffe36b" stroke-width="9" stroke-linecap="round" opacity=".26"/>`;
    }
    if (mode === 'slide') {
      return `${board}${emptyNodes}${tokenAt(2,'#75ebf5')}${tokenAt(0,'#75ebf5')}${tokenAt(5,'#75ebf5')}${tokenAt(3,'#ff77d0')}${tokenAt(6,'#ff77d0')}<circle cx="${positions[1].x}" cy="${positions[1].y}" r="17" fill="none" stroke="#ffe36b" stroke-width="4"/>${this.instructionArrow(132,58,160,30)}<text x="120" y="126" text-anchor="middle" fill="#dce5ff" font-size="12" font-weight="800">slide from the centre to a connected empty circle</text>`;
    }
    return `${board}${emptyNodes}${tokenAt(2,'#75ebf5')}${tokenAt(0,'#75ebf5')}${tokenAt(1,'#ff77d0')}${tokenAt(3,'#ff77d0')}${tokenAt(5,'#75ebf5')}<path d="M120 65L170 24" stroke="#ffe36b" stroke-width="5" stroke-linecap="round"/><path d="M170 24L120 65" stroke="#ff7b90" stroke-width="5" stroke-dasharray="5 5" stroke-linecap="round"/>${this.instructionCross(144,46)}<text x="120" y="126" text-anchor="middle" fill="#dce5ff" font-size="12" font-weight="800">moving straight back is the only blocked repeat</text>`;
  }

  private fourStarMiniScene(mode: 'placing' | 'win' | 'slide' | 'stall') {
    const positions = [
      { x: 120, y: 16 },
      { x: 28, y: 42 }, { x: 90, y: 42 }, { x: 150, y: 42 }, { x: 212, y: 42 },
      { x: 58, y: 72 }, { x: 120, y: 72 }, { x: 182, y: 72 },
      { x: 28, y: 102 }, { x: 90, y: 102 }, { x: 150, y: 102 }, { x: 212, y: 102 },
      { x: 120, y: 128 },
    ];
    const edges: Array<[number, number]> = [
      [0,2],[0,3],[1,2],[2,3],[3,4],[1,5],[2,5],[2,6],[3,6],[3,7],[4,7],
      [5,6],[6,7],[5,8],[5,9],[6,9],[6,10],[7,10],[7,11],[8,9],[9,10],[10,11],[9,12],[10,12],
    ];
    const board = edges.map(([a,b]) => `<path d="M${positions[a].x} ${positions[a].y}L${positions[b].x} ${positions[b].y}" stroke="#8ea2ff" stroke-width="5" stroke-linecap="round"/>`).join('');
    const emptyNodes = positions.map((p) => this.instructionNode(p.x, p.y)).join('');
    const tokenAt = (i: number, color: string) => this.instructionToken(positions[i].x, positions[i].y, color, '◆', 12.5);
    if (mode === 'placing') {
      return `${board}${emptyNodes}${tokenAt(1,'#ff77d0')}${tokenAt(6,'#75ebf5')}${tokenAt(11,'#ff77d0')}${tokenAt(8,'#75ebf5')}<circle cx="${positions[3].x}" cy="${positions[3].y}" r="15" fill="none" stroke="#ffe36b" stroke-width="4"/><text x="120" y="126" text-anchor="middle" fill="#dce5ff" font-size="12" font-weight="800">keep placing until all 8 counters are on the board</text>`;
    }
    if (mode === 'win') {
      return `${board}${emptyNodes}${tokenAt(8,'#75ebf5')}${tokenAt(9,'#75ebf5')}${tokenAt(10,'#75ebf5')}${tokenAt(11,'#75ebf5')}${tokenAt(0,'#ff77d0')}${tokenAt(2,'#ff77d0')}${tokenAt(4,'#ff77d0')}<path d="M24 102H216" stroke="#ffe36b" stroke-width="8" stroke-linecap="round" opacity=".28"/>`;
    }
    if (mode === 'slide') {
      return `${board}${emptyNodes}${tokenAt(0,'#ff77d0')}${tokenAt(1,'#ff77d0')}${tokenAt(6,'#75ebf5')}${tokenAt(8,'#75ebf5')}${tokenAt(9,'#75ebf5')}${tokenAt(10,'#75ebf5')}${tokenAt(11,'#ff77d0')}<circle cx="${positions[12].x}" cy="${positions[12].y}" r="15" fill="none" stroke="#ffe36b" stroke-width="4"/>${this.instructionArrow(100,104,117,120)}<text x="120" y="12" text-anchor="middle" fill="#dce5ff" font-size="12" font-weight="800">legal slide: 9 → bottom apex</text>`;
    }
    return `${board}${emptyNodes}${tokenAt(0,'#ff77d0')}${tokenAt(1,'#ff77d0')}${tokenAt(6,'#75ebf5')}${tokenAt(8,'#75ebf5')}${tokenAt(9,'#75ebf5')}${tokenAt(12,'#75ebf5')}<path d="M90 102L120 128" stroke="#ffe36b" stroke-width="5" stroke-linecap="round"/><path d="M120 128L90 102" stroke="#ff7b90" stroke-width="5" stroke-dasharray="5 5" stroke-linecap="round"/>${this.instructionCross(110,114)}<text x="120" y="12" text-anchor="middle" fill="#dce5ff" font-size="12" font-weight="800">immediate reverse 12 → 9 is blocked</text>`;
  }

  private factorMiniScene(selected: number, factors: number[], opponent = false) {
    const nums = [1,2,3,4,5,6,7,8,9,10,12,14,16,18,21,28];
    return nums.map((n, i) => {
      const x = 18 + (i % 4) * 52;
      const y = 18 + Math.floor(i / 4) * 24;
      const isSelected = n === selected;
      const isFactor = factors.includes(n);
      const stroke = isSelected ? '#ffe36b' : isFactor ? (opponent ? '#ff77d0' : '#75ebf5') : '#6678b4';
      const fill = isSelected ? 'rgba(255,227,107,.18)' : isFactor ? (opponent ? '#ff77d022' : '#75ebf522') : 'rgba(255,255,255,.04)';
      return `<rect x="${x}" y="${y}" width="42" height="18" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/><text x="${x + 21}" y="${y + 13}" text-anchor="middle" fill="#f6f8ff" font-size="12" font-weight="900">${n}</text>`;
    }).join('') + `<text x="120" y="118" text-anchor="middle" fill="${opponent ? '#ff77d0' : '#ffe36b'}" font-size="12" font-weight="900">${opponent ? 'opponent gets factors' : 'you choose ' + selected}</text>`;
  }

  private factorNoFactorScene() {
    return `<rect x="26" y="20" width="188" height="88" rx="16" fill="rgba(255,255,255,.03)" stroke="#7486c6" stroke-width="2"/>${[11,17,19,23,29,31].map((n, i) => {
      const x = 42 + (i % 3) * 52; const y = 34 + Math.floor(i / 3) * 30;
      const bad = n === 17;
      return `<rect x="${x}" y="${y}" width="38" height="20" rx="6" fill="${bad ? 'rgba(255,123,144,.18)' : 'rgba(255,255,255,.04)'}" stroke="${bad ? '#ff7b90' : '#6678b4'}" stroke-width="2.5"/><text x="${x + 19}" y="${y + 14}" text-anchor="middle" fill="#f6f8ff" font-size="12" font-weight="900">${n}</text>`;
    }).join('')}<text x="120" y="102" text-anchor="middle" fill="#ff7b90" font-size="12" font-weight="900">17 has no factors left → 0 points</text>`;
  }

  private factorTimeoutScene() {
    return `<rect x="26" y="20" width="188" height="88" rx="16" fill="rgba(255,255,255,.03)" stroke="#7486c6" stroke-width="2"/>${[4,9,12,15,22,30].map((n, i) => {
      const x = 42 + (i % 3) * 52; const y = 34 + Math.floor(i / 3) * 30;
      const low = n === 4;
      return `<rect x="${x}" y="${y}" width="38" height="20" rx="6" fill="${low ? 'rgba(255,227,107,.18)' : 'rgba(255,255,255,.04)'}" stroke="${low ? '#ffe36b' : '#6678b4'}" stroke-width="2.5"/><text x="${x + 19}" y="${y + 14}" text-anchor="middle" fill="#f6f8ff" font-size="12" font-weight="900">${n}</text>`;
    }).join('')}<text x="120" y="102" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">time up → lowest remaining number is 4</text>`;
  }

  private hedronMiniScene(mode: 'claim' | 'shared' | 'secure' | 'score') {
    const base = `<g stroke="#98abef" stroke-width="4" fill="rgba(255,255,255,.02)" stroke-linejoin="round"><path d="M78 18L162 18L194 70L120 114L46 70Z"/><path d="M78 18L90 52L120 66L150 52L162 18"/><path d="M46 70L86 84L100 58L90 52"/><path d="M194 70L154 84L140 58L150 52"/><path d="M86 84L120 114L154 84"/><path d="M100 58L120 66L140 58"/></g>`;
    if (mode === 'claim') return `${base}<path d="M100 58L120 66" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><text x="120" y="126" text-anchor="middle" fill="#dce5ff" font-size="12" font-weight="800">tap 1 wall</text>`;
    if (mode === 'shared') return `${base}<path d="M90 52L100 58" stroke="#ffe36b" stroke-width="7" stroke-linecap="round"/><text x="120" y="126" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">shared wall helps 2 rooms</text>`;
    if (mode === 'secure') return `${base}<path d="M46 70L86 84" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><path d="M86 84L120 114" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><path d="M90 52L100 58" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><text x="73" y="78" fill="#75ebf5" font-size="12" font-weight="900">3 / 5</text>`;
    return `${base}<path d="M46 70L86 84" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><path d="M86 84L120 114" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><path d="M90 52L100 58" stroke="#75ebf5" stroke-width="7" stroke-linecap="round"/><text x="72" y="79" fill="#75ebf5" font-size="11" font-weight="900">claimed</text><text x="73" y="92" fill="#f6f8ff" font-size="18" font-weight="900">19</text><text x="160" y="126" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">score +19</text>`;
  }

  private multiExampleScene(mode: 'opening' | 'product' | 'switch' | 'smallwin' | 'wild' | 'bigwin') {
    const board = `<rect x="16" y="16" width="140" height="98" rx="14" fill="rgba(255,255,255,.03)" stroke="#dce4ff" stroke-width="2"/>${[0,1,2,3,4,5,6,7,8].map((b) => {
      const bx = 22 + (b % 3) * 44; const by = 22 + Math.floor(b / 3) * 30; const colors = ['#ff6f86','#ffb26f','#ffd74f','#6be09c','#63d7ee','#8ca2ff','#b38cff','#ff89dc','#7ef1e6'];
      return `<rect x="${bx}" y="${by}" width="38" height="24" rx="8" fill="rgba(255,255,255,.02)" stroke="${colors[b]}" stroke-width="1.8"/><path d="M${bx + 12.7} ${by}V${by + 24}M${bx + 25.3} ${by}V${by + 24}M${bx} ${by + 8}H${bx + 38}M${bx} ${by + 16}H${bx + 38}" stroke="rgba(255,255,255,.08)"/>`;
    }).join('')}`;
    const factor = `<rect x="168" y="24" width="54" height="76" rx="12" fill="rgba(255,255,255,.04)" stroke="#879cea" stroke-width="2"/>${[1,2,3,4,5,6,7,8,9].map((n) => {
      const x = 174 + ((n - 1) % 3) * 16; const y = 30 + Math.floor((n - 1) / 3) * 22; const colors = ['#d94b62','#e07f86','#dd8747','#c9a83a','#4fae5f','#3b9fc0','#6685cc','#7b68b3','#875f98'];
      return `<rect x="${x}" y="${y}" width="14" height="14" rx="4" fill="${colors[n - 1]}"/><text x="${x + 7}" y="${y + 11}" text-anchor="middle" fill="#fff" font-size="9" font-weight="900">${n}</text>`;
    }).join('')}`;
    if (mode === 'opening') return `${board}${factor}<circle cx="188" cy="106" r="8" fill="#ffe36b"/><text x="188" y="110" text-anchor="middle" fill="#172040" font-size="10" font-weight="900">A</text><circle cx="210" cy="84" r="8" fill="#75ebf5"/><text x="210" y="88" text-anchor="middle" fill="#172040" font-size="10" font-weight="900">B</text><text x="195" y="122" text-anchor="middle" fill="#dce5ff" font-size="12" font-weight="800">first choose B</text>`;
    if (mode === 'product') return `${board}${factor}<text x="188" y="108" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">A=1</text><text x="210" y="86" text-anchor="middle" fill="#75ebf5" font-size="12" font-weight="900">B=7</text><text x="40" y="80" fill="#75ebf5" font-size="12" font-weight="900">7</text><text x="40" y="96" fill="#75ebf5" font-size="12" font-weight="900">7</text><text x="68" y="104" fill="#75ebf5" font-size="12" font-weight="900">7</text>`;
    if (mode === 'switch') return `${board}${factor}<circle cx="188" cy="106" r="8" fill="#ffe36b"/><text x="188" y="110" text-anchor="middle" fill="#172040" font-size="10" font-weight="900">A</text><circle cx="210" cy="84" r="8" fill="#75ebf5"/><text x="210" y="88" text-anchor="middle" fill="#172040" font-size="10" font-weight="900">B</text><text x="194" y="122" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">pick A or B</text>`;
    if (mode === 'smallwin') return `${board}${factor}<text x="35" y="36" fill="#75ebf5" font-size="11" font-weight="900">X</text><text x="48" y="44" fill="#75ebf5" font-size="11" font-weight="900">X</text><text x="55" y="52" fill="#75ebf5" font-size="11" font-weight="900">X</text><rect x="22" y="22" width="38" height="24" rx="8" fill="rgba(117,235,245,.08)" stroke="#75ebf5" stroke-width="2.5"/>`;
    if (mode === 'wild') return `${board}${factor}<rect x="66" y="52" width="38" height="24" rx="8" fill="rgba(255,227,107,.08)" stroke="#ffe36b" stroke-width="2.5"/><text x="85" y="66" text-anchor="middle" fill="#ffe36b" font-size="11" font-weight="900">X/O</text><text x="195" y="122" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">wild big square</text>`;
    return `${board}${factor}<rect x="22" y="22" width="38" height="24" rx="8" fill="rgba(117,235,245,.08)" stroke="#75ebf5" stroke-width="2.5"/><rect x="66" y="52" width="38" height="24" rx="8" fill="rgba(117,235,245,.08)" stroke="#75ebf5" stroke-width="2.5"/><rect x="110" y="82" width="38" height="24" rx="8" fill="rgba(117,235,245,.08)" stroke="#75ebf5" stroke-width="2.5"/><path d="M30 34L138 94" stroke="#ffe36b" stroke-width="6" opacity=".28"/>`;
  }

  private ultimateExampleScene(mode: 'opening' | 'openchoice' | 'send' | 'free' | 'wild' | 'countwins') {
    const boards = Array.from({ length: 9 }, (_, b) => {
      const bx = 18 + (b % 3) * 72;
      const by = 18 + Math.floor(b / 3) * 36;
      const highlight = (mode === 'send' && b === 2) || (mode === 'openchoice' && b === 4) || (mode === 'free' && [0, 3, 8].includes(b));
      const fill = highlight ? 'rgba(255,227,107,.08)' : 'rgba(255,255,255,.03)';
      const stroke = highlight ? '#ffe36b' : '#8aa0e9';
      return `<rect x="${bx}" y="${by}" width="64" height="28" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="2"/><path d="M${bx + 21.3} ${by}V${by + 28}M${bx + 42.6} ${by}V${by + 28}M${bx} ${by + 9.3}H${bx + 64}M${bx} ${by + 18.6}H${bx + 64}" stroke="rgba(255,255,255,.08)"/>`;
    }).join('');
    if (mode === 'opening') return this.instructionScene(`${boards}<text x="28" y="34" fill="#75ebf5" font-size="12" font-weight="900">X</text>`);
    if (mode === 'openchoice') return this.instructionScene(`${boards}<rect x="90" y="54" width="64" height="28" rx="8" fill="rgba(255,227,107,.08)" stroke="#ffe36b" stroke-width="2.5"/>`);
    if (mode === 'send') return this.instructionScene(`${boards}<text x="62" y="31" fill="#75ebf5" font-size="12" font-weight="900">X</text>${this.instructionArrow(76, 32, 154, 32)}<rect x="162" y="18" width="64" height="28" rx="8" fill="rgba(255,227,107,.08)" stroke="#ffe36b" stroke-width="2.5"/>`);
    if (mode === 'free') return this.instructionScene(`${boards}<rect x="162" y="54" width="64" height="28" rx="8" fill="rgba(255,123,144,.08)" stroke="#ff7b90" stroke-width="2.5"/><path d="M170 62L218 74M218 62L170 74" stroke="#ff7b90" stroke-width="3" stroke-linecap="round"/><rect x="18" y="18" width="64" height="28" rx="8" fill="rgba(255,227,107,.08)" stroke="#ffe36b" stroke-width="2"/><rect x="18" y="54" width="64" height="28" rx="8" fill="rgba(255,227,107,.08)" stroke="#ffe36b" stroke-width="2"/><rect x="162" y="90" width="64" height="28" rx="8" fill="rgba(255,227,107,.08)" stroke="#ffe36b" stroke-width="2"/>`);
    if (mode === 'wild') return this.instructionScene(`${boards}<rect x="90" y="54" width="64" height="28" rx="8" fill="rgba(255,227,107,.08)" stroke="#ffe36b" stroke-width="2.5"/><text x="122" y="71" text-anchor="middle" fill="#ffe36b" font-size="12" font-weight="900">X/O</text>`);
    return this.instructionScene(`${boards}<rect x="18" y="18" width="64" height="28" rx="8" fill="rgba(117,235,245,.08)" stroke="#75ebf5" stroke-width="2.5"/><rect x="90" y="54" width="64" height="28" rx="8" fill="rgba(117,235,245,.08)" stroke="#75ebf5" stroke-width="2.5"/><rect x="162" y="90" width="64" height="28" rx="8" fill="rgba(255,123,144,.08)" stroke="#ff7b90" stroke-width="2.5"/>`);
  }


  private openInstructions(game: GameDefinition) {
    let pageIndex = 0;
    const timerLabel = this.room && this.room.selectedGameId === game.id
      ? `${this.room.turnSeconds} seconds per timed decision`
      : game.decisionTime;
    const overlay = document.createElement('div');
    overlay.className = 'modal-layer';
    overlay.innerHTML = `<div class="instruction-modal glass-card"></div>`;
    this.stage.appendChild(overlay);
    const modal = overlay.querySelector<HTMLElement>('.instruction-modal')!;
    const renderPage = () => {
      const page = game.pages[pageIndex];
      const examples = this.instructionExamples(game.id, pageIndex);
      modal.innerHTML = `
        <div class="modal-head">
          <div class="instruction-title"><span class="gem-chip large">${esc(game.symbol)}</span><div><small>HOW TO PLAY</small><h2>${esc(game.title)}</h2></div></div>
          <button class="modal-close" aria-label="Close instructions">×</button>
        </div>
        <div class="instruction-meta"><span>${esc(game.tagline)}</span><b>⏱ ${esc(timerLabel)}</b></div>
        <div class="instruction-scroll" id="instruction-scroll">
          <h3>${esc(page.title)}</h3>
          ${examples}
          <div class="instruction-bullets">${page.bullets.map((bullet, i) => `<div class="instruction-bullet"><span>${i + 1}</span><p>${esc(bullet)}</p></div>`).join('')}</div>
          ${page.note ? `<div class="instruction-note"><strong>Quick note</strong><p>${esc(page.note)}</p></div>` : ''}
        </div>
        <div class="instruction-pager">
          <button id="instruction-prev" ${pageIndex === 0 ? 'disabled' : ''}>‹</button>
          <div class="page-dots">${game.pages.map((_, i) => `<button class="page-dot ${i === pageIndex ? 'active' : ''}" data-page="${i}">${i + 1}</button>`).join('')}</div>
          <button id="instruction-next" ${pageIndex === game.pages.length - 1 ? 'disabled' : ''}>›</button>
        </div>`;
      modal.querySelector('.modal-close')?.addEventListener('click', () => overlay.remove());
      modal.querySelector('#instruction-prev')?.addEventListener('click', () => { if (pageIndex > 0) { pageIndex--; renderPage(); } });
      modal.querySelector('#instruction-next')?.addEventListener('click', () => { if (pageIndex < game.pages.length - 1) { pageIndex++; renderPage(); } });
      modal.querySelectorAll<HTMLElement>('[data-page]').forEach((button) => button.addEventListener('click', () => { pageIndex = Number(button.dataset.page); renderPage(); }));
      const scroll = modal.querySelector<HTMLElement>('#instruction-scroll');
      if (scroll) {
        let touchX = 0;
        scroll.addEventListener('touchstart', (event) => { touchX = event.changedTouches[0].clientX; }, { passive: true });
        scroll.addEventListener('touchend', (event) => {
          const dx = event.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) < 70) return;
          if (dx < 0 && pageIndex < game.pages.length - 1) pageIndex++;
          else if (dx > 0 && pageIndex > 0) pageIndex--;
          else return;
          renderPage();
        }, { passive: true });
      }
    };
    overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) overlay.remove(); });
    renderPage();
  }


  private openMatchInspector(court: CourtState) {
    if (!this.room || !court.activeMatch) return;
    const match = court.activeMatch;
    const a = this.matchPlayer(match, 0);
    const b = this.matchPlayer(match, 1);
    const last = this.room.courts.length - 1;
    const label = court.index === last ? 'Championship Match' : court.index === 0 ? 'Lowest Desk' : `Desk ${court.index + 1}`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-layer';
    overlay.innerHTML = `
      <div class="match-inspector glass-card">
        <div class="modal-head"><div><small>HOST MATCH VIEW</small><h2>${esc(label)}</h2></div><button class="modal-close">×</button></div>
        <div class="inspector-status"><span class="match-status ${match.status}">${esc(match.status.toUpperCase())}</span><strong>${esc(this.selectedGame.title)}</strong></div>
        <div class="inspector-versus"><div><span>◆</span><strong>${esc(a?.name || '')}</strong>${this.winsMarkup(a)}</div><b>VS</b><div><span>◆</span><strong>${esc(b?.name || '')}</strong>${this.winsMarkup(b)}</div></div>
        ${match.status === 'playing' && !['three-hexagon', 'four-star', 'boxes', 'never-touch', 'spiral', 'hex', 'factor-game', 'hedron', 'multi', 'ultimate-tic-tac-toe', 'lucky-thirteen', 'craypots'].includes(this.selectedGame.id) ? `<div class="dev-win-controls inspector-controls"><span>FOUNDATION TEST RESOLUTION</span><button data-inspector-winner="${esc(a?.id || '')}">Award win to ${esc(a?.name || '')}</button><button data-inspector-winner="${esc(b?.id || '')}">Award win to ${esc(b?.name || '')}</button></div>` : match.status === 'playing' ? `<p class="inspector-wait">This ${esc(this.selectedGame.title)} match is live and is being resolved by the two players with the server-controlled turn timer.</p>` : '<p class="inspector-wait">This match is not yet in its playable state.</p>'}
      </div>`;
    this.stage.appendChild(overlay);
    overlay.querySelector('.modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelectorAll<HTMLElement>('[data-inspector-winner]').forEach((button) => button.addEventListener('click', () => {
      const winnerId = button.dataset.inspectorWinner;
      if (winnerId) this.network.send({ type: 'resolve-match', matchId: match.id, winnerId });
      overlay.remove();
    }));
  }

  private confirmReturnLobby() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-layer';
    overlay.innerHTML = `
      <div class="confirm-modal glass-card">
        <div class="warning-icon">!</div>
        <h2>Return to the lobby?</h2>
        <p>All current matchups, waiting positions and championship-win results will be cleared.</p>
        <div class="confirm-actions"><button id="cancel-return" class="secondary-btn">Keep Playing</button><button id="confirm-return" class="danger-btn">Yes, Return to Lobby</button></div>
      </div>`;
    this.stage.appendChild(overlay);
    overlay.querySelector('#cancel-return')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#confirm-return')?.addEventListener('click', () => {
      overlay.remove();
      this.network.send({ type: 'return-lobby' });
    });
  }

  private showToast(message: string, isError = false) {
    const toast = document.querySelector<HTMLElement>('#toast');
    if (!toast) return;
    window.clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.className = `toast show ${isError ? 'error' : ''}`;
    this.toastTimer = window.setTimeout(() => { toast.className = 'toast'; }, 4200);
  }
}

new DodecaApp();
