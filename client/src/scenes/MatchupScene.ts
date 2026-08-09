import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { appState } from '../state';
import { network } from '../net/NetworkManager';
import type { LaneMatchup, RoomState } from '../types';

export class MatchupScene extends BaseBowlingScene {
  private cleanup: Array<() => void> = [];
  private countdownTimer = 0;
  private ui?: HTMLDivElement;

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
        appState.matchupEndsAt = 0;
        appState.tournament = null;
        appState.roundResult = null;
        this.scene.start('LobbyScene');
      }),
      network.on('bowlingStarted', (state) => {
        appState.room = state.room;
        appState.tournament = state;
        appState.roundResult = null;
        this.scene.start('BowlingScene');
      }),
      network.on('bowlingState', (state) => {
        appState.room = state.room;
        appState.tournament = state;
        // If the host deliberately opened the class matchup board during a live
        // game, keep them here until they choose RETURN TO MY GAME.
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
    const liveBowling = room.status === 'bowling';
    const firstRoundWaiting = room.status === 'matchup' && appState.matchupEndsAt === null;
    const autoCountdown = room.status === 'matchup' && appState.matchupEndsAt !== null;
    const leaderboard = sortLeaderboard(room);

    this.ui.innerHTML = `
      <div class="match-shell interactive">
        <div class="match-head panel">
          <div><h1 class="match-title">Lane Matchups</h1></div>
          <div class="match-head-actions">
            <div class="level-badge">LEVEL ${room.level}</div>
            ${isHost && liveBowling ? '<button id="return-game" class="host-nav-btn" type="button">🎳 RETURN TO MY GAME</button>' : ''}
            ${isHost ? '<button id="matchup-return-lobby" class="host-nav-btn return-lobby-trigger" type="button">↩ RETURN TO LOBBY</button>' : ''}
          </div>
        </div>

        <div class="match-board-layout">
          <section class="match-lanes-pane">
            <div class="lane-direction"><span>← LOWEST LANE</span><span>CHAMPIONSHIP LANE →</span></div>
            <div id="lane-track" class="lane-track">
              ${appState.matchups.map((match) => renderLaneCard(match)).join('')}
            </div>
          </section>

          <aside class="match-leaderboard panel">
            <div class="leaderboard-title-row"><h2>Wins Leaderboard</h2><span>LIVE STANDINGS</span></div>
            <div class="leaderboard-list">
              ${leaderboard.map((player, index) => `
                <div class="leaderboard-row${player.id === appState.playerId ? ' me' : ''}${player.id === room.championId ? ' champion' : ''}">
                  <span class="leaderboard-pos">${player.id === room.championId ? '👑' : index + 1}</span>
                  <span class="leaderboard-name">${escapeHtml(player.name)}</span>
                  <strong>${player.wins}</strong>
                </div>`).join('')}
            </div>
          </aside>
        </div>

        <div class="match-footer panel-lite">
          <div class="match-footer-copy">
            <strong>${myLane ? `You are on ${myLane.championship ? 'the Championship Lane' : `Lane ${myLane.lane}`}.` : ''}</strong>
            <span>${liveBowling ? 'Live matches are in progress.' : firstRoundWaiting ? 'The first matchups wait for the host. After that, every new matchup starts automatically after a 5-second countdown.' : 'Winners move right, losers move left, and each win adds 1 point.'}</span>
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
    this.updateCountdown();
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

function renderCountdownOverlay(match: LaneMatchup | undefined): string {
  if (!match) {
    return `<div class="matchup-countdown-overlay"><div class="matchup-countdown-card panel">
      <div class="eyebrow">NEW MATCHUPS</div>
      <div id="match-countdown" class="matchup-countdown-number">5</div>
      <div class="matchup-countdown-copy">Next bowling match starts automatically</div>
    </div></div>`;
  }

  const laneLabel = match.championship ? '👑 CHAMPIONSHIP LANE' : `LANE ${match.lane}`;
  const playerA = escapeHtml(match.playerA.name);
  const playerB = match.playerB ? escapeHtml(match.playerB.name) : null;

  return `<div class="matchup-countdown-overlay"><div class="matchup-countdown-card panel">
    <div class="eyebrow">NEW MATCHUPS</div>
    <div class="countdown-lane-label">${laneLabel}</div>
    <div class="countdown-matchup">
      <div class="countdown-player${match.playerA.id === appState.playerId ? ' me' : ''}">🎳 ${playerA}</div>
      ${playerB
        ? `<div class="countdown-vs">VS</div><div class="countdown-player${match.playerB?.id === appState.playerId ? ' me' : ''}">🎳 ${playerB}</div>`
        : '<div class="countdown-vs">BYE</div><div class="countdown-player bye">🦃 No opponent this round</div>'}
    </div>
    <div id="match-countdown" class="matchup-countdown-number">5</div>
    <div class="matchup-countdown-copy">${playerB ? 'Your next bowling match starts automatically' : 'Your bye is processed automatically'}</div>
  </div></div>`;
}

function isMyMatch(match: LaneMatchup): boolean {
  return match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId;
}

function renderLaneCard(match: LaneMatchup): string {
  const mine = isMyMatch(match);
  return `<article class="lane-card${mine ? ' me' : ''}${match.championship ? ' championship' : ''}" data-lane="${match.lane}">
    <div class="lane-label"><span>${match.championship ? 'CHAMPIONSHIP LANE' : `LANE ${match.lane}`}</span>${match.championship ? '<span class="crown">👑</span>' : ''}</div>
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
      <div class="return-lobby-icon">⚠️</div>
      <h2 id="return-lobby-title">Return everyone to the lobby?</h2>
      <p>This will <strong>cancel every bowling game currently in progress</strong>, clear the live lane results and wins leaderboard, and return all connected players to the lobby.</p>
      <div class="return-lobby-actions"><button id="return-lobby-no" class="secondary-btn" type="button">NO — KEEP PLAYING</button><button id="return-lobby-yes" class="danger-btn" type="button">YES — RETURN TO LOBBY</button></div>
    </section>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}
