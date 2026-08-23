// @ts-nocheck
import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { appState } from '../state';
import { network } from '../net/NetworkManager';
export class MatchupScene extends BaseBowlingScene {
    cleanup = [];
    countdownTimer = 0;
    ui;
    laneScrollLeft = 0;
    laneAnchorMatchId = null;
    laneDefaultApplied = false;
    laneInteractionUntil = 0;
    deferredRenderTimer = 0;
    leaderboardScrollTop = 0;
    managePlayersOpen = false;
    participationBusy = false;
    constructor() { super('MatchupScene'); }
    create() {
        this.setupBaseScene();
        this.laneScrollLeft = 0;
        this.laneAnchorMatchId = null;
        this.laneDefaultApplied = false;
        this.laneInteractionUntil = 0;
        this.participationBusy = false;
        window.clearTimeout(this.deferredRenderTimer);
        this.deferredRenderTimer = 0;
        if (!appState.room || (appState.matchups.length === 0 && appState.room.status === 'lobby'))
            return void this.scene.start('LobbyScene');
        this.ui = createSceneUi();
        this.render();
        this.countdownTimer = window.setInterval(() => this.updateCountdown(), 150);
        this.cleanup.push(network.on('roomState', (room) => {
            if (room.status !== 'lobby')
                return;
            appState.room = room;
            appState.matchups = [];
            appState.matchupEndsAt = null;
            appState.tournament = null;
            appState.roundResult = null;
            appState.spectatingMatchId = null;
            this.scene.start('LobbyScene');
        }), network.on('bowlingStarted', (state) => {
            appState.room = state.room;
            appState.tournament = state;
            appState.matchups = matchupSummaries(state.matches);
            appState.roundResult = null;
            const myMatch = findMyLiveMatch(state.matches);
            if (myMatch && !myMatch.complete && myMatch.playerB)
                this.scene.start('BowlingScene');
            else
                this.render();
        }), network.on('bowlingState', (state) => {
            appState.room = state.room;
            appState.tournament = state;
            appState.matchups = matchupSummaries(state.matches);
            const me = state.room.players.find((player) => player.id === appState.playerId);
            const myMatch = findMyLiveMatch(state.matches);
            // A host may inspect the board while already playing so the OPT OUT
            // control remains accessible. If the host has just opted back in and
            // receives a live lane, take them straight into that newly assigned game.
            if (myMatch && !myMatch.complete && myMatch.playerB && (!me?.isHost || this.participationBusy)) {
                this.participationBusy = false;
                this.scene.start('BowlingScene');
                return;
            }
            this.requestRender();
        }), network.on('roundComplete', (result) => {
            appState.room = result.room;
            appState.roundResult = result;
            appState.tournament = result;
            this.requestRender();
        }), network.on('matchStarted', (message) => {
            appState.room = message.room;
            appState.matchups = message.matchups;
            appState.matchupEndsAt = message.phaseEndsAt;
            appState.roundResult = null;
            appState.spectatingMatchId = null;
            this.requestRender();
        }), network.on('finalResults', (results) => {
            appState.room = results.room;
            appState.finalResults = results;
            this.scene.start('FinalResultsScene');
        }), network.on('error', ({ message }) => {
            this.participationBusy = false;
            this.requestRender(true);
            alert(message);
        }));
        this.events.once('shutdown', () => {
            window.clearInterval(this.countdownTimer);
            window.clearTimeout(this.deferredRenderTimer);
            this.deferredRenderTimer = 0;
            this.cleanup.splice(0).forEach((fn) => fn());
        });
        const initialState = appState.tournament;
        const me = initialState?.room.players.find((player) => player.id === appState.playerId);
        const initialMatch = initialState ? findMyLiveMatch(initialState.matches) : undefined;
        if (initialState?.room.status === 'bowling' && !me?.isHost && initialMatch && !initialMatch.complete && initialMatch.playerB) {
            this.scene.start('BowlingScene');
        }
    }
    render() {
        if (!this.ui || !appState.room)
            return;
        const room = appState.room;
        this.participationBusy = false;
        const me = room.players.find((player) => player.id === appState.playerId);
        const isHost = Boolean(me?.isHost);
        const myLane = appState.matchups.find((match) => isMyMatch(match));
        const myLiveMatch = appState.tournament?.matches.find((match) => isMyMatch(match));
        const myActiveMatch = Boolean(myLiveMatch && !myLiveMatch.complete && myLiveMatch.playerB);
        const hostParticipating = me?.participating !== false;
        const liveBowling = room.status === 'bowling';
        const firstRoundWaiting = room.status === 'matchup' && appState.matchupEndsAt === null;
        const autoCountdown = room.status === 'matchup' && appState.matchupEndsAt !== null;
        // No device may spectate over its own live match. Hosts who want to teach
        // from spectator mode can use OPT OUT, then every live lane becomes watchable.
        const canWatchOtherLanes = liveBowling && !myActiveMatch;
        const leaderboard = sortLeaderboard(room);
        const liveCount = liveBowling ? (appState.tournament?.matches.filter((match) => !match.complete && Boolean(match.playerB)).length ?? 0) : 0;
        const previousTrack = this.ui.querySelector('#lane-track');
        if (previousTrack)
            this.captureLanePosition(previousTrack);
        const previousLeaderboard = this.ui.querySelector('#leaderboard-list');
        if (previousLeaderboard)
            this.leaderboardScrollTop = previousLeaderboard.scrollTop;
        this.ui.innerHTML = `
      <div class="match-shell interactive">
        <div class="match-head panel">
          <div><h1 class="match-title">Lane Matchups</h1>${liveBowling ? `<div class="class-live-summary"><span class="live-dot"></span>${liveCount} LIVE MATCH${liveCount === 1 ? '' : 'ES'} • TAP A LANE TO WATCH</div>` : ''}</div>
          <div class="match-head-actions">
            <div class="level-badge">LEVEL ${room.level}</div>
            ${isHost ? `<button id="host-participation" class="host-nav-btn host-participation-btn${hostParticipating ? '' : ' opted-out'}" type="button"${this.participationBusy ? ' disabled' : ''} title="${hostParticipating ? 'Stop playing and spectate only' : 'Rejoin from the lowest available lane'}">${this.participationBusy ? 'UPDATING…' : hostParticipating ? '👁 OPT OUT' : '🎳 OPT IN'}</button>` : ''}
            ${isHost ? '<button id="manage-players" class="host-nav-btn manage-players-trigger" type="button">👥 MANAGE PLAYERS</button>' : ''}
            ${isHost && myActiveMatch ? '<button id="return-game" class="host-nav-btn" type="button">🎳 RETURN TO MY GAME</button>' : ''}
            ${isHost ? '<button id="matchup-return-lobby" class="host-nav-btn return-lobby-trigger" type="button">↩ RETURN TO LOBBY</button>' : ''}
          </div>
        </div>

        <div class="match-board-layout">
          <section class="match-lanes-pane">
            <div class="lane-direction"><span>← LOWEST LANE</span><span>CHAMPIONSHIP LANE →</span></div>
            <div class="lane-carousel">
              <button id="lane-prev" class="lane-nav-btn lane-nav-prev" type="button" aria-label="View lanes to the left" title="Previous lane">◀</button>
              <div id="lane-track" class="lane-track">
                ${appState.matchups.map((match) => renderLaneCard(match, liveStateFor(match.id), isHost, canWatchOtherLanes)).join('')}
              </div>
              <button id="lane-next" class="lane-nav-btn lane-nav-next" type="button" aria-label="View lanes to the right" title="Next lane">▶</button>
            </div>
          </section>

          <aside class="match-leaderboard panel">
            <div class="leaderboard-title-row"><h2>Wins Leaderboard</h2><span>LIVE STANDINGS</span></div>
            <div class="leaderboard-scroll-shell">
              <button id="leaderboard-up" class="leaderboard-page-btn leaderboard-page-up" type="button" aria-label="View previous leaderboard names" title="Previous leaderboard page">▲</button>
              <div id="leaderboard-list" class="leaderboard-list">
                ${leaderboard.map((player, index) => `
                  <div class="leaderboard-row${player.id === appState.playerId ? ' me' : ''}${player.id === room.championId ? ' champion' : ''}" data-leaderboard-rank="${index + 1}">
                    <span class="leaderboard-pos">${player.id === room.championId ? '👑' : index + 1}</span>
                    <span class="leaderboard-name">${escapeHtml(player.name)}</span>
                    <strong>${player.wins}</strong>
                  </div>`).join('')}
              </div>
              <div id="leaderboard-range" class="leaderboard-range" aria-live="polite">${leaderboard.length ? `1–${Math.min(leaderboard.length, 1)} of ${leaderboard.length}` : '0 of 0'}</div>
              <button id="leaderboard-down" class="leaderboard-page-btn leaderboard-page-down" type="button" aria-label="View more leaderboard names" title="Next leaderboard page">▼</button>
            </div>
          </aside>
        </div>

        <div class="match-footer panel-lite">
          <div class="match-footer-copy">
            <strong>${isHost && !hostParticipating
            ? 'You are SPECTATING ONLY — you are not in the bowling ladder.'
            : myLane
                ? `You are on ${myLane.championship ? 'the Championship Lane' : `Lane ${myLane.lane}`}.`
                : liveBowling ? 'You are waiting for the next matchup.' : ''}</strong>
            <span>${isHost && !hostParticipating
            ? liveBowling
                ? 'Tap any LIVE lane to spectate. Press OPT IN when you want to rejoin from the lowest available lane.'
                : 'Press OPT IN to rejoin the next available matchup from the lowest lane.'
            : liveBowling
                ? canWatchOtherLanes
                    ? 'Choose any lane marked LIVE to spectate the exact bowling action, scores and maths checks.'
                    : isHost
                        ? 'Your own match is active. Return to your game, or OPT OUT to award your opponent the win and switch to spectator-only mode.'
                        : 'Your own match is active. You will return to your lane automatically.'
                : firstRoundWaiting
                    ? 'The first matchups wait for the host. After that, every new matchup starts automatically after a 5-second countdown.'
                    : room.status === 'round_result'
                        ? 'The completed round is being processed. New matchups will appear automatically.'
                        : 'Winners move right, losers move left, and each win adds 1 point.'}</span>
          </div>
          ${isHost && firstRoundWaiting ? '<button id="begin-first" class="primary-btn matchup-start-btn" type="button">START FIRST MATCHUPS</button>' : ''}
          ${!isHost && firstRoundWaiting ? '<button class="secondary-btn matchup-start-btn" type="button" disabled>WAITING FOR HOST</button>' : ''}
        </div>

        ${autoCountdown ? renderCountdownOverlay(myLane) : ''}
        ${isHost && this.managePlayersOpen ? renderManagePlayersOverlay(room, appState.playerId) : ''}
      </div>`;
        this.ui.querySelector('#begin-first')?.addEventListener('click', (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'STARTING…';
            network.beginRound();
        });
        this.ui.querySelector('#host-participation')?.addEventListener('click', (event) => {
            if (!isHost || this.participationBusy)
                return;
            const next = !hostParticipating;
            if (!next && myActiveMatch) {
                const confirmed = window.confirm('Opt out of the current match? Your opponent will immediately receive the win. You will then be spectator-only until you press OPT IN.');
                if (!confirmed)
                    return;
            }
            this.participationBusy = true;
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'UPDATING…';
            network.setHostParticipation(next);
        });
        this.ui.querySelector('#manage-players')?.addEventListener('click', () => {
            this.managePlayersOpen = true;
            this.render();
        });
        this.ui.querySelector('#return-game')?.addEventListener('click', () => this.scene.start('BowlingScene'));
        this.ui.querySelector('#matchup-return-lobby')?.addEventListener('click', () => this.openReturnLobbyConfirm());
        this.ui.querySelectorAll('[data-watch-match]').forEach((card) => {
            card.addEventListener('click', () => this.openSpectator(card.dataset.watchMatch));
        });
        this.ui.querySelectorAll('[data-own-game]').forEach((card) => {
            card.addEventListener('click', () => this.scene.start('BowlingScene'));
        });
        this.setupLaneNavigation(isHost);
        this.setupLeaderboardNavigation();
        this.setupManagePlayersOverlay();
        this.updateCountdown();
    }
    setupManagePlayersOverlay() {
        if (!this.ui || !this.managePlayersOpen)
            return;
        const overlay = this.ui.querySelector('#manage-players-overlay');
        if (!overlay)
            return;
        const close = () => {
            this.managePlayersOpen = false;
            this.render();
        };
        this.ui.querySelector('#manage-players-close')?.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay)
                close();
        });
        this.ui.querySelectorAll('[data-manage-kick]').forEach((button) => {
            button.addEventListener('click', () => {
                const playerId = button.dataset.manageKick;
                if (!playerId)
                    return;
                button.disabled = true;
                button.textContent = 'REMOVING…';
                network.kickPlayer(playerId);
            });
        });
    }
    requestRender(force = false) {
        if (!force && performance.now() < this.laneInteractionUntil) {
            window.clearTimeout(this.deferredRenderTimer);
            this.deferredRenderTimer = window.setTimeout(() => this.render(), Math.max(80, this.laneInteractionUntil - performance.now() + 30));
            return;
        }
        this.render();
    }
    captureLanePosition(track) {
        this.laneScrollLeft = track.scrollLeft;
        const cards = Array.from(track.querySelectorAll('.lane-card'));
        if (!cards.length)
            return;
        const trackRect = track.getBoundingClientRect();
        const centre = trackRect.left + trackRect.width / 2;
        const closest = cards
            .map((card) => ({ card, distance: Math.abs((card.getBoundingClientRect().left + card.getBoundingClientRect().right) / 2 - centre) }))
            .sort((a, b) => a.distance - b.distance)[0]?.card;
        this.laneAnchorMatchId = closest?.dataset.matchId ?? null;
    }
    setupLaneNavigation(isHost) {
        if (!this.ui)
            return;
        const track = this.ui.querySelector('#lane-track');
        const previous = this.ui.querySelector('#lane-prev');
        const next = this.ui.querySelector('#lane-next');
        if (!track || !previous || !next)
            return;
        const updateButtons = () => {
            const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
            previous.disabled = maxScroll < 2 || track.scrollLeft <= 2;
            next.disabled = maxScroll < 2 || track.scrollLeft >= maxScroll - 2;
        };
        const centreCard = (card, behavior = 'auto') => {
            const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
            const targetLeft = Math.max(0, Math.min(maxScroll, card.offsetLeft - (track.clientWidth - card.clientWidth) / 2));
            track.scrollTo({ left: targetLeft, behavior });
        };
        const moveOneLane = (direction) => {
            const cards = Array.from(track.querySelectorAll('.lane-card'));
            if (cards.length === 0)
                return;
            this.laneInteractionUntil = performance.now() + 480;
            const trackRect = track.getBoundingClientRect();
            const currentCentre = track.scrollLeft + track.clientWidth / 2;
            const centres = cards.map((card) => card.getBoundingClientRect().left - trackRect.left + track.scrollLeft + card.clientWidth / 2);
            const targetIndex = direction > 0
                ? centres.findIndex((centre) => centre > currentCentre + 10)
                : (() => {
                    for (let index = centres.length - 1; index >= 0; index--)
                        if (centres[index] < currentCentre - 10)
                            return index;
                    return 0;
                })();
            const card = cards[targetIndex >= 0 ? targetIndex : cards.length - 1];
            if (card) {
                this.laneAnchorMatchId = card.dataset.matchId ?? null;
                centreCard(card, 'smooth');
            }
        };
        previous.addEventListener('click', () => moveOneLane(-1));
        next.addEventListener('click', () => moveOneLane(1));
        const markInteraction = () => { this.laneInteractionUntil = performance.now() + 420; };
        track.addEventListener('pointerdown', markInteraction, { passive: true });
        track.addEventListener('touchstart', markInteraction, { passive: true });
        track.addEventListener('wheel', markInteraction, { passive: true });
        track.addEventListener('scroll', () => {
            this.laneInteractionUntil = Math.max(this.laneInteractionUntil, performance.now() + 220);
            this.captureLanePosition(track);
            updateButtons();
        }, { passive: true });
        requestAnimationFrame(() => {
            const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
            const anchored = this.laneAnchorMatchId
                ? track.querySelector(`[data-match-id="${this.laneAnchorMatchId}"]`)
                : null;
            if (anchored) {
                centreCard(anchored);
            }
            else if (!this.laneDefaultApplied) {
                // Host view deliberately opens on the right-most Championship Lane.
                if (isHost)
                    track.scrollLeft = maxScroll;
                else {
                    const myLane = appState.matchups.find((match) => isMyMatch(match));
                    const myCard = myLane ? track.querySelector(`[data-match-id="${myLane.id}"]`) : null;
                    if (myCard)
                        centreCard(myCard);
                    else
                        track.scrollLeft = Math.max(0, Math.min(maxScroll, this.laneScrollLeft));
                }
                this.laneDefaultApplied = true;
                this.captureLanePosition(track);
            }
            else {
                track.scrollLeft = Math.max(0, Math.min(maxScroll, this.laneScrollLeft));
                this.captureLanePosition(track);
            }
            updateButtons();
        });
    }
    setupLeaderboardNavigation() {
        if (!this.ui)
            return;
        const list = this.ui.querySelector('#leaderboard-list');
        const up = this.ui.querySelector('#leaderboard-up');
        const down = this.ui.querySelector('#leaderboard-down');
        const range = this.ui.querySelector('#leaderboard-range');
        if (!list || !up || !down || !range)
            return;
        const rows = Array.from(list.querySelectorAll('.leaderboard-row'));
        const updateControls = () => {
            const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
            up.disabled = maxScroll < 2 || list.scrollTop <= 2;
            down.disabled = maxScroll < 2 || list.scrollTop >= maxScroll - 2;
            if (rows.length === 0) {
                range.textContent = '0 of 0';
                return;
            }
            const listRect = list.getBoundingClientRect();
            const visible = rows.filter((row) => {
                const rect = row.getBoundingClientRect();
                return rect.bottom > listRect.top + 1 && rect.top < listRect.bottom - 1;
            });
            const first = Number((visible[0] ?? rows[0]).dataset.leaderboardRank ?? 1);
            const last = Number((visible[visible.length - 1] ?? rows[rows.length - 1]).dataset.leaderboardRank ?? rows.length);
            range.textContent = first === last ? `${first} of ${rows.length}` : `${first}–${last} of ${rows.length}`;
        };
        const movePage = (direction) => {
            const firstRow = rows[0];
            const rowStep = firstRow ? firstRow.getBoundingClientRect().height + 5 : 40;
            const pageDistance = Math.max(rowStep, list.clientHeight - rowStep);
            list.scrollBy({ top: direction * pageDistance, behavior: 'smooth' });
        };
        up.addEventListener('click', () => movePage(-1));
        down.addEventListener('click', () => movePage(1));
        list.addEventListener('scroll', () => {
            this.leaderboardScrollTop = list.scrollTop;
            updateControls();
        }, { passive: true });
        requestAnimationFrame(() => {
            const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
            list.scrollTop = Math.max(0, Math.min(maxScroll, this.leaderboardScrollTop));
            updateControls();
        });
    }
    openSpectator(matchId) {
        const live = appState.tournament?.matches.find((match) => match.id === matchId);
        if (!live || live.complete || !live.playerB)
            return;
        appState.spectatingMatchId = matchId;
        network.watchMatch(matchId);
        this.scene.start('LiveSpectatorScene');
    }
    openReturnLobbyConfirm() {
        if (!this.ui || this.ui.querySelector('#return-lobby-confirm'))
            return;
        this.ui.insertAdjacentHTML('beforeend', renderReturnLobbyConfirm());
        this.ui.querySelector('#return-lobby-no')?.addEventListener('click', () => this.ui?.querySelector('#return-lobby-confirm')?.remove());
        this.ui.querySelector('#return-lobby-yes')?.addEventListener('click', (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'RETURNING…';
            network.returnToLobby();
        });
    }
    updateCountdown() {
        if (!appState.matchupEndsAt || !this.ui)
            return;
        const el = this.ui.querySelector('#match-countdown');
        if (!el)
            return;
        el.textContent = `${Math.max(0, Math.ceil((appState.matchupEndsAt - Date.now()) / 1000))}`;
    }
}
function liveStateFor(matchId) {
    return appState.tournament?.matches.find((match) => match.id === matchId);
}
function findMyLiveMatch(matches) {
    return matches
        .filter((match) => !match.complete && (match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId))
        .sort((a, b) => b.createdAt - a.createdAt)[0]
        ?? matches
            .filter((match) => match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId)
            .sort((a, b) => b.createdAt - a.createdAt)[0];
}
function matchupSummaries(matches) {
    return matches.map((match) => ({
        id: match.id,
        createdAt: match.createdAt,
        lane: match.lane,
        championship: match.championship,
        playerA: match.playerA,
        playerB: match.playerB
    }));
}
function renderCountdownOverlay(match) {
    if (!match) {
        return `<div class="matchup-countdown-overlay"><div class="matchup-countdown-card panel">
      <div class="eyebrow">NEW MATCHUPS</div><div id="match-countdown" class="matchup-countdown-number">5</div>
      <div class="matchup-countdown-copy">Next bowling match starts automatically</div>
    </div></div>`;
    }
    const laneLabel = match.championship ? '👑 CHAMPIONSHIP LANE' : `LANE ${match.lane}`;
    const playerA = escapeHtml(match.playerA.name);
    const playerB = match.playerB ? escapeHtml(match.playerB.name) : null;
    return `<div class="matchup-countdown-overlay"><div class="matchup-countdown-card panel">
    <div class="eyebrow">NEW MATCHUPS</div><div class="countdown-lane-label">${laneLabel}</div>
    <div class="countdown-matchup">
      <div class="countdown-player${match.playerA.id === appState.playerId ? ' me' : ''}">🎳 ${playerA}</div>
      ${playerB
        ? `<div class="countdown-vs">VS</div><div class="countdown-player${match.playerB?.id === appState.playerId ? ' me' : ''}">🎳 ${playerB}</div>`
        : '<div class="countdown-vs">BYE</div><div class="countdown-player bye">🦃 No opponent this round</div>'}
    </div>
    <div id="match-countdown" class="matchup-countdown-number">5</div>
    <div class="matchup-countdown-copy">${playerB ? 'Your next bowling match starts automatically' : 'Your bye is processed automatically — you can spectate live lanes while waiting'}</div>
  </div></div>`;
}
function isMyMatch(match) {
    return match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId;
}
function renderLaneCard(match, live, isHost, canWatchOtherLanes) {
    const mine = isMyMatch(match);
    const isLive = Boolean(live && !live.complete && match.playerB);
    const bowlOff = Boolean(live?.bowlOffActive);
    const finished = Boolean(live?.complete);
    const ownActive = mine && isLive;
    const watchable = isLive && !ownActive && canWatchOtherLanes;
    const hostOwnGame = isHost && ownActive;
    const dataAttribute = watchable ? ` data-watch-match="${match.id}"` : hostOwnGame ? ` data-own-game="${match.id}"` : '';
    const action = bowlOff && watchable
        ? '<div class="lane-live-action bowl-off-action"><span class="live-dot"></span> 🔥 BOWL-OFF • WATCH LIVE</div>'
        : bowlOff && hostOwnGame
            ? '<div class="lane-live-action bowl-off-action own-game">🔥 BOWL-OFF • RETURN TO GAME</div>'
            : bowlOff && isLive
                ? '<div class="lane-live-action bowl-off-action playing"><span class="live-dot"></span> 🔥 BOWL-OFF LIVE</div>'
                : watchable
                    ? '<div class="lane-live-action"><span class="live-dot"></span> WATCH LIVE</div>'
                    : hostOwnGame
                        ? '<div class="lane-live-action own-game">🎳 RETURN TO GAME</div>'
                        : isLive
                            ? '<div class="lane-live-action playing"><span class="live-dot"></span> LIVE</div>'
                            : finished
                                ? '<div class="lane-live-action finished">✓ FINISHED</div>'
                                : '';
    return `<article class="lane-card${mine ? ' me' : ''}${match.championship ? ' championship' : ''}${watchable || hostOwnGame ? ' watchable' : ''}${isLive ? ' live-lane' : ''}${bowlOff ? ' bowl-off-lane' : ''}" data-lane="${match.lane}" data-match-id="${match.id}"${dataAttribute}>
    <div class="lane-label"><span>${match.championship ? 'CHAMPIONSHIP LANE' : `LANE ${match.lane}`}</span>${match.championship ? '<span class="crown">👑</span>' : ''}</div>
    ${action}
    ${bowlOff ? `<div class="bowl-off-lane-banner"><strong>🔥 BOWL-OFF ROUND ${live?.bowlOffRound ?? 1}</strong><span>ONE BALL EACH • FRESH RACK</span></div>` : ''}
    <div class="vs-box">
      <div class="bowler-name">🎳 ${escapeHtml(match.playerA.name)}</div><div class="vs">VS</div>
      <div class="bowler-name">${match.playerB ? `🎳 ${escapeHtml(match.playerB.name)}` : '🦃 BYE'}</div>
    </div>
  </article>`;
}
function sortLeaderboard(room) {
    return [...room.players].sort((a, b) => {
        if (a.id === room.championId && b.id !== room.championId)
            return -1;
        if (b.id === room.championId && a.id !== room.championId)
            return 1;
        return b.wins - a.wins || b.lane - a.lane || a.name.localeCompare(b.name);
    });
}
function renderManagePlayersOverlay(room, hostPlayerId) {
    const humanPlayers = room.players.filter((player) => !player.isBot);
    return `
    <div id="manage-players-overlay" class="modal-backdrop manage-players-backdrop">
      <section class="panel manage-modal match-manage-modal" role="dialog" aria-modal="true" aria-labelledby="manage-players-title">
        <div class="match-manage-heading">
          <div>
            <h2 id="manage-players-title">Manage Players</h2>
            <p>${humanPlayers.length} human player${humanPlayers.length === 1 ? '' : 's'} in Room ${escapeHtml(room.code)}</p>
          </div>
          <button id="manage-players-close" class="secondary-btn match-manage-close" type="button">✕ CLOSE</button>
        </div>
        <div class="match-manage-help">Remove inappropriate player names without returning the whole class to the lobby. Removed players must change their name before they can rejoin.</div>
        <div class="match-manage-grid">
          ${humanPlayers.map((player) => `
            <div class="match-manage-player${player.id === hostPlayerId ? ' host-player' : ''}">
              <div class="match-manage-player-copy">
                <strong title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</strong>
                <span class="${player.connected ? 'online' : 'reconnecting'}">${player.id === hostPlayerId ? 'HOST • YOU' : player.connected ? 'ONLINE' : 'RECONNECTING'}</span>
              </div>
              ${player.id === hostPlayerId || player.isHost
        ? '<span class="match-manage-protected">HOST</span>'
        : `<button class="danger-btn match-manage-remove" data-manage-kick="${player.id}" type="button">REMOVE</button>`}
            </div>`).join('')}
        </div>
      </section>
    </div>`;
}
function renderReturnLobbyConfirm() {
    return `<div id="return-lobby-confirm" class="return-lobby-overlay">
    <section class="return-lobby-card panel" role="dialog" aria-modal="true" aria-labelledby="return-lobby-title">
      <div class="return-lobby-icon">⚠️</div><h2 id="return-lobby-title">Return everyone to the lobby?</h2>
      <p>This will <strong>cancel every bowling game currently in progress</strong>, clear the live lane results and wins leaderboard, and return all connected players to the lobby.</p>
      <div class="return-lobby-actions"><button id="return-lobby-no" class="secondary-btn" type="button">NO — KEEP PLAYING</button><button id="return-lobby-yes" class="danger-btn" type="button">YES — RETURN TO LOBBY</button></div>
    </section>
  </div>`;
}
function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
