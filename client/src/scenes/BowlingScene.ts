// @ts-nocheck
import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { appState } from '../state';
import { network } from '../net/NetworkManager';
import { audioDirector } from '../audio/AudioDirector';
import { BowlingSimulator } from '../game/BowlingSimulator';
const METER_GREEN_START = 0.73;
const METER_GREEN_END = 0.79;
const METER_OPTIMAL = (METER_GREEN_START + METER_GREEN_END) / 2;
const MIN_TIMEOUT_POWER = 0.12;
export class BowlingScene extends BaseBowlingScene {
    cleanup = [];
    ui;
    movingToResult = false;
    resultTimer = 0;
    simulator;
    meterFrame = 0;
    shotClockFrame = 0;
    mathClockFrame = 0;
    reconnectClockFrame = 0;
    meterStartedAt = 0;
    meterPosition = 0;
    meterSpeedDivisor = 360;
    releaseInGreen = false;
    timeoutAutoFired = false;
    controlPhase = 'ready';
    startPosition = 0;
    aim = 0;
    hook = 0;
    power = 0.68;
    releaseTiming = 0;
    lastMatchFingerprint = '';
    mathEntry = '';
    mathFeedback = '';
    activeMathFrame = null;
    spectatorPlayerId = null;
    spectatorStandingBefore = 10;
    spectatorGameAtRelease;
    spectatorBowlOff = false;
    renderToken = 0;
    activeShotId = null;
    activeShotMatchId = null;
    activeShotProgressKey = '';
    constructor() { super('BowlingScene'); }
    create() {
        this.setupBaseScene();
        this.movingToResult = false;
        window.clearTimeout(this.resultTimer);
        this.resultTimer = 0;
        this.lastMatchFingerprint = '';
        this.activeMathFrame = null;
        this.spectatorBowlOff = false;
        this.clearActiveShotTracking();
        this.stopMeter();
        this.stopShotClock();
        this.stopMathClock();
        this.stopReconnectClock();
        this.simulator?.destroy();
        this.simulator = undefined;
        if (!appState.tournament)
            return void this.scene.start('MatchupScene');
        this.ui = createSceneUi();
        this.render(appState.tournament);
        this.cleanup.push(network.on('bowlingState', (state) => {
            const nextFingerprint = myMatchFingerprint(state);
            const nextMatch = findMyMatch(state);
            const nextGame = nextMatch?.games.find((game) => game.playerId === appState.playerId);
            const localShotInFlight = Boolean(this.activeShotId
                && this.activeShotMatchId
                && nextMatch?.id === this.activeShotMatchId
                && !nextMatch.complete
                && !nextMatch.disconnectedPlayerId
                && shotProgressKey(nextMatch, nextGame) === this.activeShotProgressKey);
            appState.room = state.room;
            appState.tournament = state;
            appState.matchups = state.matches;
            // The server broadcasts every lane's score changes to everyone. While our
            // own ball is travelling/settling, an unrelated lane update must NEVER
            // destroy this simulator. The old behaviour abandoned the Promise, so the
            // result never reached the server and was later scored as a random zero.
            if (localShotInFlight) {
                this.lastMatchFingerprint = nextFingerprint;
                return;
            }
            if (this.activeShotId)
                this.clearActiveShotTracking();
            // Other lanes can generate frequent state broadcasts. Do not destroy a
            // student's aim/power/release controls when their own lane did not change.
            if (nextFingerprint !== this.lastMatchFingerprint)
                this.render(state);
        }), network.on('roomState', (room) => {
            if (room.status !== 'lobby')
                return;
            appState.room = room;
            appState.matchups = [];
            appState.matchupEndsAt = 0;
            appState.tournament = null;
            appState.roundResult = null;
            this.scene.start('LobbyScene');
        }), network.on('roundComplete', (result) => {
            appState.room = result.room;
            appState.roundResult = result;
            appState.tournament = result;
            this.goToMatchResult();
        }), network.on('matchStarted', (message) => {
            appState.room = message.room;
            appState.matchups = message.matchups;
            appState.matchupEndsAt = message.phaseEndsAt;
            appState.roundResult = null;
            this.scene.start('MatchupScene');
        }), network.on('finalResults', (results) => {
            appState.room = results.room;
            appState.finalResults = results;
            this.scene.start('FinalResultsScene');
        }), network.on('scoreFeedback', (feedback) => this.handleScoreFeedback(feedback.correct, feedback.message)), network.on('spectatorShot', (shot) => void this.playSpectatorShot(shot)), network.on('spectatorShotResult', (result) => this.handleSpectatorShotResult(result)), network.on('close', () => this.showToast('Connection lost — trying to rejoin your match for up to 20 seconds…')), network.on('error', ({ code, message }) => {
            if (code === 'SHOT_RESULT_RETRY')
                this.clearActiveShotTracking();
            this.showToast(message);
        }));
        this.events.once('shutdown', () => {
            window.clearTimeout(this.resultTimer);
            this.resultTimer = 0;
            this.stopMeter();
            this.stopShotClock();
            this.stopMathClock();
            this.stopReconnectClock();
            this.clearActiveShotTracking();
            this.simulator?.destroy();
            this.simulator = undefined;
            this.cleanup.splice(0).forEach((fn) => fn());
        });
    }
    render(state) {
        if (!this.ui)
            return;
        const match = findMyMatch(state);
        if (!match)
            return;
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
        const standingPins = match.bowlOffActive
            ? fullRackPins()
            : displayedGame?.standingPins ?? fallbackStandingPins(displayedGame ?? myGame);
        const spectatorPanel = lanePaused
            ? renderReconnectPanel(disconnectedName)
            : myTurn
                ? renderPlayerShotControls(this.aim, this.hook, state.room.level, match.bowlOffActive)
                : renderSpectatorTurnPanel(opponent, opponentGame, match, state.room.level, opponentMathFrame);
        this.ui.innerHTML = `
      <div class="bowling-shell interactive realistic-bowling-shell${match.bowlOffActive ? ' bowl-off-shell' : ''}">
        <header class="bowling-top panel">
          <div><div class="bowling-lane-title">${match.championship ? '👑 Championship Lane' : `Lane ${match.lane}`}${match.bowlOffActive ? '<span class="bowl-off-live-pill">🔥 BOWL-OFF</span>' : ''}</div></div>
          <div class="bowling-meta"><span>LEVEL ${state.room.level}</span>${isHost ? '<button id="host-matchups" class="host-nav-btn" type="button">CLASS MATCHUPS</button><button id="host-lobby" class="host-nav-btn return-lobby-trigger" type="button">↩ LOBBY</button>' : ''}</div>
        </header>
        <main class="bowling-main realistic-bowling-main">
          <section class="score-panel panel">
            ${match.bowlOffActive ? renderBowlOffBoard(match) : ''}
            ${renderPlayerHeader(match.playerA.name, match.playerA.id, match.currentPlayerId, match.winnerId)}
            ${renderScorecard(match.games.find((g) => g.playerId === match.playerA.id))}
            ${match.playerB ? `${renderPlayerHeader(match.playerB.name, match.playerB.id, match.currentPlayerId, match.winnerId)}${renderScorecard(match.games.find((g) => g.playerId === match.playerB.id))}` : '<div class="bye-card">🦃 BYE — you automatically win this lane match.</div>'}
          </section>
          <section class="lane-simulator panel realistic-simulator-panel">
            <div class="sim-stage">
              <canvas id="bowling-sim-canvas" class="bowling-sim-canvas${myTurn ? ' start-position-draggable' : ''}" aria-label="Perspective ten-pin bowling lane. Drag the ball left or right to choose your starting position."></canvas>
              <div class="sim-stage-hud">
                <span id="sim-speed">BALL SPEED — KM/H</span>
                <strong id="sim-shot-note">${lanePaused ? 'MATCH PAUSED • RECONNECTING' : match.bowlOffActive && myTurn ? `🔥 BOWL-OFF ROUND ${match.bowlOffRound} • SET YOUR SHOT` : match.bowlOffActive && watchingOpponent ? `🔥 BOWL-OFF • WATCHING ${escapeHtml(opponent?.name ?? 'OPPONENT')}` : myTurn ? 'DRAG BALL • SET LINE' : match.complete ? 'MATCH COMPLETE' : watchingOpponent ? `WATCHING ${escapeHtml(opponent?.name ?? 'OPPONENT')}` : 'WAITING'}</strong>
              </div>
            </div>
            <div class="turn-callout ${lanePaused ? 'disconnect-paused' : myTurn ? 'your-turn' : watchingOpponent ? 'spectating-turn' : ''}">
              <span>${match.complete ? 'MATCH COMPLETE' : lanePaused ? `${escapeHtml(disconnectedName)} DISCONNECTED — MATCH PAUSED` : match.bowlOffActive && myTurn ? `🔥 BOWL-OFF • YOUR TURN — ROUND ${match.bowlOffRound}` : match.bowlOffActive && watchingOpponent ? `🔥 BOWL-OFF • ${escapeHtml(opponent?.name ?? 'OPPONENT')} BOWLING — ROUND ${match.bowlOffRound}` : mathRequired && rawMyTurn ? 'SCORE CHECK REQUIRED' : opponentMathRequired ? `WAITING FOR ${escapeHtml(opponent?.name ?? 'OPPONENT')} TO FINISH MATHS` : myTurn ? `YOUR TURN — FRAME ${myGame?.currentFrame ?? 1}` : watchingOpponent ? `WATCHING ${escapeHtml(opponent?.name ?? 'OPPONENT')} — FRAME ${opponentGame?.currentFrame ?? 1}` : `WAITING FOR ${escapeHtml(opponent?.name ?? 'OPPONENT')}`}</span>
              ${myTurn ? '<strong id="shot-clock" class="shot-clock">15s</strong>' : ''}
            </div>
            <div class="frame-progress">${match.bowlOffActive ? bowlOffStatus(match) : myTurn || mathRequired ? (myGame ? frameStatus(myGame) : '') : (opponentGame ? `${escapeHtml(opponent?.name ?? 'Opponent')} • ${frameStatus(opponentGame)}` : '')}</div>
            ${spectatorPanel}
            ${!match.bowlOffActive && opponentGame?.complete && !myGame?.complete ? '<div class="opponent-finished-note">Opponent has finished their game.</div>' : ''}
          </section>
        </main>
      </div>
      ${!lanePaused && mathRequired && myGame && pendingMathFrame !== undefined ? renderMathOverlay(state.room.level, myGame, pendingMathFrame) : ''}`;
        const canvas = this.ui.querySelector('#bowling-sim-canvas');
        if (canvas) {
            this.simulator = new BowlingSimulator(canvas, standingPins);
            this.simulator.setSetupVisible(myTurn);
            if (myTurn) {
                this.simulator.setStartPosition(this.startPosition);
                this.simulator.setAim(this.aim);
                this.simulator.setHook(this.hook);
            }
        }
        const aimSlider = this.ui.querySelector('#aim-slider');
        const hookSlider = this.ui.querySelector('#hook-slider');
        if (canvas && myTurn && this.simulator) {
            let draggingStartBall = false;
            const moveStartBall = (event) => {
                if (!draggingStartBall || this.controlPhase !== 'ready' || !this.simulator)
                    return;
                event.preventDefault();
                this.startPosition = this.simulator.startPositionFromClientX(event.clientX);
                this.simulator.setStartPosition(this.startPosition);
            };
            const finishStartDrag = (event) => {
                if (!draggingStartBall)
                    return;
                draggingStartBall = false;
                if (canvas.hasPointerCapture(event.pointerId))
                    canvas.releasePointerCapture(event.pointerId);
            };
            canvas.addEventListener('pointerdown', (event) => {
                if (this.controlPhase !== 'ready' || !this.simulator?.isPointerOnStartBall(event.clientX, event.clientY))
                    return;
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
            const label = this.ui?.querySelector('#aim-label');
            if (label)
                label.textContent = aimLabel(this.aim);
        });
        hookSlider?.addEventListener('input', () => {
            this.hook = Number(hookSlider.value) / 100;
            this.simulator?.setHook(this.hook);
            const label = this.ui?.querySelector('#hook-label');
            if (label)
                label.textContent = hookLabel(this.hook);
        });
        this.ui.querySelector('#shot-btn')?.addEventListener('click', () => this.handleShotButton(myGame, standingPins.length));
        this.ui.querySelector('#host-matchups')?.addEventListener('click', () => this.scene.start('MatchupScene'));
        this.ui.querySelector('#host-lobby')?.addEventListener('click', () => this.openReturnLobbyConfirm());
        if (lanePaused && match.reconnectEndsAt) {
            this.runReconnectClock(match.reconnectEndsAt);
        }
        else if (mathRequired && pendingMathFrame !== undefined) {
            this.bindMathKeypad(pendingMathFrame);
            this.runMathClock(myGame?.mathEndsAt ?? null);
        }
        else if (watchingOpponent && opponentMathFrame !== undefined) {
            this.runSpectatorMathClock(opponentGame?.mathEndsAt ?? null, state.room.level);
        }
        else if (watchingOpponent) {
            this.runSpectatorShotClock(match.turnEndsAt);
        }
        if (myTurn)
            this.runShotClock(match.turnEndsAt, myGame, standingPins.length);
        if (match.complete && !this.movingToResult) {
            this.movingToResult = true;
            window.clearTimeout(this.resultTimer);
            this.resultTimer = window.setTimeout(() => this.goToMatchResult(), 250);
        }
    }
    openReturnLobbyConfirm() {
        if (!this.ui || this.ui.querySelector('#return-lobby-confirm'))
            return;
        this.ui.insertAdjacentHTML('beforeend', renderReturnLobbyConfirm());
        this.ui.querySelector('#return-lobby-no')?.addEventListener('click', () => {
            this.ui?.querySelector('#return-lobby-confirm')?.remove();
        });
        this.ui.querySelector('#return-lobby-yes')?.addEventListener('click', (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'RETURNING…';
            network.returnToLobby();
        });
    }
    bindMathKeypad(frameIndex) {
        if (!this.ui)
            return;
        const display = this.ui.querySelector('#math-answer');
        const submit = this.ui.querySelector('#math-submit');
        const feedback = this.ui.querySelector('#math-feedback');
        const refresh = () => {
            if (display)
                display.textContent = this.mathEntry || '—';
            if (submit)
                submit.disabled = this.mathEntry.length === 0;
            if (feedback)
                feedback.textContent = this.mathFeedback;
        };
        this.ui.querySelectorAll('[data-math-digit]').forEach((button) => {
            button.addEventListener('click', () => {
                if (this.mathEntry.length >= 3)
                    return;
                const digit = button.dataset.mathDigit ?? '';
                if (!/^\d$/.test(digit))
                    return;
                this.mathFeedback = '';
                this.mathEntry = this.mathEntry === '0' ? digit : `${this.mathEntry}${digit}`;
                refresh();
            });
        });
        this.ui.querySelector('#math-backspace')?.addEventListener('click', () => {
            this.mathFeedback = '';
            this.mathEntry = this.mathEntry.slice(0, -1);
            refresh();
        });
        this.ui.querySelector('#math-clear')?.addEventListener('click', () => {
            this.mathFeedback = '';
            this.mathEntry = '';
            refresh();
        });
        submit?.addEventListener('click', () => {
            if (!this.mathEntry)
                return;
            const total = Number(this.mathEntry);
            if (!Number.isInteger(total))
                return;
            submit.disabled = true;
            network.submitScore(frameIndex, total);
        });
        refresh();
    }
    handleScoreFeedback(correct, message) {
        if (!this.ui)
            return;
        if (correct) {
            this.mathFeedback = '';
            this.showToast('✅ Correct score!');
            return;
        }
        this.mathEntry = '';
        this.mathFeedback = message;
        const display = this.ui.querySelector('#math-answer');
        const feedback = this.ui.querySelector('#math-feedback');
        const submit = this.ui.querySelector('#math-submit');
        if (display) {
            display.textContent = '—';
            display.classList.remove('wrong');
            void display.offsetWidth;
            display.classList.add('wrong');
        }
        if (feedback)
            feedback.textContent = message;
        if (submit)
            submit.disabled = true;
    }
    handleShotButton(game, standingBefore) {
        if (!game || !this.ui || !this.simulator)
            return;
        const button = this.ui.querySelector('#shot-btn');
        const help = this.ui.querySelector('#sim-help');
        const aimSlider = this.ui.querySelector('#aim-slider');
        const hookSlider = this.ui.querySelector('#hook-slider');
        if (!button)
            return;
        if (this.controlPhase === 'ready') {
            this.controlPhase = 'timing';
            this.meterStartedAt = performance.now();
            // Random timing speed each delivery so students cannot memorise one rhythm.
            // Full left-right-left cycles vary from roughly 1.8 to 3.2 seconds.
            this.meterSpeedDivisor = 285 + Math.random() * 225;
            this.ui.querySelector('#bowling-sim-canvas')?.classList.remove('start-position-draggable');
            if (aimSlider)
                aimSlider.disabled = true;
            if (hookSlider)
                hookSlider.disabled = true;
            button.textContent = '🎳 RELEASE BALL';
            if (help)
                help.textContent = 'Release while the needle is inside the small green zone. Outside green changes both power and accuracy and cannot produce a strike.';
            this.runMeter();
            return;
        }
        if (this.controlPhase === 'timing') {
            this.prepareMeterShot();
            this.beginPhysicalShot(game, standingBefore, false);
        }
    }
    prepareMeterShot() {
        const position = Math.max(0, Math.min(1, this.meterPosition));
        // Meter position controls BOTH power and release accuracy. Around 76% is
        // the bowling sweet spot: strong enough for carry without losing accuracy.
        this.power = 0.22 + position * 0.78;
        this.releaseTiming = Math.max(-1, Math.min(1, (position - METER_OPTIMAL) / 0.30));
        this.releaseInGreen = position >= METER_GREEN_START && position <= METER_GREEN_END;
    }
    beginPhysicalShot(game, standingBefore, timedOutBeforeApproach) {
        if (!this.ui || this.controlPhase === 'bowling' || this.controlPhase === 'awaiting_result')
            return;
        const activeMatch = appState.tournament ? findMyMatch(appState.tournament) : undefined;
        const matchId = activeMatch?.id;
        if (!matchId || !activeMatch)
            return;
        this.controlPhase = 'bowling';
        this.stopMeter();
        this.stopShotClock();
        const shotId = createShotId();
        this.activeShotId = shotId;
        this.activeShotMatchId = matchId;
        this.activeShotProgressKey = shotProgressKey(activeMatch, game);
        const shotConfig = {
            startPosition: this.startPosition,
            aim: this.aim,
            hook: this.hook,
            power: this.power,
            releaseTiming: this.releaseTiming,
            releaseInGreen: this.releaseInGreen,
            seed: ((Math.random() * 0xffffffff) >>> 0) || 1
        };
        network.shotStarted(matchId, shotId, shotConfig);
        const button = this.ui.querySelector('#shot-btn');
        const help = this.ui.querySelector('#sim-help');
        const readout = this.ui.querySelector('#combined-readout');
        if (button) {
            button.disabled = true;
            button.textContent = '🎳 BALL IN MOTION…';
        }
        if (readout && timedOutBeforeApproach)
            readout.textContent = 'MIN POWER';
        if (help)
            help.textContent = timedOutBeforeApproach
                ? 'Time expired before the approach — minimum power auto-delivery.'
                : this.releaseInGreen
                    ? 'Great release — watch the pocket entry and pin carry.'
                    : 'Release missed the green zone — power and accuracy are affected.';
        void this.performShot(game, standingBefore, shotConfig, matchId, shotId);
    }
    runMeter() {
        cancelAnimationFrame(this.meterFrame);
        const animate = (time) => {
            if (!this.ui || this.controlPhase !== 'timing')
                return;
            const elapsed = time - this.meterStartedAt;
            const pos = (Math.sin(elapsed / this.meterSpeedDivisor - Math.PI / 2) + 1) / 2;
            this.meterPosition = pos;
            const needle = this.ui.querySelector('#combined-needle');
            const readout = this.ui.querySelector('#combined-readout');
            if (needle)
                needle.style.left = `${pos * 100}%`;
            if (readout)
                readout.textContent = meterLabel(pos);
            this.meterFrame = requestAnimationFrame(animate);
        };
        this.meterFrame = requestAnimationFrame(animate);
    }
    runShotClock(turnEndsAt, game, standingBefore) {
        this.stopShotClock();
        if (!turnEndsAt || !game)
            return;
        const update = () => {
            if (!this.ui || this.controlPhase === 'bowling' || this.controlPhase === 'awaiting_result')
                return;
            const clock = this.ui.querySelector('#shot-clock');
            if (!clock)
                return;
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
            if (remainingMs > 0)
                this.shotClockFrame = requestAnimationFrame(update);
        };
        update();
    }
    runMathClock(mathEndsAt) {
        this.stopMathClock();
        if (!mathEndsAt)
            return;
        const update = () => {
            if (!this.ui)
                return;
            const clock = this.ui.querySelector('#math-clock');
            const bar = this.ui.querySelector('#math-clock-bar');
            if (!clock)
                return;
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
            if (remainingMs > 0)
                this.mathClockFrame = requestAnimationFrame(update);
        };
        update();
    }
    stopMathClock() {
        cancelAnimationFrame(this.mathClockFrame);
        this.mathClockFrame = 0;
    }
    stopShotClock() {
        cancelAnimationFrame(this.shotClockFrame);
        this.shotClockFrame = 0;
    }
    runReconnectClock(reconnectEndsAt) {
        this.stopReconnectClock();
        const update = () => {
            if (!this.ui)
                return;
            const clock = this.ui.querySelector('#disconnect-reconnect-clock');
            if (!clock)
                return;
            const remainingMs = Math.max(0, reconnectEndsAt - Date.now());
            const seconds = Math.ceil(remainingMs / 1000);
            clock.textContent = remainingMs > 0 ? String(seconds) : '0';
            clock.classList.toggle('urgent', seconds <= 5);
            if (remainingMs > 0)
                this.reconnectClockFrame = requestAnimationFrame(update);
        };
        update();
    }
    stopReconnectClock() {
        cancelAnimationFrame(this.reconnectClockFrame);
        this.reconnectClockFrame = 0;
    }
    stopMeter() {
        cancelAnimationFrame(this.meterFrame);
        this.meterFrame = 0;
    }
    async performShot(game, standingBefore, shotConfig, matchId, shotId) {
        if (!this.simulator || !this.ui)
            return;
        const shotRenderToken = this.renderToken;
        const bowlOffDelivery = Boolean(appState.tournament?.matches.find((match) => match.id === matchId)?.bowlOffActive);
        let impactPromise = null;
        let celebrationShown = false;
        const anticipatedCelebration = bowlOffDelivery
            ? bowlOffCelebrationForCount(standingBefore)
            : clearedRackCelebration(game, standingBefore);
        const playImpactAtRack = () => {
            if (!impactPromise)
                impactPromise = audioDirector.playPinImpact();
        };
        const showCelebrationAtRackClear = () => {
            if (celebrationShown || !anticipatedCelebration || !this.scene.isActive() || !this.ui)
                return;
            celebrationShown = true;
            this.showBowlingCelebration(anticipatedCelebration);
            if (anticipatedCelebration.kind === 'strike')
                audioDirector.playCheer();
            else
                audioDirector.playSpare();
        };
        let result;
        try {
            result = await this.simulator.bowl({
                ...shotConfig,
                onLoudPinImpact: playImpactAtRack,
                onRackCleared: showCelebrationAtRackClear,
                onZeroPinMissAtDeck: () => audioDirector.playZeroPins()
            });
        }
        catch (error) {
            this.showToast(error instanceof Error ? error.message : 'The bowling shot could not be completed.');
            return;
        }
        if (!this.scene.isActive() || !this.ui || shotRenderToken !== this.renderToken)
            return;
        const speed = this.ui.querySelector('#sim-speed');
        const note = this.ui.querySelector('#sim-shot-note');
        if (speed)
            speed.textContent = `BALL SPEED ${result.speedKmh.toFixed(1)} KM/H`;
        if (note)
            note.textContent = bowlOffDelivery
                ? bowlOffShotResultLabel(result)
                : shotResultLabel(game, result, standingBefore);
        const celebration = bowlOffDelivery
            ? bowlOffCelebration(result)
            : shotCelebration(game, result, standingBefore);
        const loudPinHit = !result.gutter && result.knockedPins.length > 2;
        // The crash sound starts while pins are falling. This fallback covers an
        // unusual frame skip where the physics callback did not fire.
        if (loudPinHit && !impactPromise)
            playImpactAtRack();
        // Normally the celebration has already fired at the exact instant the last
        // required pin fell. Keep a result-time fallback for unusual devices only.
        if (celebration && !celebrationShown) {
            celebrationShown = true;
            this.showBowlingCelebration(celebration);
            if (celebration.kind === 'strike')
                audioDirector.playCheer();
            else
                audioDirector.playSpare();
        }
        // Special bowling achievements get a little more screen time; ordinary
        // deliveries still advance quickly so the class pace stays high.
        await wait(celebration ? 1350 : 520);
        if (!this.scene.isActive() || shotRenderToken !== this.renderToken || this.activeShotId !== shotId)
            return;
        this.controlPhase = 'awaiting_result';
        network.rollBall(matchId, shotId, result.knockedPins, result.speedKmh, result.gutter);
    }
    clearActiveShotTracking() {
        this.activeShotId = null;
        this.activeShotMatchId = null;
        this.activeShotProgressKey = '';
    }
    showBowlingCelebration(celebration) {
        if (!this.ui)
            return;
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
    runSpectatorShotClock(turnEndsAt) {
        this.stopShotClock();
        if (!turnEndsAt)
            return;
        const update = () => {
            if (!this.ui)
                return;
            const clock = this.ui.querySelector('#spectator-shot-clock');
            if (!clock)
                return;
            const remainingMs = Math.max(0, turnEndsAt - Date.now());
            const seconds = Math.ceil(remainingMs / 1000);
            clock.textContent = remainingMs > 0 ? `${seconds}s` : 'TIME!';
            clock.classList.toggle('urgent', seconds <= 5);
            if (remainingMs > 0)
                this.shotClockFrame = requestAnimationFrame(update);
        };
        update();
    }
    runSpectatorMathClock(mathEndsAt, level) {
        this.stopMathClock();
        if (!mathEndsAt)
            return;
        const totalMs = level === 2 ? 20000 : 30000;
        const update = () => {
            if (!this.ui)
                return;
            const clock = this.ui.querySelector('#spectator-math-clock');
            const bar = this.ui.querySelector('#spectator-math-clock-bar');
            if (!clock)
                return;
            const remainingMs = Math.max(0, mathEndsAt - Date.now());
            const seconds = Math.ceil(remainingMs / 1000);
            clock.textContent = remainingMs > 0 ? `${seconds}s` : 'TIME!';
            clock.classList.toggle('urgent', seconds <= 5);
            if (bar) {
                const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
                bar.style.transform = `scaleX(${ratio})`;
                bar.classList.toggle('urgent', seconds <= 5);
            }
            if (remainingMs > 0)
                this.mathClockFrame = requestAnimationFrame(update);
        };
        update();
    }
    async playSpectatorShot(shot) {
        const state = appState.tournament;
        if (!this.scene.isActive() || !this.ui || !state || shot.playerId === appState.playerId)
            return;
        const match = findMyMatch(state);
        if (!match || match.id !== shot.matchId)
            return;
        this.spectatorBowlOff = match.bowlOffActive;
        const opponent = match.playerA.id === appState.playerId ? match.playerB : match.playerA;
        if (!opponent || opponent.id !== shot.playerId || !this.simulator)
            return;
        this.stopShotClock();
        this.spectatorPlayerId = shot.playerId;
        this.spectatorStandingBefore = shot.standingPins.length;
        this.simulator.setSetupVisible(false);
        this.simulator.setStandingPins(shot.standingPins);
        const note = this.ui.querySelector('#sim-shot-note');
        const speed = this.ui.querySelector('#sim-speed');
        const status = this.ui.querySelector('#spectator-live-status');
        if (note)
            note.textContent = `LIVE — ${opponent.name.toUpperCase()} BOWLING`;
        if (speed)
            speed.textContent = 'BALL IN MOTION…';
        if (status)
            status.textContent = `${opponent.name} has released the ball — watch the exact live attempt.`;
        let spectatorImpactPromise = null;
        let spectatorCelebrationShown = false;
        const opponentGameAtRelease = match.games.find((game) => game.playerId === shot.playerId);
        this.spectatorGameAtRelease = opponentGameAtRelease;
        const anticipatedCelebration = this.spectatorBowlOff
            ? bowlOffCelebrationForCount(this.spectatorStandingBefore)
            : opponentGameAtRelease
                ? clearedRackCelebration(opponentGameAtRelease, this.spectatorStandingBefore)
                : null;
        const playSpectatorImpactAtRack = () => {
            if (!spectatorImpactPromise)
                spectatorImpactPromise = audioDirector.playPinImpact();
        };
        const showSpectatorCelebrationAtRackClear = () => {
            if (spectatorCelebrationShown || !anticipatedCelebration || !this.scene.isActive() || !this.ui || this.spectatorPlayerId !== shot.playerId)
                return;
            spectatorCelebrationShown = true;
            this.showBowlingCelebration(anticipatedCelebration);
            if (anticipatedCelebration.kind === 'strike')
                audioDirector.playCheer();
            else
                audioDirector.playSpare();
        };
        let result;
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
                onRackCleared: showSpectatorCelebrationAtRackClear,
                onZeroPinMissAtDeck: () => audioDirector.playZeroPins()
            });
        }
        catch {
            return;
        }
        if (!this.scene.isActive() || !this.ui || this.spectatorPlayerId !== shot.playerId)
            return;
        if (speed)
            speed.textContent = `BALL SPEED ${result.speedKmh.toFixed(1)} KM/H`;
        const resultLabel = this.spectatorBowlOff
            ? bowlOffShotResultLabel(result)
            : shotResultLabel(opponentGameAtRelease, result, this.spectatorStandingBefore);
        if (note)
            note.textContent = resultLabel;
        if (status)
            status.textContent = resultLabel;
        const celebration = this.spectatorBowlOff
            ? bowlOffCelebration(result)
            : opponentGameAtRelease ? shotCelebration(opponentGameAtRelease, result, this.spectatorStandingBefore) : null;
        const loudPinHit = !result.gutter && result.knockedPins.length > 2;
        if (loudPinHit && !spectatorImpactPromise)
            playSpectatorImpactAtRack();
        if (celebration && !spectatorCelebrationShown) {
            spectatorCelebrationShown = true;
            this.showBowlingCelebration(celebration);
            if (celebration.kind === 'strike')
                audioDirector.playCheer();
            else
                audioDirector.playSpare();
        }
    }
    handleSpectatorShotResult(result) {
        if (!this.scene.isActive() || !this.ui || result.playerId !== this.spectatorPlayerId)
            return;
        const state = appState.tournament;
        const match = state ? findMyMatch(state) : undefined;
        if (!match || match.id !== result.matchId)
            return;
        const authoritative = {
            knockedPins: result.knockedPins,
            speedKmh: result.speedKmh,
            gutter: result.gutter,
            headPinHit: false
        };
        const speed = this.ui.querySelector('#sim-speed');
        const note = this.ui.querySelector('#sim-shot-note');
        const status = this.ui.querySelector('#spectator-live-status');
        if (speed && result.speedKmh > 0)
            speed.textContent = `BALL SPEED ${result.speedKmh.toFixed(1)} KM/H`;
        const label = this.spectatorBowlOff
            ? bowlOffShotResultLabel(authoritative)
            : shotResultLabel(this.spectatorGameAtRelease, authoritative, this.spectatorStandingBefore);
        if (note)
            note.textContent = label;
        if (status)
            status.textContent = `Official result: ${label}`;
    }
    goToMatchResult() {
        if (!this.scene.isActive())
            return;
        this.movingToResult = true;
        window.clearTimeout(this.resultTimer);
        this.resultTimer = 0;
        this.scene.start('MatchResultScene');
    }
    showToast(message) {
        if (!this.ui)
            return;
        const toast = document.createElement('div');
        toast.className = 'game-toast';
        toast.textContent = message;
        this.ui.appendChild(toast);
        window.setTimeout(() => toast.remove(), 1800);
    }
}
function renderPlayerShotControls(aim, hook, level, bowlOff = false) {
    const showSetupClues = level === 1;
    return `<div class="bowling-control-grid">
      <label class="sim-slider-control">
        <span><strong>1. AIM TARGET</strong>${showSetupClues ? `<em id="aim-label">${aimLabel(aim)}</em>` : ''}</span>
        <input id="aim-slider" type="range" min="-100" max="100" value="${Math.round(aim * 100)}" aria-label="Straight bowling aim target" />
        <small><b>LEFT</b><b>HEAD PIN</b><b>RIGHT</b></small>
      </label>
      <label class="sim-slider-control">
        <span><strong>2. HOOK</strong>${showSetupClues ? `<em id="hook-label">${hookLabel(hook)}</em>` : ''}</span>
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
    <div id="sim-help" class="sim-help">${bowlOff ? '<strong>🔥 BOWL-OFF:</strong> One ball only on a fresh rack of 10. Knock down more pins than your opponent to win the match.' : 'Drag the ball left or right to choose where to stand. Then set a straight aim target and add hook. Press START APPROACH, then release in the small green zone. The meter changes speed every bowl.'}</div>`;
}
function renderReconnectPanel(name) {
    return `<div class="disconnect-reconnect-panel" role="status" aria-live="polite">
    <div class="disconnect-reconnect-icon">📡</div>
    <div class="disconnect-reconnect-copy">
      <strong>${escapeHtml(name)} disconnected — waiting for reconnection…</strong>
      <span>The match is paused. If they do not return within 20 seconds, they forfeit this match.</span>
    </div>
    <div class="disconnect-reconnect-countdown"><strong id="disconnect-reconnect-clock">20</strong><small>SECONDS</small></div>
  </div>`;
}
function renderSpectatorTurnPanel(opponent, opponentGame, match, level, opponentMathFrame) {
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
    if (match.currentPlayerId === opponent.id && (!opponentGame?.complete || match.bowlOffActive)) {
        return `<div class="spectator-turn-panel live${match.bowlOffActive ? ' bowl-off-spectator-panel' : ''}">
      <div class="spectator-live-header"><span class="live-dot">LIVE</span><strong>${match.bowlOffActive ? `🔥 BOWL-OFF ROUND ${match.bowlOffRound} • ` : ''}${escapeHtml(opponent.name)}'s bowling attempt</strong></div>
      <div id="spectator-live-status" class="spectator-live-status">${match.bowlOffActive ? 'Fresh rack of 10 • one ball only. They must beat the opponent\'s Bowl-Off pin count.' : 'They are setting up the shot. Aim, hook and release controls stay private.'}</div>
      <div class="spectator-shot-clock-row"><span>SHOT CLOCK</span><strong id="spectator-shot-clock">15s</strong></div>
      <small>${match.bowlOffActive ? 'No spare attempt: if the round ties again, both players receive another fresh rack.' : 'As soon as the ball is released, this lane will replay the exact live trajectory and pin action.'}</small>
    </div>`;
    }
    return `<div class="spectator-turn-panel quiet"><strong>WAITING</strong><span>Your controls will appear automatically when your turn begins.</span></div>`;
}
function createShotId() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID)
        return cryptoApi.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function gameProgressKey(game) {
    if (!game)
        return '';
    return JSON.stringify({
        frames: game.frames,
        currentFrame: game.currentFrame,
        complete: game.complete,
        standingPins: game.standingPins,
        pendingMathFrames: game.pendingMathFrames
    });
}
function shotProgressKey(match, game) {
    if (!match)
        return '';
    return JSON.stringify({
        game: gameProgressKey(game),
        bowlOffActive: match.bowlOffActive,
        bowlOffRound: match.bowlOffRound,
        bowlOffPlayerAScore: match.bowlOffPlayerAScore,
        bowlOffPlayerBScore: match.bowlOffPlayerBScore,
        bowlOffHistoryLength: match.bowlOffHistory.length,
        currentPlayerId: match.currentPlayerId
    });
}
function findMyMatch(state) {
    return state.matches
        .filter((match) => !match.complete && (match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId))
        .sort((a, b) => b.createdAt - a.createdAt)[0]
        ?? state.matches
            .filter((match) => match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId)
            .sort((a, b) => b.createdAt - a.createdAt)[0];
}
function myMatchFingerprint(state) {
    const match = findMyMatch(state);
    if (!match)
        return '';
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
        tieBreak: match.tieBreak,
        bowlOffActive: match.bowlOffActive,
        bowlOffRound: match.bowlOffRound,
        bowlOffPlayerAScore: match.bowlOffPlayerAScore,
        bowlOffPlayerBScore: match.bowlOffPlayerBScore,
        bowlOffHistory: match.bowlOffHistory,
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
function fullRackPins() {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
}
function bowlOffStatus(match) {
    const a = match.bowlOffPlayerAScore === null ? '—' : String(match.bowlOffPlayerAScore);
    const b = match.bowlOffPlayerBScore === null ? '—' : String(match.bowlOffPlayerBScore);
    return `Bowl-Off Round ${match.bowlOffRound} • ${escapeHtml(match.playerA.name)} ${a} – ${b} ${escapeHtml(match.playerB?.name ?? 'Opponent')} • fresh rack every bowl`;
}
function renderBowlOffBoard(match) {
    const aScore = match.bowlOffPlayerAScore === null ? '—' : String(match.bowlOffPlayerAScore);
    const bScore = match.bowlOffPlayerBScore === null ? '—' : String(match.bowlOffPlayerBScore);
    const previous = match.bowlOffHistory.length
        ? `<div class="bowl-off-history">${match.bowlOffHistory.slice(-3).map((round) => `<span>R${round.round}: <b>${round.playerAScore}–${round.playerBScore}</b></span>`).join('')}</div>`
        : '<div class="bowl-off-history"><span>First Bowl-Off round</span></div>';
    return `<div class="bowl-off-board" role="status" aria-live="polite">
    <div class="bowl-off-board-title"><span>🔥</span><strong>BOWL-OFF</strong><em>ROUND ${match.bowlOffRound}</em></div>
    <div class="bowl-off-rule">TIED AFTER 10 FRAMES • ONE BALL EACH • FRESH 10-PIN RACK • HIGHER COUNT WINS</div>
    <div class="bowl-off-scores"><span><small>${escapeHtml(match.playerA.name)}</small><strong>${aScore}</strong></span><b>VS</b><span><small>${escapeHtml(match.playerB?.name ?? 'Opponent')}</small><strong>${bScore}</strong></span></div>
    ${previous}
  </div>`;
}
function bowlOffShotResultLabel(result) {
    if (result.gutter && result.knockedPins.length === 0)
        return '🔥 BOWL-OFF • GUTTER — 0 PINS';
    if (result.knockedPins.length === 10)
        return '🔥 BOWL-OFF STRIKE • 10 PINS!';
    if (result.knockedPins.length === 0)
        return '🔥 BOWL-OFF • 0 PINS';
    return `🔥 BOWL-OFF • ${result.knockedPins.length} PIN${result.knockedPins.length === 1 ? '' : 'S'} DOWN`;
}
function bowlOffCelebrationForCount(standingBefore) {
    if (standingBefore !== 10)
        return null;
    return { kind: 'strike', title: 'BOWL-OFF STRIKE!', subtitle: 'Maximum pressure • 10 pins', graphic: '🔥 🎳 🔥' };
}
function bowlOffCelebration(result) {
    return result.knockedPins.length === 10 ? bowlOffCelebrationForCount(10) : null;
}
function clearedRackCelebration(game, standingBefore) {
    if (standingBefore <= 0)
        return null;
    return shotCelebration(game, {
        knockedPins: Array.from({ length: standingBefore }, (_, index) => index),
        speedKmh: 0,
        gutter: false,
        headPinHit: standingBefore === 10
    }, standingBefore);
}
function shotCelebration(game, result, standingBefore) {
    const clearKind = rackClearKind(game, result.knockedPins.length, standingBefore);
    if (clearKind === 'spare') {
        return { kind: 'spare', title: 'SPARE!', subtitle: 'Every remaining pin cleaned up', graphic: '✨ 🎳 ✨' };
    }
    if (clearKind !== 'strike')
        return null;
    const previousStreak = trailingStrikeCount(game.frames);
    const streak = previousStreak + 1;
    const frontSeven = streak === 7 && previousFramesAreAllStrikes(game.frames);
    const names = {
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
function rackClearKind(game, knockedCount, standingBefore) {
    if (standingBefore <= 0 || knockedCount !== standingBefore)
        return null;
    const frameIndex = Math.max(0, Math.min(9, game.currentFrame - 1));
    const rolls = game.frames[frameIndex] ?? [];
    if (frameIndex < 9) {
        if (rolls.length === 0 && knockedCount === 10)
            return 'strike';
        if (rolls.length === 1 && (rolls[0] ?? 0) + knockedCount === 10)
            return 'spare';
        return null;
    }
    // Tenth-frame rack context matters because bonus balls may start on a fresh rack.
    if (rolls.length === 0)
        return knockedCount === 10 ? 'strike' : null;
    if (rolls.length === 1) {
        const first = rolls[0] ?? 0;
        if (first === 10)
            return knockedCount === 10 ? 'strike' : null;
        return first + knockedCount === 10 ? 'spare' : null;
    }
    if (rolls.length === 2) {
        const first = rolls[0] ?? 0;
        const second = rolls[1] ?? 0;
        if (first === 10) {
            if (second === 10)
                return knockedCount === 10 ? 'strike' : null;
            return second + knockedCount === 10 ? 'spare' : null;
        }
        // A third ball after a first-two-ball spare starts from a fresh rack.
        return knockedCount === 10 ? 'strike' : null;
    }
    return null;
}
function frameStrikeMarks(rolls, frameIndex) {
    if (frameIndex < 9)
        return rolls.length ? [rolls[0] === 10] : [];
    const marks = [];
    const first = rolls[0];
    const second = rolls[1];
    const third = rolls[2];
    if (first !== undefined)
        marks.push(first === 10);
    if (second !== undefined)
        marks.push(first === 10 && second === 10);
    if (third !== undefined) {
        const freshRackForThird = (first === 10 && second === 10) || ((first ?? 0) + (second ?? 0) === 10 && first !== 10);
        marks.push(freshRackForThird && third === 10);
    }
    return marks;
}
function trailingStrikeCount(frames) {
    let count = 0;
    for (let frameIndex = Math.min(9, frames.length - 1); frameIndex >= 0; frameIndex--) {
        const marks = frameStrikeMarks(frames[frameIndex] ?? [], frameIndex);
        if (!marks.length)
            continue;
        for (let i = marks.length - 1; i >= 0; i--) {
            if (!marks[i])
                return count;
            count++;
        }
    }
    return count;
}
function previousFramesAreAllStrikes(frames) {
    const completed = frames.slice(0, 6);
    return completed.length >= 6 && completed.every((frame) => frame[0] === 10);
}
function renderMathOverlay(level, game, frameIndex) {
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
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => `<button type="button" data-math-digit="${digit}">${digit}</button>`).join('')}
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
function renderMathScorecard(game, focusFrame) {
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
function renderReturnLobbyConfirm() {
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
function guidedFrameExplanation(game, frameIndex, frameScore) {
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
function futureRollsForMath(frames, frameIndex, count) {
    const out = [];
    for (let i = frameIndex + 1; i < frames.length && out.length < count; i++) {
        for (const roll of frames[i]) {
            out.push(roll);
            if (out.length >= count)
                break;
        }
    }
    return out;
}
function renderPlayerHeader(name, id, turnId, winnerId) {
    return `<div class="score-player${turnId === id ? ' active' : ''}${winnerId === id ? ' winner' : ''}"><span>${winnerId === id ? '🏆 ' : ''}${escapeHtml(name)}</span><span>${turnId === id ? 'BOWLING' : ''}</span></div>`;
}
function renderScorecard(game) {
    if (!game)
        return '';
    return `<div class="scorecard">${game.frames.map((rolls, index) => {
        const tenth = index === 9;
        return `<div class="frame-box${tenth ? ' tenth' : ''}${game.currentFrame === index + 1 && !game.complete ? ' current' : ''}">
      <div class="frame-num">${index + 1}</div>
      <div class="frame-rolls">${renderRollCells(rolls, tenth)}</div>
      <div class="frame-total">${game.cumulative[index] ?? ''}</div>
    </div>`;
    }).join('')}</div>`;
}
function renderRollCells(rolls, tenth) {
    if (!tenth) {
        if (rolls[0] === 10)
            return `<span class="roll-cell"></span><span class="roll-cell">X</span>`;
        return [0, 1].map((index) => `<span class="roll-cell">${formatRollSymbol(rolls, index, false)}</span>`).join('');
    }
    return [0, 1, 2].map((index) => `<span class="roll-cell">${formatRollSymbol(rolls, index, true)}</span>`).join('');
}
function formatRollSymbol(rolls, index, tenth) {
    const roll = rolls[index];
    if (roll === undefined)
        return '';
    // A second-ball 10 can still be a spare (for example 0 + 10). Check
    // spare context before treating a raw 10-pin roll as a strike.
    if (!tenth && index === 1 && (rolls[0] ?? 0) + roll === 10)
        return '/';
    if (tenth && index === 1 && rolls[0] !== 10 && (rolls[0] ?? 0) + roll === 10)
        return '/';
    if (tenth && index === 2 && rolls[0] === 10 && rolls[1] !== 10 && (rolls[1] ?? 0) + roll === 10)
        return '/';
    if (roll === 10)
        return 'X';
    if (roll === 0)
        return '-';
    return String(roll);
}
function frameStatus(game) {
    if (game.complete && game.pendingMathFrames.length)
        return 'All 10 frames are complete • finish the score checks to lock in your total.';
    if (game.complete)
        return `Your 10-frame game is complete — score ${game.total ?? 0}.`;
    return `Frame ${game.currentFrame} of 10 • ${game.standingPins?.length ?? 10} pin${(game.standingPins?.length ?? 10) === 1 ? '' : 's'} standing`;
}
function fallbackStandingPins(game) {
    if (!game)
        return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const frame = game.frames[Math.min(9, game.currentFrame - 1)] ?? [];
    let standing = 10;
    if (game.currentFrame < 10 && frame.length === 1 && frame[0] !== 10)
        standing = 10 - frame[0];
    return Array.from({ length: standing }, (_, index) => index);
}
function aimLabel(value) {
    if (Math.abs(value) < 0.04)
        return 'HEAD PIN';
    const boards = Math.max(1, Math.round(Math.abs(value) * 12));
    return `${boards} BOARD${boards === 1 ? '' : 'S'} ${value < 0 ? 'LEFT' : 'RIGHT'}`;
}
function hookLabel(value) {
    if (Math.abs(value) < 0.08)
        return 'STRAIGHT';
    const strength = Math.round(Math.abs(value) * 100);
    return `${strength}% ${value < 0 ? 'LEFT' : 'RIGHT'}`;
}
function meterLabel(position) {
    const percent = Math.round(position * 100);
    if (position >= METER_GREEN_START && position <= METER_GREEN_END)
        return `${percent}% • PERFECT`;
    if (position < METER_GREEN_START)
        return `${percent}% • EARLY`;
    return `${percent}% • LATE`;
}
function shotResultLabel(game, result, standingBefore) {
    if (result.gutter && result.knockedPins.length === 0)
        return 'GUTTER BALL';
    const clearKind = game ? rackClearKind(game, result.knockedPins.length, standingBefore) : null;
    if (clearKind === 'strike')
        return '💥 STRIKE!';
    if (clearKind === 'spare')
        return '✨ SPARE!';
    if (result.knockedPins.length === 0)
        return 'MISS — 0 PINS';
    return `${result.knockedPins.length} PIN${result.knockedPins.length === 1 ? '' : 'S'} DOWN`;
}
function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
