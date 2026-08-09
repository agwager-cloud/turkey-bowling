import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { appState } from '../state';
import { network } from '../net/NetworkManager';
import { audioDirector } from '../audio/AudioDirector';
import { BowlingSimulator, type BowlingShotResult } from '../game/BowlingSimulator';
import type { BowlerScorecard, LaneMatchState, PlayerSummary, SpectatorShot, SpectatorShotResult, TournamentState } from '../types';

export class LiveSpectatorScene extends BaseBowlingScene {
  private cleanup: Array<() => void> = [];
  private ui?: HTMLDivElement;
  private simulator?: BowlingSimulator;
  private shotClockFrame = 0;
  private mathClockFrame = 0;
  private reconnectClockFrame = 0;
  private returnTimer = 0;
  private lastMatchFingerprint = '';
  private spectatorPlayerId: string | null = null;
  private spectatorStandingBefore = 10;

  constructor() { super('LiveSpectatorScene'); }

  create(): void {
    this.setupBaseScene();
    this.stopClocks();
    window.clearTimeout(this.returnTimer);
    this.returnTimer = 0;
    this.lastMatchFingerprint = '';
    this.simulator?.destroy();
    this.simulator = undefined;

    const matchId = appState.spectatingMatchId;
    if (!appState.tournament || !matchId) return void this.scene.start('MatchupScene');

    this.ui = createSceneUi();
    this.render(appState.tournament);

    this.cleanup.push(
      network.on('bowlingStarted', (state) => {
        appState.room = state.room;
        appState.tournament = state;
        if (this.shouldReturnToOwnGame(state)) return void this.returnToOwnGame();
        const fingerprint = watchedMatchFingerprint(state, matchId);
        if (fingerprint !== this.lastMatchFingerprint) this.render(state);
      }),
      network.on('bowlingState', (state) => {
        appState.room = state.room;
        appState.tournament = state;
        if (this.shouldReturnToOwnGame(state)) return void this.returnToOwnGame();
        const fingerprint = watchedMatchFingerprint(state, matchId);
        if (fingerprint !== this.lastMatchFingerprint) this.render(state);
      }),
      network.on('roomState', (room) => {
        if (room.status !== 'lobby') return;
        appState.room = room;
        appState.matchups = [];
        appState.matchupEndsAt = null;
        appState.tournament = null;
        appState.roundResult = null;
        appState.spectatingMatchId = null;
        this.scene.start('LobbyScene');
      }),
      network.on('roundComplete', (result) => {
        appState.room = result.room;
        appState.tournament = result;
        appState.roundResult = result;
        this.backToMatchups();
      }),
      network.on('matchStarted', (message) => {
        appState.room = message.room;
        appState.matchups = message.matchups;
        appState.matchupEndsAt = message.phaseEndsAt;
        appState.roundResult = null;
        this.backToMatchups(false);
      }),
      network.on('finalResults', (results) => {
        appState.room = results.room;
        appState.finalResults = results;
        appState.spectatingMatchId = null;
        network.stopWatchingMatch();
        this.scene.start('FinalResultsScene');
      }),
      network.on('spectatorShot', (shot) => void this.playSpectatorShot(shot)),
      network.on('spectatorShotResult', (result) => this.handleSpectatorShotResult(result)),
      network.on('error', ({ code, message }) => {
        if (code === 'MATCH_NOT_LIVE' || code === 'OWN_MATCH_ACTIVE' || code === 'NOT_BOWLING') {
          this.showToast(message);
          window.setTimeout(() => this.backToMatchups(false), 450);
          return;
        }
        this.showToast(message);
      })
    );

    this.events.once('shutdown', () => {
      window.clearTimeout(this.returnTimer);
      this.returnTimer = 0;
      this.stopClocks();
      this.simulator?.destroy();
      this.simulator = undefined;
      this.cleanup.splice(0).forEach((fn) => fn());
    });
  }

  private shouldReturnToOwnGame(state: TournamentState): boolean {
    const me = state.room.players.find((player) => player.id === appState.playerId);
    if (me?.isHost) return false;
    const ownMatch = findOwnMatch(state);
    return Boolean(ownMatch && !ownMatch.complete && ownMatch.playerB);
  }

  private render(state: TournamentState): void {
    if (!this.ui || !appState.spectatingMatchId) return;
    const match = state.matches.find((candidate) => candidate.id === appState.spectatingMatchId);
    if (!match) return void this.backToMatchups();

    this.lastMatchFingerprint = watchedMatchFingerprint(state, match.id);
    this.stopClocks();
    this.simulator?.destroy();
    this.simulator = undefined;

    const me = state.room.players.find((player) => player.id === appState.playerId);
    const isHost = Boolean(me?.isHost);
    const ownMatch = findOwnMatch(state);
    const ownActive = Boolean(ownMatch && !ownMatch.complete && ownMatch.playerB);
    const lanePaused = Boolean(match.disconnectedPlayerId && match.reconnectEndsAt && !match.complete);
    const disconnectedPlayer = lanePaused ? playerInMatch(match, match.disconnectedPlayerId) : null;
    const disconnectedName = disconnectedPlayer?.name ?? 'Player';
    const mathGame = !lanePaused && state.room.level !== 1 ? match.games.find((game) => game.pendingMathFrames.length > 0) : undefined;
    const mathFrame = mathGame?.pendingMathFrames[0];
    const activePlayerId = mathGame?.playerId ?? match.currentPlayerId;
    const activePlayer = playerInMatch(match, activePlayerId);
    const activeGame = activePlayerId ? match.games.find((game) => game.playerId === activePlayerId) : undefined;
    const displayedGame = activeGame ?? match.games[0];
    const standingPins = displayedGame?.standingPins ?? fallbackStandingPins(displayedGame);
    const laneLabel = match.championship ? '👑 Championship Lane' : `Lane ${match.lane}`;

    this.ui.innerHTML = `
      <div class="bowling-shell interactive realistic-bowling-shell live-spectator-shell">
        <header class="bowling-top panel">
          <div><div class="bowling-lane-title">${laneLabel} <span class="global-live-pill">● LIVE</span></div></div>
          <div class="bowling-meta">
            <span>LEVEL ${state.room.level}</span>
            <button id="spectator-matchups" class="host-nav-btn spectator-nav-btn" type="button">← BACK TO MATCHUPS</button>
            ${isHost && ownActive ? '<button id="spectator-own-game" class="host-nav-btn spectator-nav-btn" type="button">🎳 RETURN TO MY GAME</button>' : ''}
            ${isHost ? '<button id="spectator-lobby" class="host-nav-btn return-lobby-trigger" type="button">↩ LOBBY</button>' : ''}
          </div>
        </header>
        <main class="bowling-main realistic-bowling-main">
          <section class="score-panel panel">
            ${renderPlayerHeader(match.playerA.name, match.playerA.id, match.currentPlayerId, match.winnerId)}
            ${renderScorecard(match.games.find((game) => game.playerId === match.playerA.id))}
            ${match.playerB ? `${renderPlayerHeader(match.playerB.name, match.playerB.id, match.currentPlayerId, match.winnerId)}${renderScorecard(match.games.find((game) => game.playerId === match.playerB!.id))}` : '<div class="bye-card">🦃 BYE — no live bowling on this lane.</div>'}
          </section>
          <section class="lane-simulator panel realistic-simulator-panel">
            <div class="sim-stage">
              <canvas id="bowling-sim-canvas" class="bowling-sim-canvas" aria-label="Live spectator view of the bowling lane."></canvas>
              <div class="sim-stage-hud">
                <span id="sim-speed">BALL SPEED — KM/H</span>
                <strong id="sim-shot-note">${match.complete ? 'MATCH COMPLETE' : lanePaused ? 'MATCH PAUSED • RECONNECTING' : activePlayer ? `WATCHING ${escapeHtml(activePlayer.name)}` : 'LIVE MATCH'}</strong>
              </div>
            </div>
            <div class="turn-callout ${lanePaused ? 'disconnect-paused' : 'spectating-turn'}">
              <span>${match.complete ? 'MATCH COMPLETE' : lanePaused ? `${escapeHtml(disconnectedName)} DISCONNECTED — MATCH PAUSED` : mathGame && activePlayer ? `${escapeHtml(activePlayer.name)} — SCORE CHECK` : activePlayer ? `LIVE • ${escapeHtml(activePlayer.name)} — FRAME ${activeGame?.currentFrame ?? 1}` : 'LIVE MATCH'}</span>
            </div>
            <div class="frame-progress">${activePlayer && activeGame ? `${escapeHtml(activePlayer.name)} • ${frameStatus(activeGame)}` : 'Waiting for the next live action…'}</div>
            ${lanePaused ? renderReconnectPanel(disconnectedName) : renderGlobalSpectatorPanel(activePlayer, activeGame, match, state.room.level, mathFrame)}
            <div class="global-spectator-note">Live spectator view mirrors the real lane. Aim, hook, power/release controls and private keypad entry are intentionally hidden.</div>
          </section>
        </main>
      </div>`;

    const canvas = this.ui.querySelector<HTMLCanvasElement>('#bowling-sim-canvas');
    if (canvas) {
      this.simulator = new BowlingSimulator(canvas, standingPins);
      this.simulator.setSetupVisible(false);
    }

    this.ui.querySelector<HTMLButtonElement>('#spectator-matchups')?.addEventListener('click', () => this.backToMatchups());
    this.ui.querySelector<HTMLButtonElement>('#spectator-own-game')?.addEventListener('click', () => this.returnToOwnGame());
    this.ui.querySelector<HTMLButtonElement>('#spectator-lobby')?.addEventListener('click', () => this.openReturnLobbyConfirm());

    if (lanePaused && match.reconnectEndsAt) this.runReconnectClock(match.reconnectEndsAt);
    else if (mathGame && mathFrame !== undefined) this.runMathClock(mathGame.mathEndsAt, state.room.level);
    else if (activePlayer && activeGame && match.currentPlayerId === activePlayer.id && !activeGame.complete) this.runShotClock(match.turnEndsAt);

    if (match.complete) {
      window.clearTimeout(this.returnTimer);
      this.returnTimer = window.setTimeout(() => this.backToMatchups(), 1350);
    }
  }

  private runShotClock(turnEndsAt: number | null): void {
    cancelAnimationFrame(this.shotClockFrame);
    this.shotClockFrame = 0;
    if (!turnEndsAt) return;
    const update = () => {
      if (!this.ui) return;
      const clock = this.ui.querySelector<HTMLElement>('#spectator-shot-clock');
      if (!clock) return;
      const remainingMs = Math.max(0, turnEndsAt - Date.now());
      const seconds = Math.ceil(remainingMs / 1000);
      clock.textContent = remainingMs > 0 ? `${seconds}s` : 'TIME!';
      clock.classList.toggle('urgent', seconds <= 5);
      if (remainingMs > 0) this.shotClockFrame = requestAnimationFrame(update);
    };
    update();
  }

  private runMathClock(mathEndsAt: number | null, level: 1 | 2 | 3): void {
    cancelAnimationFrame(this.mathClockFrame);
    this.mathClockFrame = 0;
    if (!mathEndsAt) return;
    const totalMs = level === 2 ? 20000 : 30000;
    const update = () => {
      if (!this.ui) return;
      const clock = this.ui.querySelector<HTMLElement>('#spectator-math-clock');
      const bar = this.ui.querySelector<HTMLElement>('#spectator-math-clock-bar');
      if (!clock) return;
      const remainingMs = Math.max(0, mathEndsAt - Date.now());
      const seconds = Math.ceil(remainingMs / 1000);
      clock.textContent = remainingMs > 0 ? `${seconds}s` : 'TIME!';
      clock.classList.toggle('urgent', seconds <= 5);
      if (bar) {
        bar.style.transform = `scaleX(${Math.max(0, Math.min(1, remainingMs / totalMs))})`;
        bar.classList.toggle('urgent', seconds <= 5);
      }
      if (remainingMs > 0) this.mathClockFrame = requestAnimationFrame(update);
    };
    update();
  }

  private runReconnectClock(reconnectEndsAt: number): void {
    cancelAnimationFrame(this.reconnectClockFrame);
    this.reconnectClockFrame = 0;
    const update = () => {
      if (!this.ui) return;
      const clock = this.ui.querySelector<HTMLElement>('#disconnect-reconnect-clock');
      if (!clock) return;
      const remainingMs = Math.max(0, reconnectEndsAt - Date.now());
      const seconds = Math.ceil(remainingMs / 1000);
      clock.textContent = remainingMs > 0 ? String(seconds) : '0';
      clock.classList.toggle('urgent', seconds <= 5);
      if (remainingMs > 0) this.reconnectClockFrame = requestAnimationFrame(update);
    };
    update();
  }

  private stopClocks(): void {
    cancelAnimationFrame(this.shotClockFrame);
    cancelAnimationFrame(this.mathClockFrame);
    cancelAnimationFrame(this.reconnectClockFrame);
    this.shotClockFrame = 0;
    this.mathClockFrame = 0;
    this.reconnectClockFrame = 0;
  }

  private async playSpectatorShot(shot: SpectatorShot): Promise<void> {
    if (!this.scene.isActive() || !this.ui || !this.simulator || shot.matchId !== appState.spectatingMatchId) return;
    const state = appState.tournament;
    const match = state?.matches.find((candidate) => candidate.id === shot.matchId);
    const bowler = match ? playerInMatch(match, shot.playerId) : null;
    if (!match || !bowler) return;

    cancelAnimationFrame(this.shotClockFrame);
    this.shotClockFrame = 0;
    this.spectatorPlayerId = shot.playerId;
    this.spectatorStandingBefore = shot.standingPins.length;
    this.simulator.setSetupVisible(false);
    this.simulator.setStandingPins(shot.standingPins);

    const note = this.ui.querySelector<HTMLElement>('#sim-shot-note');
    const speed = this.ui.querySelector<HTMLElement>('#sim-speed');
    const status = this.ui.querySelector<HTMLElement>('#spectator-live-status');
    if (note) note.textContent = `LIVE — ${bowler.name.toUpperCase()} BOWLING`;
    if (speed) speed.textContent = 'BALL IN MOTION…';
    if (status) status.textContent = `${bowler.name} has released the ball — this is the exact live attempt.`;

    let impactPromise: Promise<void> | null = null;
    let celebrationShown = false;
    const gameAtRelease = match.games.find((game) => game.playerId === shot.playerId);
    const anticipatedCelebration = gameAtRelease ? clearedRackCelebration(gameAtRelease, this.spectatorStandingBefore) : null;
    const playImpact = () => {
      if (!impactPromise) impactPromise = audioDirector.playPinImpact();
    };
    const showCelebration = () => {
      if (celebrationShown || !anticipatedCelebration || !this.scene.isActive() || !this.ui || this.spectatorPlayerId !== shot.playerId) return;
      celebrationShown = true;
      this.showBowlingCelebration(anticipatedCelebration);
      if (anticipatedCelebration.kind === 'strike') audioDirector.playCheer();
    };

    let result: BowlingShotResult;
    try {
      result = await this.simulator.bowl({
        startPosition: shot.startPosition,
        aim: shot.aim,
        hook: shot.hook,
        power: shot.power,
        releaseTiming: shot.releaseTiming,
        releaseInGreen: shot.releaseInGreen,
        seed: shot.seed,
        onLoudPinImpact: playImpact,
        onRackCleared: showCelebration
      });
    } catch {
      return;
    }
    if (!this.scene.isActive() || !this.ui || this.spectatorPlayerId !== shot.playerId) return;

    if (speed) speed.textContent = `BALL SPEED ${result.speedKmh.toFixed(1)} KM/H`;
    const label = shotResultLabel(result, this.spectatorStandingBefore);
    if (note) note.textContent = label;
    if (status) status.textContent = label;

    const latestMatch = appState.tournament?.matches.find((candidate) => candidate.id === shot.matchId);
    const latestGame = latestMatch?.games.find((game) => game.playerId === shot.playerId);
    const celebration = latestGame ? shotCelebration(latestGame, result, this.spectatorStandingBefore) : null;
    if (!result.gutter && result.knockedPins.length > 2 && !impactPromise) playImpact();
    if (celebration && !celebrationShown) {
      celebrationShown = true;
      this.showBowlingCelebration(celebration);
      if (celebration.kind === 'strike') audioDirector.playCheer();
    }
  }

  private handleSpectatorShotResult(result: SpectatorShotResult): void {
    if (!this.scene.isActive() || !this.ui || result.matchId !== appState.spectatingMatchId || result.playerId !== this.spectatorPlayerId) return;
    const authoritative: BowlingShotResult = {
      knockedPins: result.knockedPins,
      speedKmh: result.speedKmh,
      gutter: result.gutter,
      headPinHit: false
    };
    const speed = this.ui.querySelector<HTMLElement>('#sim-speed');
    const note = this.ui.querySelector<HTMLElement>('#sim-shot-note');
    const status = this.ui.querySelector<HTMLElement>('#spectator-live-status');
    if (speed && result.speedKmh > 0) speed.textContent = `BALL SPEED ${result.speedKmh.toFixed(1)} KM/H`;
    const label = shotResultLabel(authoritative, this.spectatorStandingBefore);
    if (note) note.textContent = label;
    if (status) status.textContent = `Official result: ${label}`;
  }

  private showBowlingCelebration(celebration: BowlingCelebration): void {
    if (!this.ui) return;
    this.ui.querySelector('#bowling-celebration')?.remove();
    this.ui.insertAdjacentHTML('beforeend', `<div id="bowling-celebration" class="bowling-celebration ${celebration.kind}">
      <div class="celebration-rays"></div>
      <div class="celebration-card">
        <div class="celebration-graphic">${celebration.graphic}</div>
        <div class="celebration-title">${celebration.title}</div>
        <div class="celebration-subtitle">${celebration.subtitle}</div>
      </div>
    </div>`);
    window.setTimeout(() => this.ui?.querySelector('#bowling-celebration')?.remove(), 1250);
  }

  private backToMatchups(sendStop = true): void {
    if (!this.scene.isActive()) return;
    window.clearTimeout(this.returnTimer);
    this.returnTimer = 0;
    if (sendStop) network.stopWatchingMatch();
    appState.spectatingMatchId = null;
    this.scene.start('MatchupScene');
  }

  private returnToOwnGame(): void {
    if (!this.scene.isActive()) return;
    network.stopWatchingMatch();
    appState.spectatingMatchId = null;
    this.scene.start('BowlingScene');
  }

  private openReturnLobbyConfirm(): void {
    if (!this.ui || this.ui.querySelector('#return-lobby-confirm')) return;
    this.ui.insertAdjacentHTML('beforeend', renderReturnLobbyConfirm());
    this.ui.querySelector<HTMLButtonElement>('#return-lobby-no')?.addEventListener('click', () => this.ui?.querySelector('#return-lobby-confirm')?.remove());
    this.ui.querySelector<HTMLButtonElement>('#return-lobby-yes')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = 'RETURNING…';
      network.returnToLobby();
    });
  }

  private showToast(message: string): void {
    if (!this.ui) return;
    const toast = document.createElement('div');
    toast.className = 'game-toast';
    toast.textContent = message;
    this.ui.appendChild(toast);
    window.setTimeout(() => toast.remove(), 1800);
  }
}

function renderReconnectPanel(name: string): string {
  return `<div class="disconnect-reconnect-panel" role="status" aria-live="polite">
    <div class="disconnect-reconnect-icon">📡</div>
    <div class="disconnect-reconnect-copy">
      <strong>${escapeHtml(name)} disconnected — waiting for reconnection…</strong>
      <span>This live lane is paused. If they do not return within 20 seconds, the connected opponent wins by forfeit.</span>
    </div>
    <div class="disconnect-reconnect-countdown"><strong id="disconnect-reconnect-clock">20</strong><small>SECONDS</small></div>
  </div>`;
}

function renderGlobalSpectatorPanel(
  player: PlayerSummary | null,
  game: BowlerScorecard | undefined,
  match: LaneMatchState,
  level: 1 | 2 | 3,
  mathFrame: number | undefined
): string {
  if (match.complete) return `<div class="spectator-turn-panel quiet"><strong>MATCH COMPLETE</strong><span>Returning to Class Matchups…</span></div>`;
  if (!player || !game) return `<div class="spectator-turn-panel quiet"><strong>WAITING</strong><span>The next live action will appear automatically.</span></div>`;

  if (mathFrame !== undefined) {
    const attempts = game.mathAttempts.length
      ? game.mathAttempts.map((attempt, index) => `<span class="spectator-attempt-chip"><b>${index + 1}</b>${attempt}<em>✕</em></span>`).join('')
      : '<span class="spectator-no-attempts">No answer submitted yet</span>';
    const previousTotal = mathFrame === 0 ? 0 : (game.cumulative[mathFrame - 1] ?? 0);
    const frameScore = game.frameScores[mathFrame] ?? 0;
    const calculation = level === 2
      ? `<div class="spectator-guided-calculation"><span><small>PREVIOUS TOTAL</small><strong>${previousTotal}</strong></span><b>+</b><span><small>FRAME SCORE</small><strong>${frameScore}</strong></span><b>=</b><strong class="spectator-question">?</strong></div>`
      : `<div class="spectator-independent-scorecard">${renderMiniScorecard(game, mathFrame)}</div>`;
    return `<div class="spectator-math-panel global-spectator-math">
      <div class="spectator-live-header"><span class="live-dot">LIVE</span><strong>${escapeHtml(player.name)} is calculating</strong></div>
      <div class="spectator-math-title">LEVEL ${level} SCORE CHECK • FRAME ${mathFrame + 1}</div>
      ${calculation}
      <div class="spectator-math-clock-row"><span>TIME REMAINING</span><strong id="spectator-math-clock">${level === 2 ? '20s' : '30s'}</strong></div>
      <div class="spectator-math-clock-track"><i id="spectator-math-clock-bar"></i></div>
      <div class="spectator-attempts"><span>SUBMITTED ATTEMPTS</span><div>${attempts}</div></div>
      <small>The live scorecard and submitted checks are visible; the player's current keypad entry stays private.</small>
    </div>`;
  }

  if (match.currentPlayerId === player.id && !game.complete) {
    return `<div class="spectator-turn-panel live">
      <div class="spectator-live-header"><span class="live-dot">LIVE</span><strong>${escapeHtml(player.name)}'s bowling attempt</strong></div>
      <div id="spectator-live-status" class="spectator-live-status">They are setting up the shot. Aim, hook and power/release meters stay private.</div>
      <div class="spectator-shot-clock-row"><span>SHOT CLOCK</span><strong id="spectator-shot-clock">15s</strong></div>
      <small>When the ball is released, the exact trajectory, speed, pin collisions and celebration replay here.</small>
    </div>`;
  }

  return `<div class="spectator-turn-panel quiet"><strong>WAITING</strong><span>The next live action will appear automatically.</span></div>`;
}

function renderMiniScorecard(game: BowlerScorecard, focusFrame: number): string {
  return `<div class="math-scorecard-shell spectator-mini-scorecard">
    <div class="math-scorecard-title"><span>LIVE SCORECARD</span><strong>Frame ${focusFrame + 1}</strong></div>
    <div class="math-scorecard-mini">
      ${game.frames.map((rolls, index) => {
        const tenth = index === 9;
        const rollText = tenth
          ? [0, 1, 2].map((rollIndex) => formatRollSymbol(rolls, rollIndex, true) || '·').join(' ')
          : rolls[0] === 10 ? 'X' : [0, 1].map((rollIndex) => formatRollSymbol(rolls, rollIndex, false) || '·').join(' ');
        return `<div class="math-mini-frame${index === focusFrame ? ' focus' : ''}"><span>${index + 1}</span><b>${rollText}</b><em>${game.cumulative[index] ?? '—'}</em></div>`;
      }).join('')}
    </div>
  </div>`;
}

function findOwnMatch(state: TournamentState): LaneMatchState | undefined {
  return state.matches.find((match) => match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId);
}

function playerInMatch(match: LaneMatchState, playerId: string | null): PlayerSummary | null {
  if (!playerId) return null;
  if (match.playerA.id === playerId) return match.playerA;
  if (match.playerB?.id === playerId) return match.playerB;
  return null;
}

function watchedMatchFingerprint(state: TournamentState, matchId: string): string {
  const match = state.matches.find((candidate) => candidate.id === matchId);
  if (!match) return 'missing';
  return JSON.stringify({
    id: match.id,
    currentPlayerId: match.currentPlayerId,
    complete: match.complete,
    winnerId: match.winnerId,
    turnEndsAt: match.turnEndsAt,
    disconnectedPlayerId: match.disconnectedPlayerId,
    reconnectEndsAt: match.reconnectEndsAt,
    forfeitPlayerId: match.forfeitPlayerId,
    games: match.games
  });
}

interface BowlingCelebration {
  kind: 'spare' | 'strike';
  title: string;
  subtitle: string;
  graphic: string;
}

function clearedRackCelebration(game: BowlerScorecard, standingBefore: number): BowlingCelebration | null {
  if (standingBefore <= 0) return null;
  return shotCelebration(game, {
    knockedPins: Array.from({ length: standingBefore }, (_, index) => index),
    speedKmh: 0,
    gutter: false,
    headPinHit: standingBefore === 10
  }, standingBefore);
}

function shotCelebration(game: BowlerScorecard, result: BowlingShotResult, standingBefore: number): BowlingCelebration | null {
  if (standingBefore < 10 && standingBefore > 0 && result.knockedPins.length === standingBefore) {
    return { kind: 'spare', title: 'SPARE!', subtitle: 'Every remaining pin cleaned up', graphic: '✨ 🎳 ✨' };
  }
  if (standingBefore !== 10 || result.knockedPins.length !== 10) return null;
  const previousStreak = trailingStrikeCount(game.frames);
  const streak = previousStreak + 1;
  const frontSeven = streak === 7 && flattenedRolls(game.frames).every((roll) => roll === 10);
  const names: Record<number, [string, string]> = {
    1: ['STRIKE!', 'Pocket power'], 2: ['DOUBLE!', 'Two strikes in a row'], 3: ['TURKEY!', 'Three strikes in a row'],
    4: ['HAMBONE!', 'Four strikes in a row'], 5: ['FIVE-BAGGER!', 'Five strikes in a row'], 6: ['SIX-PACK!', 'Six strikes in a row'],
    7: [frontSeven ? 'FRONT SEVEN!' : 'SEVEN-BAGGER!', 'Seven strikes in a row'], 8: ['EIGHT-BAGGER!', 'Eight strikes in a row'],
    9: ['GOLDEN TURKEY!', 'Nine strikes in a row'], 10: ['TEN-BAGGER!', 'Ten strikes in a row'],
    11: ['ELEVEN-BAGGER!', 'Eleven strikes in a row'], 12: ['PERFECT 300!', 'Twelve strikes • perfect game']
  };
  const [title, subtitle] = names[Math.min(12, streak)] ?? [`${streak}-BAGGER!`, `${streak} strikes in a row`];
  const graphic = streak === 3 ? '🦃' : streak === 4 ? '🍖 🎳' : streak === 9 ? '✨ 🦃 ✨' : streak >= 12 ? '🏆 300 🏆' : '💥 🎳 💥';
  return { kind: 'strike', title, subtitle, graphic };
}

function flattenedRolls(frames: number[][]): number[] { return frames.flatMap((frame) => frame); }
function trailingStrikeCount(frames: number[][]): number {
  const rolls = flattenedRolls(frames);
  let count = 0;
  for (let i = rolls.length - 1; i >= 0 && rolls[i] === 10; i--) count++;
  return count;
}

function renderPlayerHeader(name: string, id: string, turnId: string | null, winnerId: string | null): string {
  return `<div class="score-player${turnId === id ? ' active' : ''}${winnerId === id ? ' winner' : ''}"><span>${winnerId === id ? '🏆 ' : ''}${escapeHtml(name)}</span><span>${turnId === id ? 'BOWLING' : ''}</span></div>`;
}

function renderScorecard(game?: BowlerScorecard): string {
  if (!game) return '';
  return `<div class="scorecard">${game.frames.map((rolls, index) => {
    const tenth = index === 9;
    return `<div class="frame-box${tenth ? ' tenth' : ''}${game.currentFrame === index + 1 && !game.complete ? ' current' : ''}">
      <div class="frame-num">${index + 1}</div><div class="frame-rolls">${renderRollCells(rolls, tenth)}</div><div class="frame-total">${game.cumulative[index] ?? ''}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderRollCells(rolls: number[], tenth: boolean): string {
  if (!tenth) {
    if (rolls[0] === 10) return `<span class="roll-cell"></span><span class="roll-cell">X</span>`;
    return [0, 1].map((index) => `<span class="roll-cell">${formatRollSymbol(rolls, index, false)}</span>`).join('');
  }
  return [0, 1, 2].map((index) => `<span class="roll-cell">${formatRollSymbol(rolls, index, true)}</span>`).join('');
}

function formatRollSymbol(rolls: number[], index: number, tenth: boolean): string {
  const roll = rolls[index];
  if (roll === undefined) return '';
  if (roll === 10) return 'X';
  if (roll === 0) return '-';
  if (!tenth && index === 1 && (rolls[0] ?? 0) + roll === 10) return '/';
  if (tenth && index === 1 && rolls[0] !== 10 && (rolls[0] ?? 0) + roll === 10) return '/';
  if (tenth && index === 2 && rolls[0] === 10 && rolls[1] !== 10 && (rolls[1] ?? 0) + roll === 10) return '/';
  return String(roll);
}

function frameStatus(game: BowlerScorecard): string {
  if (game.complete && game.pendingMathFrames.length) return 'All 10 frames are complete • score checks still in progress.';
  if (game.complete) return `10-frame game complete — score ${game.total ?? game.finalScore ?? 0}.`;
  return `Frame ${game.currentFrame} of 10 • ${game.standingPins?.length ?? 10} pin${(game.standingPins?.length ?? 10) === 1 ? '' : 's'} standing`;
}

function fallbackStandingPins(game?: BowlerScorecard): number[] {
  if (!game) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const frame = game.frames[Math.min(9, game.currentFrame - 1)] ?? [];
  let standing = 10;
  if (game.currentFrame < 10 && frame.length === 1 && frame[0] !== 10) standing = 10 - frame[0];
  return Array.from({ length: standing }, (_, index) => index);
}

function shotResultLabel(result: BowlingShotResult, standingBefore: number): string {
  if (result.gutter && result.knockedPins.length === 0) return 'GUTTER BALL';
  if (standingBefore === 10 && result.knockedPins.length === 10) return '💥 STRIKE!';
  if (standingBefore < 10 && result.knockedPins.length === standingBefore) return '✨ SPARE!';
  if (result.knockedPins.length === 0) return 'MISS — 0 PINS';
  return `${result.knockedPins.length} PIN${result.knockedPins.length === 1 ? '' : 'S'} DOWN`;
}

function renderReturnLobbyConfirm(): string {
  return `<div id="return-lobby-confirm" class="return-lobby-overlay"><section class="return-lobby-card panel" role="dialog" aria-modal="true" aria-labelledby="return-lobby-title">
    <div class="return-lobby-icon">⚠️</div><h2 id="return-lobby-title">Return everyone to the lobby?</h2>
    <p>This will <strong>cancel every bowling game currently in progress</strong>, clear the live lane results and wins leaderboard, and return all connected players to the lobby.</p>
    <div class="return-lobby-actions"><button id="return-lobby-no" class="secondary-btn" type="button">NO — KEEP PLAYING</button><button id="return-lobby-yes" class="danger-btn" type="button">YES — RETURN TO LOBBY</button></div>
  </section></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}
