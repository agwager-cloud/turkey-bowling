import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { appState } from '../state';
import { network } from '../net/NetworkManager';
import type { LaneMatchState, LaneMatchup, RoomState } from '../types';

export class MatchupScene extends BaseBowlingScene {
  private cleanup: Array<() => void> = [];
  private countdownTimer = 0;
  private ui?: HTMLDivElement;
  private laneScrollLeft = 0;
  private leaderboardScrollTop = 0;

  constructor() { super('MatchupScene'); }

  create(): void {
    this.setupBaseScene();
    if (!appState.room || appState.matchups.length === 0) return void this.scene.start('LobbyScene');
    this.ui = createSceneUi();
    this.render();
    this.countdownTimer = window.setInterval(() => this.updateCountdown(), 150);

    this.cleanup.push(
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
      network.on('bowlingStarted', (state) => {
        appState.room = state.room;
        appState.tournament = state;
        appState.roundResult = null;
        const myMatch = findMyLiveMatch(state.matches);
        if (myMatch && !myMatch.complete && myMatch.playerB) this.scene.start('BowlingScene');
        else this.render();
      }),
      network.on('bowlingState', (state) => {
        appState.room = state.room;
        appState.tournament = state;
        const me = state.room.players.find((player) => player.id === appState.playerId);
        const myMatch = findMyLiveMatch(state.matches);
        // Hosts may deliberately inspect the class board while their own lane
        // continues. Everyone else is automatically returned to their own game
        // if they become an active participant.
        if (!me?.isHost && myMatch && !myMatch.complete && myMatch.playerB) {
          this.scene.start('BowlingScene');
          return;
        }
        this.render();
      }),
      network.on('roundComplete', (result) => {
        appState.room = result.room;
        appState.roundResult = result;
        appState.tournament = result;
        this.render();
      }),
      network.on('matchStarted', (message) => {
        appState.room = message.room;
        appState.matchups = message.matchups;
        appState.matchupEndsAt = message.phaseEndsAt;
        appState.roundResult = null;
        appState.spectatingMatchId = null;
        this.render();
        this.centerMyLane();
      }),
      network.on('finalResults', (results) => {
        appState.room = results.room;
        appState.finalResults = results;
        this.scene.start('FinalResultsScene');
      }),
      network.on('error', ({ message }) => alert(message))
    );

    this.events.once('shutdown', () => {
      window.clearInterval(this.countdownTimer);
      this.cleanup.splice(0).forEach((fn) => fn());
    });

    this.centerMyLane();
  }

  private render(): void {
    if (!this.ui || !appState.room) return;
    const room = appState.room;
    const me = room.players.find((player) => player.id === appState.playerId);
    const isHost = Boolean(me?.isHost);
    const myLane = appState.matchups.find((match) => isMyMatch(match));
    const myLiveMatch = appState.tournament?.matches.find((match) => isMyMatch(match));
    const myActiveMatch = Boolean(myLiveMatch && !myLiveMatch.complete && myLiveMatch.playerB);
    const liveBowling = room.status === 'bowling';
    const firstRoundWaiting = room.status === 'matchup' && appState.matchupEndsAt === null;
    const autoCountdown = room.status === 'matchup' && appState.matchupEndsAt !== null;
    const canWatchOtherLanes = liveBowling && (isHost || !myActiveMatch);
    const leaderboard = sortLeaderboard(room);
    const liveCount = liveBowling ? (appState.tournament?.matches.filter((match) => !match.complete && Boolean(match.playerB)).length ?? 0) : 0;
    const previousTrack = this.ui.querySelector<HTMLDivElement>('#lane-track');
    if (previousTrack) this.laneScrollLeft = previousTrack.scrollLeft;
    const previousLeaderboard = this.ui.querySelector<HTMLDivElement>('#leaderboard-list');
    if (previousLeaderboard) this.leaderboardScrollTop = previousLeaderboard.scrollTop;

    this.ui.innerHTML = `
      <div class="match-shell interactive">
        <div class="match-head panel">
          <div><h1 class="match-title">Lane Matchups</h1>${liveBowling ? `<div class="class-live-summary"><span class="live-dot"></span>${liveCount} LIVE MATCH${liveCount === 1 ? '' : 'ES'} • TAP A LANE TO WATCH</div>` : ''}</div>
          <div class="match-head-actions">
            <div class="level-badge">LEVEL ${room.level}</div>
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
            <strong>${myLane ? `You are on ${myLane.championship ? 'the Championship Lane' : `Lane ${myLane.lane}`}.` : liveBowling ? 'You are waiting for the next matchup.' : ''}</strong>
            <span>${liveBowling
              ? canWatchOtherLanes
                ? 'Choose any lane marked LIVE to spectate the exact bowling action, scores and maths checks.'
                : 'Your match is still active. The host can inspect other lanes; players return to their own game automatically.'
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
      </div>`;

    this.ui.querySelector<HTMLButtonElement>('#begin-first')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = 'STARTING…';
      network.beginRound();
    });
    this.ui.querySelector<HTMLButtonElement>('#return-game')?.addEventListener('click', () => this.scene.start('BowlingScene'));
    this.ui.querySelector<HTMLButtonElement>('#matchup-return-lobby')?.addEventListener('click', () => this.openReturnLobbyConfirm());
    this.ui.querySelectorAll<HTMLElement>('[data-watch-match]').forEach((card) => {
      card.addEventListener('click', () => this.openSpectator(card.dataset.watchMatch!));
    });
    this.ui.querySelectorAll<HTMLElement>('[data-own-game]').forEach((card) => {
      card.addEventListener('click', () => this.scene.start('BowlingScene'));
    });
    this.setupLaneNavigation();
    this.setupLeaderboardNavigation();
    this.updateCountdown();
  }

  private setupLaneNavigation(): void {
    if (!this.ui) return;
    const track = this.ui.querySelector<HTMLDivElement>('#lane-track');
    const previous = this.ui.querySelector<HTMLButtonElement>('#lane-prev');
    const next = this.ui.querySelector<HTMLButtonElement>('#lane-next');
    if (!track || !previous || !next) return;

    const updateButtons = () => {
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      previous.disabled = maxScroll < 2 || track.scrollLeft <= 2;
      next.disabled = maxScroll < 2 || track.scrollLeft >= maxScroll - 2;
    };

    const moveOneLane = (direction: -1 | 1) => {
      const cards = Array.from(track.querySelectorAll<HTMLElement>('.lane-card'));
      if (cards.length === 0) return;
      const trackRect = track.getBoundingClientRect();
      const currentCentre = track.scrollLeft + track.clientWidth / 2;
      const centres = cards.map((card) =>
        card.getBoundingClientRect().left - trackRect.left + track.scrollLeft + card.clientWidth / 2
      );
      const targetCentre = direction > 0
        ? centres.find((centre) => centre > currentCentre + 10) ?? centres[centres.length - 1]
        : [...centres].reverse().find((centre) => centre < currentCentre - 10) ?? centres[0];
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      const targetLeft = Math.max(0, Math.min(maxScroll, targetCentre - track.clientWidth / 2));
      track.scrollTo({ left: targetLeft, behavior: 'smooth' });
    };

    previous.addEventListener('click', () => moveOneLane(-1));
    next.addEventListener('click', () => moveOneLane(1));
    track.addEventListener('scroll', () => {
      this.laneScrollLeft = track.scrollLeft;
      updateButtons();
    }, { passive: true });

    requestAnimationFrame(() => {
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      track.scrollLeft = Math.max(0, Math.min(maxScroll, this.laneScrollLeft));
      updateButtons();
    });
  }

  private setupLeaderboardNavigation(): void {
    if (!this.ui) return;
    const list = this.ui.querySelector<HTMLDivElement>('#leaderboard-list');
    const up = this.ui.querySelector<HTMLButtonElement>('#leaderboard-up');
    const down = this.ui.querySelector<HTMLButtonElement>('#leaderboard-down');
    const range = this.ui.querySelector<HTMLElement>('#leaderboard-range');
    if (!list || !up || !down || !range) return;

    const rows = Array.from(list.querySelectorAll<HTMLElement>('.leaderboard-row'));

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

    const movePage = (direction: -1 | 1) => {
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

  private openSpectator(matchId: string): void {
    const live = appState.tournament?.matches.find((match) => match.id === matchId);
    if (!live || live.complete || !live.playerB) return;
    appState.spectatingMatchId = matchId;
    network.watchMatch(matchId);
    this.scene.start('LiveSpectatorScene');
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

  private updateCountdown(): void {
    if (!appState.matchupEndsAt || !this.ui) return;
    const el = this.ui.querySelector<HTMLElement>('#match-countdown');
    if (!el) return;
    el.textContent = `${Math.max(0, Math.ceil((appState.matchupEndsAt - Date.now()) / 1000))}`;
  }

  private centerMyLane(): void {
    requestAnimationFrame(() => {
      if (!this.ui) return;
      const myLane = appState.matchups.find((match) => isMyMatch(match));
      const track = this.ui.querySelector<HTMLDivElement>('#lane-track');
      const myCard = myLane ? this.ui.querySelector<HTMLElement>(`[data-lane="${myLane.lane}"]`) : null;
      if (track && myCard) track.scrollTo({ left: Math.max(0, myCard.offsetLeft - (track.clientWidth - myCard.clientWidth) / 2), behavior: 'smooth' });
    });
  }
}

function liveStateFor(matchId: string): LaneMatchState | undefined {
  return appState.tournament?.matches.find((match) => match.id === matchId);
}

function findMyLiveMatch(matches: LaneMatchState[]): LaneMatchState | undefined {
  return matches.find((match) => match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId);
}

function renderCountdownOverlay(match: LaneMatchup | undefined): string {
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

function isMyMatch(match: LaneMatchup): boolean {
  return match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId;
}

function renderLaneCard(match: LaneMatchup, live: LaneMatchState | undefined, isHost: boolean, canWatchOtherLanes: boolean): string {
  const mine = isMyMatch(match);
  const isLive = Boolean(live && !live.complete && match.playerB);
  const finished = Boolean(live?.complete);
  const ownActive = mine && isLive;
  const watchable = isLive && !ownActive && canWatchOtherLanes;
  const hostOwnGame = isHost && ownActive;
  const dataAttribute = watchable ? ` data-watch-match="${match.id}"` : hostOwnGame ? ` data-own-game="${match.id}"` : '';
  const action = watchable
    ? '<div class="lane-live-action"><span class="live-dot"></span> WATCH LIVE</div>'
    : hostOwnGame
      ? '<div class="lane-live-action own-game">🎳 RETURN TO GAME</div>'
      : isLive
        ? '<div class="lane-live-action playing"><span class="live-dot"></span> LIVE</div>'
        : finished
          ? '<div class="lane-live-action finished">✓ FINISHED</div>'
          : '';

  return `<article class="lane-card${mine ? ' me' : ''}${match.championship ? ' championship' : ''}${watchable || hostOwnGame ? ' watchable' : ''}${isLive ? ' live-lane' : ''}" data-lane="${match.lane}"${dataAttribute}>
    <div class="lane-label"><span>${match.championship ? 'CHAMPIONSHIP LANE' : `LANE ${match.lane}`}</span>${match.championship ? '<span class="crown">👑</span>' : ''}</div>
    ${action}
    <div class="vs-box">
      <div class="bowler-name">🎳 ${escapeHtml(match.playerA.name)}</div><div class="vs">VS</div>
      <div class="bowler-name">${match.playerB ? `🎳 ${escapeHtml(match.playerB.name)}` : '🦃 BYE'}</div>
    </div>
  </article>`;
}

function sortLeaderboard(room: RoomState) {
  return [...room.players].sort((a, b) => {
    if (a.id === room.championId && b.id !== room.championId) return -1;
    if (b.id === room.championId && a.id !== room.championId) return 1;
    return b.wins - a.wins || b.lane - a.lane || a.name.localeCompare(b.name);
  });
}

function renderReturnLobbyConfirm(): string {
  return `<div id="return-lobby-confirm" class="return-lobby-overlay">
    <section class="return-lobby-card panel" role="dialog" aria-modal="true" aria-labelledby="return-lobby-title">
      <div class="return-lobby-icon">⚠️</div><h2 id="return-lobby-title">Return everyone to the lobby?</h2>
      <p>This will <strong>cancel every bowling game currently in progress</strong>, clear the live lane results and wins leaderboard, and return all connected players to the lobby.</p>
      <div class="return-lobby-actions"><button id="return-lobby-no" class="secondary-btn" type="button">NO — KEEP PLAYING</button><button id="return-lobby-yes" class="danger-btn" type="button">YES — RETURN TO LOBBY</button></div>
    </section>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}
