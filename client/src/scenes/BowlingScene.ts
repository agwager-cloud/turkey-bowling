import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { appState } from '../state';
import { network } from '../net/NetworkManager';
import { audioDirector } from '../audio/AudioDirector';
import { BowlingSimulator, type BowlingShotConfig, type BowlingShotResult } from '../game/BowlingSimulator';
import type { BowlerScorecard, LaneMatchState, PlayerSummary, SpectatorShot, SpectatorShotResult, TournamentState } from '../types';

type ControlPhase = 'ready' | 'timing' | 'bowling';

const METER_GREEN_START = 0.73;
const METER_GREEN_END = 0.79;
const METER_OPTIMAL = (METER_GREEN_START + METER_GREEN_END) / 2;
const MIN_TIMEOUT_POWER = 0.12;

export class BowlingScene extends BaseBowlingScene {
  private cleanup: Array<() => void> = [];
  private ui?: HTMLDivElement;
  private movingToResult = false;
  private resultTimer = 0;
  private simulator?: BowlingSimulator;
  private meterFrame = 0;
  private shotClockFrame = 0;
  private mathClockFrame = 0;
  private reconnectClockFrame = 0;
  private meterStartedAt = 0;
  private meterPosition = 0;
  private meterSpeedDivisor = 360;
  private releaseInGreen = false;
  private timeoutAutoFired = false;
  private controlPhase: ControlPhase = 'ready';
  private startPosition = 0;
  private aim = 0;
  private hook = 0;
  private power = 0.68;
  private releaseTiming = 0;
  private lastMatchFingerprint = '';
  private mathEntry = '';
  private mathFeedback = '';
  private activeMathFrame: number | null = null;
  private spectatorPlayerId: string | null = null;
  private spectatorStandingBefore = 10;
  private renderToken = 0;

  constructor() { super('BowlingScene'); }

  create(): void {
    this.setupBaseScene();
    this.movingToResult = false;
    window.clearTimeout(this.resultTimer);
    this.resultTimer = 0;
    this.lastMatchFingerprint = '';
    this.activeMathFrame = null;
    this.stopMeter();
    this.stopShotClock();
    this.stopMathClock();
    this.stopReconnectClock();
    this.simulator?.destroy();
    this.simulator = undefined;

    if (!appState.tournament) return void this.scene.start('MatchupScene');
    this.ui = createSceneUi();
    this.render(appState.tournament);

    this.cleanup.push(
      network.on('bowlingState', (state) => {
        const nextFingerprint = myMatchFingerprint(state);
        appState.room = state.room;
        appState.tournament = state;
        // Other lanes can generate frequent state broadcasts. Do not destroy a
        // student's aim/power/release controls when their own lane did not change.
        if (nextFingerprint !== this.lastMatchFingerprint) this.render(state);
      }),
      network.on('roomState', (room) => {
        if (room.status !== 'lobby') return;
        appState.room = room;
        appState.matchups = [];
        appState.matchupEndsAt = 0;
        appState.tournament = null;
        appState.roundResult = null;
        this.scene.start('LobbyScene');
      }),
      network.on('roundComplete', (result) => {
        appState.room = result.room;
        appState.roundResult = result;
        appState.tournament = result;
        this.goToMatchResult();
      }),
      network.on('matchStarted', (message) => {
        appState.room = message.room;
        appState.matchups = message.matchups;
        appState.matchupEndsAt = message.phaseEndsAt;
        appState.roundResult = null;
        this.scene.start('MatchupScene');
      }),
      network.on('finalResults', (results) => {
        appState.room = results.room;
        appState.finalResults = results;
        this.scene.start('FinalResultsScene');
      }),
      network.on('scoreFeedback', (feedback) => this.handleScoreFeedback(feedback.correct, feedback.message)),
      network.on('spectatorShot', (shot) => void this.playSpectatorShot(shot)),
      network.on('spectatorShotResult', (result) => this.handleSpectatorShotResult(result)),
      network.on('close', () => this.showToast('Connection lost — trying to rejoin your match for up to 20 seconds…')),
      network.on('error', ({ message }) => this.showToast(message))
    );

    this.events.once('shutdown', () => {
      window.clearTimeout(this.resultTimer);
      this.resultTimer = 0;
      this.stopMeter();
      this.stopShotClock();
      this.stopMathClock();
      this.stopReconnectClock();
      this.simulator?.destroy();
      this.simulator = undefined;
      this.cleanup.splice(0).forEach((fn) => fn());
    });
  }

  private render(state: TournamentState): void {
    if (!this.ui) return;
    const match = findMyMatch(state);
    if (!match) return;
    this.renderToken++;
    this.lastMatchFingerprint = myMatchFingerprint(state);
    this.stopMeter();
    this.stopShotClock();
    this.stopMathClock();
    this.stopReconnectClock();
    this.simulator?.destroy();
    this.simulator = undefined;
    this.controlPhase = 'ready';
    // Every delivery starts from a neutral setup so finding a good line is part
    // of every bowl rather than a reusable one-time solution.
    this.startPosition = 0;
    this.aim = 0;
    this.hook = 0;
    this.power = 0.68;
    this.releaseTiming = 0;
    this.meterPosition = 0;
    this.releaseInGreen = false;
    this.timeoutAutoFired = false;

    const me = state.room.players.find((p) => p.id === appState.playerId);
    const opponent = match.playerA.id === appState.playerId ? match.playerB : match.playerA;
    const myGame = match.games.find((game) => game.playerId === appState.playerId);
    const opponentGame = opponent ? match.games.find((game) => game.playerId === opponent.id) : null;
    const lanePaused = Boolean(match.disconnectedPlayerId && match.reconnectEndsAt && !match.complete);
    const disconnectedPlayer = lanePaused ? state.room.players.find((player) => player.id === match.disconnectedPlayerId) : null;
    const disconnectedName = disconnectedPlayer?.name ?? (match.disconnectedPlayerId === opponent?.id ? opponent?.name : match.disconnectedPlayerId === me?.id ? me?.name : 'Opponent') ?? 'Opponent';
    const pendingMathFrame = state.room.level === 1 ? undefined : myGame?.pendingMathFrames[0];
    const nextMathFrame = pendingMathFrame ?? null;
    if (nextMathFrame !== this.activeMathFrame) {
      this.activeMathFrame = nextMathFrame;
      this.mathEntry = '';
      this.mathFeedback = '';
    }
    const mathRequired = pendingMathFrame !== undefined;
    const rawMyTurn = match.currentPlayerId === appState.playerId && !match.complete;
    const isHost = Boolean(me?.isHost);
    const opponentMathFrame = state.room.level === 1 ? undefined : opponentGame?.pendingMathFrames[0];
    const opponentMathRequired = opponentMathFrame !== undefined;
    // Even if the server has already assigned the next bowling turn to us, the
    // lane remains paused until the previous bowler finishes their maths. Do
    // not expose controls or start a local countdown during that pause.
    const myTurn = !lanePaused && rawMyTurn && !mathRequired && !opponentMathRequired;
    const watchingOpponent = Boolean(!lanePaused && opponent && !match.complete && !myTurn && (match.currentPlayerId === opponent.id || opponentMathRequired));
    const displayedGame = watchingOpponent ? opponentGame : myGame;
    const standingPins = displayedGame?.standingPins ?? fallbackStandingPins(displayedGame ?? myGame);
    const spectatorPanel = lanePaused
      ? renderReconnectPanel(disconnectedName)
      : myTurn
        ? renderPlayerShotControls(this.aim, this.hook)
        : renderSpectatorTurnPanel(opponent, opponentGame, match, state.room.level, opponentMathFrame);

    this.ui.innerHTML = `
      <div class="bowling-shell interactive realistic-bowling-shell">
        <header class="bowling-top panel">
          <div><div class="bowling-lane-title">${match.championship ? '👑 Championship Lane' : `Lane ${match.lane}`}</div></div>
          <div class="bowling-meta"><span>LEVEL ${state.room.level}</span>${isHost ? '<button id="host-matchups" class="host-nav-btn" type="button">CLASS MATCHUPS</button><button id="host-lobby" class="host-nav-btn return-lobby-trigger" type="button">↩ LOBBY</button>' : ''}</div>
        </header>
        <main class="bowling-main realistic-bowling-main">
          <section class="score-panel panel">
            ${renderPlayerHeader(match.playerA.name, match.playerA.id, match.currentPlayerId, match.winnerId)}
            ${renderScorecard(match.games.find((g) => g.playerId === match.playerA.id))}
            ${match.playerB ? `${renderPlayerHeader(match.playerB.name, match.playerB.id, match.currentPlayerId, match.winnerId)}${renderScorecard(match.games.find((g) => g.playerId === match.playerB!.id))}` : '<div class="bye-card">🦃 BYE — you automatically win this lane match.</div>'}
          </section>
          <section class="lane-simulator panel realistic-simulator-panel">
            <div class="sim-stage">
              <canvas id="bowling-sim-canvas" class="bowling-sim-canvas${myTurn ? ' start-position-draggable' : ''}" aria-label="Perspective ten-pin bowling lane. Drag the ball left or right to choose your starting position."></canvas>
              <div class="sim-stage-hud">
                <span id="sim-speed">BALL SPEED — KM/H</span>
                <strong id="sim-shot-note">${lanePaused ? 'MATCH PAUSED • RECONNECTING' : myTurn ? 'DRAG BALL • SET LINE' : match.complete ? 'MATCH COMPLETE' : watchingOpponent ? `WATCHING ${escapeHtml(opponent?.name ?? 'OPPONENT')}` : 'WAITING'}</strong>
              </div>
            </div>
            <div class="turn-callout ${lanePaused ? 'disconnect-paused' : myTurn ? 'your-turn' : watchingOpponent ? 'spectating-turn' : ''}">
              <span>${match.complete ? 'MATCH COMPLETE' : lanePaused ? `${escapeHtml(disconnectedName)} DISCONNECTED — MATCH PAUSED` : mathRequired && rawMyTurn ? 'SCORE CHECK REQUIRED' : opponentMathRequired ? `WAITING FOR ${escapeHtml(opponent?.name ?? 'OPPONENT')} TO FINISH MATHS` : myTurn ? `YOUR TURN — FRAME ${myGame?.currentFrame ?? 1}` : watchingOpponent ? `WATCHING ${escapeHtml(opponent?.name ?? 'OPPONENT')} — FRAME ${opponentGame?.currentFrame ?? 1}` : `WAITING FOR ${escapeHtml(opponent?.name ?? 'OPPONENT')}`}</span>
              ${myTurn ? '<strong id="shot-clock" class="shot-clock">15s</strong>' : ''}
            </div>
            <div class="frame-progress">${myTurn || mathRequired ? (myGame ? frameStatus(myGame) : '') : (opponentGame ? `${escapeHtml(opponent?.name ?? 'Opponent')} • ${frameStatus(opponentGame)}` : '')}</div>
            ${spectatorPanel}
            ${opponentGame?.complete && !myGame?.complete ? '<div class="opponent-finished-note">Opponent has finished their game.</div>' : ''}
          </section>
        </main>
      </div>
      ${!lanePaused && mathRequired && myGame && pendingMathFrame !== undefined ? renderMathOverlay(state.room.level, myGame, pendingMathFrame) : ''}`;

    const canvas = this.ui.querySelector<HTMLCanvasElement>('#bowling-sim-canvas');
    if (canvas) {
      this.simulator = new BowlingSimulator(canvas, standingPins);
      this.simulator.setSetupVisible(myTurn);
      if (myTurn) {
        this.simulator.setStartPosition(this.startPosition);
        this.simulator.setAim(this.aim);
        this.simulator.setHook(this.hook);
      }
    }

    const aimSlider = this.ui.querySelector<HTMLInputElement>('#aim-slider');
    const hookSlider = this.ui.querySelector<HTMLInputElement>('#hook-slider');

    if (canvas && myTurn && this.simulator) {
      let draggingStartBall = false;
      const moveStartBall = (event: PointerEvent) => {
        if (!draggingStartBall || this.controlPhase !== 'ready' || !this.simulator) return;
        event.preventDefault();
        this.startPosition = this.simulator.startPositionFromClientX(event.clientX);
        this.simulator.setStartPosition(this.startPosition);
      };
      const finishStartDrag = (event: PointerEvent) => {
        if (!draggingStartBall) return;
        draggingStartBall = false;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      canvas.addEventListener('pointerdown', (event) => {
        if (this.controlPhase !== 'ready' || !this.simulator?.isPointerOnStartBall(event.clientX, event.clientY)) return;
        event.preventDefault();
        draggingStartBall = true;
        canvas.setPointerCapture(event.pointerId);
        moveStartBall(event);
      });
      canvas.addEventListener('pointermove', moveStartBall);
      canvas.addEventListener('pointerup', finishStartDrag);
      canvas.addEventListener('pointercancel', finishStartDrag);
    }
    aimSlider?.addEventListener('input', () => {
      this.aim = Number(aimSlider.value) / 100;
      this.simulator?.setAim(this.aim);
      const label = this.ui?.querySelector<HTMLElement>('#aim-label');
      if (label) label.textContent = aimLabel(this.aim);
    });
    hookSlider?.addEventListener('input', () => {
      this.hook = Number(hookSlider.value) / 100;
      this.simulator?.setHook(this.hook);
      const label = this.ui?.querySelector<HTMLElement>('#hook-label');
      if (label) label.textContent = hookLabel(this.hook);
    });

    this.ui.querySelector<HTMLButtonElement>('#shot-btn')?.addEventListener('click', () => this.handleShotButton(myGame, standingPins.length));
    this.ui.querySelector<HTMLButtonElement>('#host-matchups')?.addEventListener('click', () => this.scene.start('MatchupScene'));
    this.ui.querySelector<HTMLButtonElement>('#host-lobby')?.addEventListener('click', () => this.openReturnLobbyConfirm());
    if (lanePaused && match.reconnectEndsAt) {
      this.runReconnectClock(match.reconnectEndsAt);
    } else if (mathRequired && pendingMathFrame !== undefined) {
      this.bindMathKeypad(pendingMathFrame);
      this.runMathClock(myGame?.mathEndsAt ?? null);
    } else if (watchingOpponent && opponentMathFrame !== undefined) {
      this.runSpectatorMathClock(opponentGame?.mathEndsAt ?? null, state.room.level);
    } else if (watchingOpponent) {
      this.runSpectatorShotClock(match.turnEndsAt);
    }

    if (myTurn) this.runShotClock(match.turnEndsAt, myGame, standingPins.length);

    if (match.complete && !this.movingToResult) {
      this.movingToResult = true;
      window.clearTimeout(this.resultTimer);
      this.resultTimer = window.setTimeout(() => this.goToMatchResult(), 250);
    }
  }

  private openReturnLobbyConfirm(): void {
    if (!this.ui || this.ui.querySelector('#return-lobby-confirm')) return;
    this.ui.insertAdjacentHTML('beforeend', renderReturnLobbyConfirm());
    this.ui.querySelector<HTMLButtonElement>('#return-lobby-no')?.addEventListener('click', () => {
      this.ui?.querySelector('#return-lobby-confirm')?.remove();
    });
    this.ui.querySelector<HTMLButtonElement>('#return-lobby-yes')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = 'RETURNING…';
      network.returnToLobby();
    });
  }

  private bindMathKeypad(frameIndex: number): void {
    if (!this.ui) return;
    const display = this.ui.querySelector<HTMLElement>('#math-answer');
    const submit = this.ui.querySelector<HTMLButtonElement>('#math-submit');
    const feedback = this.ui.querySelector<HTMLElement>('#math-feedback');

    const refresh = () => {
      if (display) display.textContent = this.mathEntry || '—';
      if (submit) submit.disabled = this.mathEntry.length === 0;
      if (feedback) feedback.textContent = this.mathFeedback;
    };

    this.ui.querySelectorAll<HTMLButtonElement>('[data-math-digit]').forEach((button) => {
      button.addEventListener('click', () => {
        if (this.mathEntry.length >= 3) return;
        const digit = button.dataset.mathDigit ?? '';
        if (!/^\d$/.test(digit)) return;
        this.mathFeedback = '';
        this.mathEntry = this.mathEntry === '0' ? digit : `${this.mathEntry}${digit}`;
        refresh();
      });
    });
    this.ui.querySelector<HTMLButtonElement>('#math-backspace')?.addEventListener('click', () => {
      this.mathFeedback = '';
      this.mathEntry = this.mathEntry.slice(0, -1);
      refresh();
    });
    this.ui.querySelector<HTMLButtonElement>('#math-clear')?.addEventListener('click', () => {
      this.mathFeedback = '';
      this.mathEntry = '';
      refresh();
    });
    submit?.addEventListener('click', () => {
      if (!this.mathEntry) return;
      const total = Number(this.mathEntry);
      if (!Number.isInteger(total)) return;
      submit.disabled = true;
      network.submitScore(frameIndex, total);
    });
    refresh();
  }

  private handleScoreFeedback(correct: boolean, message: string): void {
    if (!this.ui) return;
    if (correct) {
      this.mathFeedback = '';
      this.showToast('✅ Correct score!');
      return;
    }
    this.mathEntry = '';
    this.mathFeedback = message;
    const display = this.ui.querySelector<HTMLElement>('#math-answer');
    const feedback = this.ui.querySelector<HTMLElement>('#math-feedback');
    const submit = this.ui.querySelector<HTMLButtonElement>('#math-submit');
    if (display) {
      display.textContent = '—';
      display.classList.remove('wrong');
      void display.offsetWidth;
      display.classList.add('wrong');
    }
    if (feedback) feedback.textContent = message;
    if (submit) submit.disabled = true;
  }

  private handleShotButton(game: BowlerScorecard | undefined, standingBefore: number): void {
    if (!game || !this.ui || !this.simulator) return;
    const button = this.ui.querySelector<HTMLButtonElement>('#shot-btn');
    const help = this.ui.querySelector<HTMLElement>('#sim-help');
    const aimSlider = this.ui.querySelector<HTMLInputElement>('#aim-slider');
    const hookSlider = this.ui.querySelector<HTMLInputElement>('#hook-slider');
    if (!button) return;

    if (this.controlPhase === 'ready') {
      this.controlPhase = 'timing';
      this.meterStartedAt = performance.now();
      // Random timing speed each delivery so students cannot memorise one rhythm.
      // Full left-right-left cycles vary from roughly 1.8 to 3.2 seconds.
      this.meterSpeedDivisor = 285 + Math.random() * 225;
      this.ui.querySelector<HTMLCanvasElement>('#bowling-sim-canvas')?.classList.remove('start-position-draggable');
      if (aimSlider) aimSlider.disabled = true;
      if (hookSlider) hookSlider.disabled = true;
      button.textContent = '🎳 RELEASE BALL';
      if (help) help.textContent = 'Release while the needle is inside the small green zone. Outside green changes both power and accuracy and cannot produce a strike.';
      this.runMeter();
      return;
    }

    if (this.controlPhase === 'timing') {
      this.prepareMeterShot();
      this.beginPhysicalShot(game, standingBefore, false);
    }
  }

  private prepareMeterShot(): void {
    const position = Math.max(0, Math.min(1, this.meterPosition));
    // Meter position controls BOTH power and release accuracy. Around 76% is
    // the bowling sweet spot: strong enough for carry without losing accuracy.
    this.power = 0.22 + position * 0.78;
    this.releaseTiming = Math.max(-1, Math.min(1, (position - METER_OPTIMAL) / 0.30));
    this.releaseInGreen = position >= METER_GREEN_START && position <= METER_GREEN_END;
  }

  private beginPhysicalShot(game: BowlerScorecard, standingBefore: number, timedOutBeforeApproach: boolean): void {
    if (!this.ui || this.controlPhase === 'bowling') return;
    this.controlPhase = 'bowling';
    this.stopMeter();
    this.stopShotClock();
    const shotConfig: BowlingShotConfig = {
      startPosition: this.startPosition,
      aim: this.aim,
      hook: this.hook,
      power: this.power,
      releaseTiming: this.releaseTiming,
      releaseInGreen: this.releaseInGreen,
      seed: ((Math.random() * 0xffffffff) >>> 0) || 1
    };
    network.shotStarted(shotConfig);

    const button = this.ui.querySelector<HTMLButtonElement>('#shot-btn');
    const help = this.ui.querySelector<HTMLElement>('#sim-help');
    const readout = this.ui.querySelector<HTMLElement>('#combined-readout');
    if (button) {
      button.disabled = true;
      button.textContent = '🎳 BALL IN MOTION…';
    }
    if (readout && timedOutBeforeApproach) readout.textContent = 'MIN POWER';
    if (help) help.textContent = timedOutBeforeApproach
      ? 'Time expired before the approach — minimum power auto-delivery.'
      : this.releaseInGreen
        ? 'Great release — watch the pocket entry and pin carry.'
        : 'Release missed the green zone — power and accuracy are affected.';
    void this.performShot(game, standingBefore, shotConfig);
  }

  private runMeter(): void {
    cancelAnimationFrame(this.meterFrame);
    const animate = (time: number) => {
      if (!this.ui || this.controlPhase !== 'timing') return;
      const elapsed = time - this.meterStartedAt;
      const pos = (Math.sin(elapsed / this.meterSpeedDivisor - Math.PI / 2) + 1) / 2;
      this.meterPosition = pos;
      const needle = this.ui.querySelector<HTMLElement>('#combined-needle');
      const readout = this.ui.querySelector<HTMLElement>('#combined-readout');
      if (needle) needle.style.left = `${pos * 100}%`;
      if (readout) readout.textContent = meterLabel(pos);
      this.meterFrame = requestAnimationFrame(animate);
    };
    this.meterFrame = requestAnimationFrame(animate);
  }

  private runShotClock(turnEndsAt: number | null, game: BowlerScorecard | undefined, standingBefore: number): void {
    this.stopShotClock();
    if (!turnEndsAt || !game) return;
    const update = () => {
      if (!this.ui || this.controlPhase === 'bowling') return;
      const clock = this.ui.querySelector<HTMLElement>('#shot-clock');
      if (!clock) return;
      const remainingMs = Math.max(0, turnEndsAt - Date.now());
      const seconds = Math.ceil(remainingMs / 1000);
      clock.textContent = remainingMs > 0 ? `${seconds}s` : 'TIME!';
      clock.classList.toggle('urgent', seconds <= 5);

      // Beat the authoritative server deadline by a small network margin so the
      // player sees a real auto-delivery instead of a hidden 0-pin timeout.
      if (remainingMs <= 450 && !this.timeoutAutoFired) {
        this.timeoutAutoFired = true;
        if (this.controlPhase === 'ready') {
          this.power = MIN_TIMEOUT_POWER;
          this.releaseTiming = Math.random() < 0.5 ? -1 : 1;
          this.releaseInGreen = false;
          this.meterPosition = 0;
          this.beginPhysicalShot(game, standingBefore, true);
          return;
        }
        if (this.controlPhase === 'timing') {
          this.prepareMeterShot();
          this.beginPhysicalShot(game, standingBefore, false);
          return;
        }
      }

      if (remainingMs > 0) this.shotClockFrame = requestAnimationFrame(update);
    };
    update();
  }

  private runMathClock(mathEndsAt: number | null): void {
    this.stopMathClock();
    if (!mathEndsAt) return;
    const update = () => {
      if (!this.ui) return;
      const clock = this.ui.querySelector<HTMLElement>('#math-clock');
      const bar = this.ui.querySelector<HTMLElement>('#math-clock-bar');
      if (!clock) return;
      const remainingMs = Math.max(0, mathEndsAt - Date.now());
      const seconds = Math.ceil(remainingMs / 1000);
      clock.textContent = remainingMs > 0 ? `${seconds}s` : 'TIME!';
      clock.classList.toggle('urgent', seconds <= 5);
      if (bar) {
        const totalMs = appState.room?.level === 2 ? 20000 : 30000;
        const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
        bar.style.transform = `scaleX(${ratio})`;
        bar.classList.toggle('urgent', seconds <= 5);
      }
      if (remainingMs > 0) this.mathClockFrame = requestAnimationFrame(update);
    };
    update();
  }

  private stopMathClock(): void {
    cancelAnimationFrame(this.mathClockFrame);
    this.mathClockFrame = 0;
  }

  private stopShotClock(): void {
    cancelAnimationFrame(this.shotClockFrame);
    this.shotClockFrame = 0;
  }

  private runReconnectClock(reconnectEndsAt: number): void {
    this.stopReconnectClock();
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

  private stopReconnectClock(): void {
    cancelAnimationFrame(this.reconnectClockFrame);
    this.reconnectClockFrame = 0;
  }

  private stopMeter(): void {
    cancelAnimationFrame(this.meterFrame);
    this.meterFrame = 0;
  }

  private async performShot(game: BowlerScorecard, standingBefore: number, shotConfig: BowlingShotConfig): Promise<void> {
    if (!this.simulator || !this.ui) return;
    const shotRenderToken = this.renderToken;
    let impactPromise: Promise<void> | null = null;
    let celebrationShown = false;
    const anticipatedCelebration = clearedRackCelebration(game, standingBefore);
    const playImpactAtRack = () => {
      if (!impactPromise) impactPromise = audioDirector.playPinImpact();
    };
    const showCelebrationAtRackClear = () => {
      if (celebrationShown || !anticipatedCelebration || !this.scene.isActive() || !this.ui) return;
      celebrationShown = true;
      this.showBowlingCelebration(anticipatedCelebration);
      if (anticipatedCelebration.kind === 'strike') audioDirector.playCheer();
    };

    let result: BowlingShotResult;
    try {
      result = await this.simulator.bowl({
        ...shotConfig,
        onLoudPinImpact: playImpactAtRack,
        onRackCleared: showCelebrationAtRackClear
      });
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : 'The bowling shot could not be completed.');
      return;
    }
    if (!this.scene.isActive() || !this.ui || shotRenderToken !== this.renderToken) return;

    const speed = this.ui.querySelector<HTMLElement>('#sim-speed');
    const note = this.ui.querySelector<HTMLElement>('#sim-shot-note');
    if (speed) speed.textContent = `BALL SPEED ${result.speedKmh.toFixed(1)} KM/H`;
    if (note) note.textContent = shotResultLabel(result, standingBefore);

    const celebration = shotCelebration(game, result, standingBefore);
    const loudPinHit = !result.gutter && result.knockedPins.length > 2;

    // The crash sound starts while pins are falling. This fallback covers an
    // unusual frame skip where the physics callback did not fire.
    if (loudPinHit && !impactPromise) playImpactAtRack();

    // Normally the celebration has already fired at the exact instant the last
    // required pin fell. Keep a result-time fallback for unusual devices only.
    if (celebration && !celebrationShown) {
      celebrationShown = true;
      this.showBowlingCelebration(celebration);
      if (celebration.kind === 'strike') audioDirector.playCheer();
    }

    // Special bowling achievements get a little more screen time; ordinary
    // deliveries still advance quickly so the class pace stays high.
    await wait(celebration ? 1350 : 520);
    if (!this.scene.isActive() || shotRenderToken !== this.renderToken) return;
    network.rollBall(result.knockedPins, result.speedKmh, result.gutter);
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

  private runSpectatorShotClock(turnEndsAt: number | null): void {
    this.stopShotClock();
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

  private runSpectatorMathClock(mathEndsAt: number | null, level: 1 | 2 | 3): void {
    this.stopMathClock();
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
        const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
        bar.style.transform = `scaleX(${ratio})`;
        bar.classList.toggle('urgent', seconds <= 5);
      }
      if (remainingMs > 0) this.mathClockFrame = requestAnimationFrame(update);
    };
    update();
  }

  private async playSpectatorShot(shot: SpectatorShot): Promise<void> {
    const state = appState.tournament;
    if (!this.scene.isActive() || !this.ui || !state || shot.playerId === appState.playerId) return;
    const match = findMyMatch(state);
    if (!match || match.id !== shot.matchId) return;
    const opponent = match.playerA.id === appState.playerId ? match.playerB : match.playerA;
    if (!opponent || opponent.id !== shot.playerId || !this.simulator) return;

    this.stopShotClock();
    this.spectatorPlayerId = shot.playerId;
    this.spectatorStandingBefore = shot.standingPins.length;
    this.simulator.setSetupVisible(false);
    this.simulator.setStandingPins(shot.standingPins);

    const note = this.ui.querySelector<HTMLElement>('#sim-shot-note');
    const speed = this.ui.querySelector<HTMLElement>('#sim-speed');
    const status = this.ui.querySelector<HTMLElement>('#spectator-live-status');
    if (note) note.textContent = `LIVE — ${opponent.name.toUpperCase()} BOWLING`;
    if (speed) speed.textContent = 'BALL IN MOTION…';
    if (status) status.textContent = `${opponent.name} has released the ball — watch the exact live attempt.`;

    let spectatorImpactPromise: Promise<void> | null = null;
    let spectatorCelebrationShown = false;
    const opponentGameAtRelease = match.games.find((game) => game.playerId === shot.playerId);
    const anticipatedCelebration = opponentGameAtRelease
      ? clearedRackCelebration(opponentGameAtRelease, this.spectatorStandingBefore)
      : null;
    const playSpectatorImpactAtRack = () => {
      if (!spectatorImpactPromise) spectatorImpactPromise = audioDirector.playPinImpact();
    };
    const showSpectatorCelebrationAtRackClear = () => {
      if (spectatorCelebrationShown || !anticipatedCelebration || !this.scene.isActive() || !this.ui || this.spectatorPlayerId !== shot.playerId) return;
      spectatorCelebrationShown = true;
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
        onLoudPinImpact: playSpectatorImpactAtRack,
        onRackCleared: showSpectatorCelebrationAtRackClear
      });
    } catch {
      return;
    }
    if (!this.scene.isActive() || !this.ui || this.spectatorPlayerId !== shot.playerId) return;

    if (speed) speed.textContent = `BALL SPEED ${result.speedKmh.toFixed(1)} KM/H`;
    if (note) note.textContent = shotResultLabel(result, this.spectatorStandingBefore);
    if (status) status.textContent = shotResultLabel(result, this.spectatorStandingBefore);

    const latestState = appState.tournament;
    const latestMatch = latestState ? findMyMatch(latestState) : undefined;
    const opponentGame = latestMatch?.games.find((game) => game.playerId === shot.playerId);
    const celebration = opponentGame ? shotCelebration(opponentGame, result, this.spectatorStandingBefore) : null;
    const loudPinHit = !result.gutter && result.knockedPins.length > 2;
    if (loudPinHit && !spectatorImpactPromise) playSpectatorImpactAtRack();
    if (celebration && !spectatorCelebrationShown) {
      spectatorCelebrationShown = true;
      this.showBowlingCelebration(celebration);
      if (celebration.kind === 'strike') audioDirector.playCheer();
    }
  }

  private handleSpectatorShotResult(result: SpectatorShotResult): void {
    if (!this.scene.isActive() || !this.ui || result.playerId !== this.spectatorPlayerId) return;
    const state = appState.tournament;
    const match = state ? findMyMatch(state) : undefined;
    if (!match || match.id !== result.matchId) return;
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

  private goToMatchResult(): void {
    if (!this.scene.isActive()) return;
    this.movingToResult = true;
    window.clearTimeout(this.resultTimer);
    this.resultTimer = 0;
    this.scene.start('MatchResultScene');
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

function renderPlayerShotControls(aim: number, hook: number): string {
  return `<div class="bowling-control-grid">
      <label class="sim-slider-control">
        <span><strong>1. AIM TARGET</strong><em id="aim-label">${aimLabel(aim)}</em></span>
        <input id="aim-slider" type="range" min="-100" max="100" value="${Math.round(aim * 100)}" aria-label="Straight bowling aim target" />
        <small><b>LEFT</b><b>HEAD PIN</b><b>RIGHT</b></small>
      </label>
      <label class="sim-slider-control">
        <span><strong>2. HOOK</strong><em id="hook-label">${hookLabel(hook)}</em></span>
        <input id="hook-slider" type="range" min="-100" max="100" value="${Math.round(hook * 100)}" aria-label="Bowling hook" />
        <small><b>LEFT</b><b>STRAIGHT</b><b>RIGHT</b></small>
      </label>
    </div>
    <div class="shot-meter-stack combined-shot-meter-stack">
      <div class="shot-meter-row combined-shot-meter-row">
        <span>POWER / RELEASE</span>
        <div class="shot-meter combined-release-meter"><div class="combined-perfect-zone"></div><i id="combined-needle" class="meter-needle" style="left:0%"></i></div>
        <strong id="combined-readout">READY</strong>
      </div>
    </div>
    <button id="shot-btn" class="primary-btn bowl-btn simulator-shot-btn" type="button">🎳 START APPROACH</button>
    <div id="sim-help" class="sim-help">Drag the ball left or right to choose where to stand. Then set a straight aim target and add hook. Press START APPROACH, then release in the small green zone. The meter changes speed every bowl.</div>`;
}

function renderReconnectPanel(name: string): string {
  return `<div class="disconnect-reconnect-panel" role="status" aria-live="polite">
    <div class="disconnect-reconnect-icon">📡</div>
    <div class="disconnect-reconnect-copy">
      <strong>${escapeHtml(name)} disconnected — waiting for reconnection…</strong>
      <span>The match is paused. If they do not return within 20 seconds, they forfeit this match.</span>
    </div>
    <div class="disconnect-reconnect-countdown"><strong id="disconnect-reconnect-clock">20</strong><small>SECONDS</small></div>
  </div>`;
}

function renderSpectatorTurnPanel(
  opponent: PlayerSummary | null,
  opponentGame: BowlerScorecard | null | undefined,
  match: LaneMatchState,
  level: 1 | 2 | 3,
  opponentMathFrame: number | undefined
): string {
  if (match.complete) {
    return `<div class="spectator-turn-panel quiet"><strong>MATCH COMPLETE</strong><span>Final scores are being prepared.</span></div>`;
  }
  if (!opponent) {
    return `<div class="spectator-turn-panel quiet"><strong>NO OPPONENT</strong><span>This lane has a bye.</span></div>`;
  }
  if (opponentMathFrame !== undefined && opponentGame) {
    const attempts = opponentGame.mathAttempts.length
      ? opponentGame.mathAttempts.map((attempt, index) => `<span class="spectator-attempt-chip"><b>${index + 1}</b>${attempt}<em>✕</em></span>`).join('')
      : '<span class="spectator-no-attempts">No answer submitted yet</span>';
    return `<div class="spectator-math-panel">
      <div class="spectator-live-header"><span class="live-dot">LIVE</span><strong>${escapeHtml(opponent.name)} is calculating</strong></div>
      <div class="spectator-math-title">LEVEL ${level} SCORE CHECK • FRAME ${opponentMathFrame + 1}</div>
      <div class="spectator-math-clock-row"><span>TIME REMAINING</span><strong id="spectator-math-clock">${level === 2 ? '20s' : '30s'}</strong></div>
      <div class="spectator-math-clock-track"><i id="spectator-math-clock-bar"></i></div>
      <div class="spectator-attempts"><span>ATTEMPTS</span><div>${attempts}</div></div>
      <small>Their calculation is private. You can see submitted attempts and the exact timer so you know when play can continue.</small>
    </div>`;
  }
  if (match.currentPlayerId === opponent.id && !opponentGame?.complete) {
    return `<div class="spectator-turn-panel live">
      <div class="spectator-live-header"><span class="live-dot">LIVE</span><strong>${escapeHtml(opponent.name)}'s bowling attempt</strong></div>
      <div id="spectator-live-status" class="spectator-live-status">They are setting up the shot. Aim, hook and release controls stay private.</div>
      <div class="spectator-shot-clock-row"><span>SHOT CLOCK</span><strong id="spectator-shot-clock">15s</strong></div>
      <small>As soon as the ball is released, this lane will replay the exact live trajectory and pin action.</small>
    </div>`;
  }
  return `<div class="spectator-turn-panel quiet"><strong>WAITING</strong><span>Your controls will appear automatically when your turn begins.</span></div>`;
}

function findMyMatch(state: TournamentState): LaneMatchState | undefined {
  return state.matches.find((match) => match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId);
}

function myMatchFingerprint(state: TournamentState): string {
  const match = findMyMatch(state);
  if (!match) return '';
  const myGame = match.games.find((game) => game.playerId === appState.playerId);
  const opponentGame = match.games.find((game) => game.playerId !== appState.playerId);
  // Opponent score-verification updates should not reset a bowler who is in the
  // middle of setting up a shot. Opponent rolls still change frames/current turn
  // and therefore still trigger a render.
  return JSON.stringify({
    id: match.id,
    currentPlayerId: match.currentPlayerId,
    complete: match.complete,
    winnerId: match.winnerId,
    turnEndsAt: match.turnEndsAt,
    disconnectedPlayerId: match.disconnectedPlayerId,
    reconnectEndsAt: match.reconnectEndsAt,
    forfeitPlayerId: match.forfeitPlayerId,
    myGame,
    opponentFrames: opponentGame?.frames,
    opponentCurrentFrame: opponentGame?.currentFrame,
    opponentComplete: opponentGame?.complete,
    opponentStandingPins: opponentGame?.standingPins,
    opponentPendingMathFrames: opponentGame?.pendingMathFrames,
    opponentMathEndsAt: opponentGame?.mathEndsAt,
    opponentMathAttempts: opponentGame?.mathAttempts,
    opponentPenaltyPercent: opponentGame?.penaltyPercent
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
    1: ['STRIKE!', 'Pocket power'],
    2: ['DOUBLE!', 'Two strikes in a row'],
    3: ['TURKEY!', 'Three strikes in a row'],
    4: ['HAMBONE!', 'Four strikes in a row'],
    5: ['FIVE-BAGGER!', 'Five strikes in a row'],
    6: ['SIX-PACK!', 'Six strikes in a row'],
    7: [frontSeven ? 'FRONT SEVEN!' : 'SEVEN-BAGGER!', 'Seven strikes in a row'],
    8: ['EIGHT-BAGGER!', 'Eight strikes in a row'],
    9: ['GOLDEN TURKEY!', 'Nine strikes in a row'],
    10: ['TEN-BAGGER!', 'Ten strikes in a row'],
    11: ['ELEVEN-BAGGER!', 'Eleven strikes in a row'],
    12: ['PERFECT 300!', 'Twelve strikes • perfect game']
  };
  const [title, subtitle] = names[Math.min(12, streak)] ?? [`${streak}-BAGGER!`, `${streak} strikes in a row`];
  const graphic = streak === 3 ? '🦃' : streak === 4 ? '🍖 🎳' : streak === 9 ? '✨ 🦃 ✨' : streak >= 12 ? '🏆 300 🏆' : '💥 🎳 💥';
  return { kind: 'strike', title, subtitle, graphic };
}

function flattenedRolls(frames: number[][]): number[] {
  return frames.flatMap((frame) => frame);
}

function trailingStrikeCount(frames: number[][]): number {
  const rolls = flattenedRolls(frames);
  let count = 0;
  for (let i = rolls.length - 1; i >= 0 && rolls[i] === 10; i--) count++;
  return count;
}

function renderMathOverlay(level: 1 | 2 | 3, game: BowlerScorecard, frameIndex: number): string {
  const frameNumber = frameIndex + 1;
  const previousTotal = frameIndex === 0 ? 0 : (game.cumulative[frameIndex - 1] ?? 0);
  const frameScore = game.frameScores[frameIndex] ?? 0;
  const guided = level === 2;

  return `<div class="math-overlay${guided ? '' : ' math-overlay-independent'}">
    <section class="math-card panel${guided ? '' : ' math-card-independent'}" role="dialog" aria-modal="true" aria-labelledby="math-title">
      <div class="math-kicker">LEVEL ${level} • ${guided ? 'GUIDED SCORING' : 'INDEPENDENT SCORING'}</div>
      <h2 id="math-title">Frame ${frameNumber} score check</h2>
      <div class="math-timer-panel">
        <div class="math-timer-row"><span>CALCULATION TIME</span><strong id="math-clock">${level === 2 ? '20s' : '30s'}</strong></div>
        <div class="math-timer-track"><i id="math-clock-bar"></i></div>
        ${game.penaltyPercent > 0 ? `<small>${game.mathTimeouts} timeout${game.mathTimeouts === 1 ? '' : 's'} so far • ${game.penaltyPercent}% final-score penalty</small>` : '<small>Wrong answers can be retried until time runs out.</small>'}
      </div>
      ${guided ? `<div class="math-teach-box">${guidedFrameExplanation(game, frameIndex, frameScore)}</div>
        <div class="math-score-facts"><span><small>PREVIOUS TOTAL</small><strong>${previousTotal}</strong></span><span><small>FRAME SCORE</small><strong>${frameScore}</strong></span></div>
        <div class="math-equation"><b>${previousTotal}</b><span>+</span><b>${frameScore}</b><span>=</span><strong>?</strong></div>`
        : `<div class="math-independent-copy">This frame can now be scored. Use the scorecard below and normal ten-pin bowling rules to work out your <strong>new cumulative total</strong>.</div>
          ${renderMathScorecard(game, frameIndex)}`}
      <div id="math-answer" class="math-answer" aria-live="polite">—</div>
      <div class="math-keypad" aria-label="Score keypad">
        ${[1,2,3,4,5,6,7,8,9].map((digit) => `<button type="button" data-math-digit="${digit}">${digit}</button>`).join('')}
        <button id="math-clear" class="math-key-secondary" type="button">CLEAR</button>
        <button type="button" data-math-digit="0">0</button>
        <button id="math-backspace" class="math-key-secondary" type="button" aria-label="Backspace">⌫</button>
      </div>
      <button id="math-submit" class="primary-btn math-submit" type="button" disabled>CHECK SCORE</button>
      <div id="math-feedback" class="math-feedback" aria-live="polite"></div>
      <div class="math-no-keyboard">Tap the keypad buttons — keyboard entry is disabled.</div>
    </section>
  </div>`;
}

function renderMathScorecard(game: BowlerScorecard, focusFrame: number): string {
  return `<div class="math-scorecard-shell">
    <div class="math-scorecard-title"><span>YOUR SCORECARD</span><strong>Frame ${focusFrame + 1}</strong></div>
    <div class="math-scorecard-mini">
      ${game.frames.map((rolls, index) => {
        const tenth = index === 9;
        const rollText = tenth
          ? [0, 1, 2].map((rollIndex) => formatRollSymbol(rolls, rollIndex, true) || '·').join(' ')
          : rolls[0] === 10 ? 'X' : [0, 1].map((rollIndex) => formatRollSymbol(rolls, rollIndex, false) || '·').join(' ');
        return `<div class="math-mini-frame${index === focusFrame ? ' focus' : ''}">
          <span>${index + 1}</span><b>${rollText}</b><em>${game.cumulative[index] ?? '—'}</em>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderReturnLobbyConfirm(): string {
  return `<div id="return-lobby-confirm" class="return-lobby-overlay">
    <section class="return-lobby-card panel" role="dialog" aria-modal="true" aria-labelledby="return-lobby-title">
      <div class="return-lobby-icon">⚠️</div>
      <h2 id="return-lobby-title">Return everyone to the lobby?</h2>
      <p>This will <strong>cancel every bowling game currently in progress</strong>, clear the live lane results and wins leaderboard, and return all connected players to the lobby.</p>
      <div class="return-lobby-actions">
        <button id="return-lobby-no" class="secondary-btn" type="button">NO — KEEP PLAYING</button>
        <button id="return-lobby-yes" class="danger-btn" type="button">YES — RETURN TO LOBBY</button>
      </div>
    </section>
  </div>`;
}

function guidedFrameExplanation(game: BowlerScorecard, frameIndex: number, frameScore: number): string {
  const rolls = game.frames[frameIndex] ?? [];
  if (frameIndex === 9) {
    const shown = rolls.map((roll) => roll === 10 ? '10' : String(roll)).join(' + ');
    return `<strong>10th frame:</strong> add every ball earned in the frame. <b>${shown || '0'} = ${frameScore}</b>.`;
  }
  if (rolls[0] === 10) {
    const bonus = futureRollsForMath(game.frames, frameIndex, 2);
    return `<strong>Strike:</strong> 10 plus the next two balls. <b>10 + ${bonus[0] ?? '?'} + ${bonus[1] ?? '?'} = ${frameScore}</b>.`;
  }
  if ((rolls[0] ?? 0) + (rolls[1] ?? 0) === 10) {
    const bonus = futureRollsForMath(game.frames, frameIndex, 1);
    return `<strong>Spare:</strong> 10 plus the next ball. <b>10 + ${bonus[0] ?? '?'} = ${frameScore}</b>.`;
  }
  return `<strong>Open frame:</strong> add the pins from the two balls. <b>${rolls[0] ?? 0} + ${rolls[1] ?? 0} = ${frameScore}</b>.`;
}

function futureRollsForMath(frames: number[][], frameIndex: number, count: number): number[] {
  const out: number[] = [];
  for (let i = frameIndex + 1; i < frames.length && out.length < count; i++) {
    for (const roll of frames[i]) {
      out.push(roll);
      if (out.length >= count) break;
    }
  }
  return out;
}

function renderPlayerHeader(name: string, id: string, turnId: string | null, winnerId: string | null): string {
  return `<div class="score-player${turnId === id ? ' active' : ''}${winnerId === id ? ' winner' : ''}"><span>${winnerId === id ? '🏆 ' : ''}${escapeHtml(name)}</span><span>${turnId === id ? 'BOWLING' : ''}</span></div>`;
}

function renderScorecard(game?: BowlerScorecard): string {
  if (!game) return '';
  return `<div class="scorecard">${game.frames.map((rolls, index) => {
    const tenth = index === 9;
    return `<div class="frame-box${tenth ? ' tenth' : ''}${game.currentFrame === index + 1 && !game.complete ? ' current' : ''}">
      <div class="frame-num">${index + 1}</div>
      <div class="frame-rolls">${renderRollCells(rolls, tenth)}</div>
      <div class="frame-total">${game.cumulative[index] ?? ''}</div>
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
  if (game.complete && game.pendingMathFrames.length) return 'All 10 frames are complete • finish the score checks to lock in your total.';
  if (game.complete) return `Your 10-frame game is complete — score ${game.total ?? 0}.`;
  return `Frame ${game.currentFrame} of 10 • ${game.standingPins?.length ?? 10} pin${(game.standingPins?.length ?? 10) === 1 ? '' : 's'} standing`;
}

function fallbackStandingPins(game?: BowlerScorecard): number[] {
  if (!game) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const frame = game.frames[Math.min(9, game.currentFrame - 1)] ?? [];
  let standing = 10;
  if (game.currentFrame < 10 && frame.length === 1 && frame[0] !== 10) standing = 10 - frame[0];
  return Array.from({ length: standing }, (_, index) => index);
}

function aimLabel(value: number): string {
  if (Math.abs(value) < 0.04) return 'HEAD PIN';
  const boards = Math.max(1, Math.round(Math.abs(value) * 12));
  return `${boards} BOARD${boards === 1 ? '' : 'S'} ${value < 0 ? 'LEFT' : 'RIGHT'}`;
}

function hookLabel(value: number): string {
  if (Math.abs(value) < 0.08) return 'STRAIGHT';
  const strength = Math.round(Math.abs(value) * 100);
  return `${strength}% ${value < 0 ? 'LEFT' : 'RIGHT'}`;
}

function meterLabel(position: number): string {
  const percent = Math.round(position * 100);
  if (position >= METER_GREEN_START && position <= METER_GREEN_END) return `${percent}% • PERFECT`;
  if (position < METER_GREEN_START) return `${percent}% • EARLY`;
  return `${percent}% • LATE`;
}

function shotResultLabel(result: BowlingShotResult, standingBefore: number): string {
  if (result.gutter && result.knockedPins.length === 0) return 'GUTTER BALL';
  if (standingBefore === 10 && result.knockedPins.length === 10) return '💥 STRIKE!';
  if (standingBefore < 10 && result.knockedPins.length === standingBefore) return '✨ SPARE!';
  if (result.knockedPins.length === 0) return 'MISS — 0 PINS';
  return `${result.knockedPins.length} PIN${result.knockedPins.length === 1 ? '' : 'S'} DOWN`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}
