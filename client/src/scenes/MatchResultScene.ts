import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { appState } from '../state';
import { network } from '../net/NetworkManager';
import type { LaneMatchState, RoundResultState, TournamentState } from '../types';

export class MatchResultScene extends BaseBowlingScene {
  private cleanup: Array<() => void> = [];
  private ui?: HTMLDivElement;
  private ticker = 0;

  constructor() { super('MatchResultScene'); }

  create(): void {
    this.setupBaseScene();
    if (!appState.tournament) return void this.scene.start('LobbyScene');
    this.ui = createSceneUi();
    this.render(appState.tournament, appState.roundResult);
    this.ticker = window.setInterval(() => this.render(appState.tournament!, appState.roundResult), 250);

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
      network.on('bowlingState', (state) => {
        appState.room = state.room;
        appState.tournament = state;
        this.render(state, appState.roundResult);
      }),
      network.on('roundComplete', (result) => {
        appState.room = result.room;
        appState.tournament = result;
        appState.roundResult = result;
        this.render(result, result);
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
      network.on('error', ({ message }) => alert(message))
    );
    this.events.once('shutdown', () => {
      window.clearInterval(this.ticker);
      this.cleanup.splice(0).forEach((fn) => fn());
    });
  }

  private render(state: TournamentState, roundResult: RoundResultState | null): void {
    if (!this.ui) return;
    const match = findMyMatch(state);
    if (!match) return;
    const mine = match.games.find((g) => g.playerId === appState.playerId);
    const opponent = match.playerA.id === appState.playerId ? match.playerB : match.playerA;
    const theirs = opponent ? match.games.find((g) => g.playerId === opponent.id) : null;
    const won = match.winnerId === appState.playerId;
    const bye = !match.playerB;
    const wonByForfeit = Boolean(match.forfeitPlayerId && match.forfeitPlayerId !== appState.playerId && won);
    const lostByForfeit = match.forfeitPlayerId === appState.playerId;
    const movement = roundResult?.movements.find((m) => m.playerId === appState.playerId);
    const waiting = !roundResult;
    const seconds = roundResult ? Math.max(0, Math.ceil((roundResult.phaseEndsAt - Date.now()) / 1000)) : null;
    const movementText = movement ? laneMovementText(movement.oldLane, movement.newLane, match.championship) : '';
    const me = state.room.players.find((p) => p.id === appState.playerId);
    const isHost = Boolean(me?.isHost);
    const liveMatchesRemaining = waiting ? state.matches.filter((candidate) => !candidate.complete && Boolean(candidate.playerB)).length : 0;
    const mineRaw = mine?.rawTotal ?? mine?.total ?? 0;
    const mineFinal = mine?.finalScore ?? mineRaw;
    const theirsRaw = theirs?.rawTotal ?? theirs?.total ?? 0;
    const theirsFinal = theirs?.finalScore ?? theirsRaw;

    this.ui.innerHTML = `
      <div class="result-shell interactive">
        <section class="result-card panel ${won || bye ? 'win-card' : 'loss-card'}">
          <div class="result-kicker">MATCH RESULT</div>
          <div class="result-icon">${bye ? '🦃' : wonByForfeit ? '📡🏆' : lostByForfeit ? '📡' : won ? '🏆' : '🎳'}</div>
          <h1>${bye ? 'Automatic Bye Win' : wonByForfeit ? 'Won by Forfeit' : lostByForfeit ? 'Match Forfeited' : won ? 'You Won!' : 'Match Complete'}</h1>
          ${wonByForfeit ? '<div class="forfeit-result-note">Your opponent did not reconnect within 20 seconds. You receive the match win.</div>' : lostByForfeit ? '<div class="forfeit-result-note">The 20-second reconnect window expired.</div>' : ''}
          ${wonByForfeit || lostByForfeit
            ? `<div class="forfeit-score-summary"><strong>${wonByForfeit ? escapeHtml(appState.playerName) : escapeHtml(opponent?.name ?? 'Opponent')}</strong><span>WIN BY FORFEIT</span><em>20-second reconnect window expired</em></div>`
            : `<div class="final-score-heading">FINAL SCORE</div>
              <div class="result-scoreline penalty-scoreline">
                ${renderFinalScoreSide(appState.playerName, mineRaw, mineFinal, mine?.mathTimeouts ?? 0, mine?.penaltyPercent ?? 0, true)}
                <em>VS</em>
                ${renderFinalScoreSide(opponent?.name ?? 'BYE', theirsRaw, theirsFinal, theirs?.mathTimeouts ?? 0, theirs?.penaltyPercent ?? 0, false)}
              </div>`}
          ${match.tieBreak ? '<div class="tie-note">Final scores were tied. This prototype used a temporary random lane tie-break; a proper roll-off can replace it later.</div>' : ''}
          <div class="movement-box ${movement ? 'ready' : ''}">
            ${waiting ? '<strong>Final score locked</strong><small>Waiting for the other lanes to finish…</small>' : `<div class="result-countdown"><span>NEXT MATCHUPS IN</span><strong>${seconds}</strong><small>seconds</small></div><strong>${movementText}</strong>`}
          </div>
          <div class="result-record">Wins leaderboard score: <strong>${me?.wins ?? 0}</strong> • Each match win adds 1 point.</div>
          ${(waiting && liveMatchesRemaining > 0) || isHost ? `<div class="result-host-actions">${waiting && liveMatchesRemaining > 0 ? `<button id="result-matchups" class="secondary-btn result-nav-btn live-watch-result-btn" type="button">👁 WATCH LIVE MATCHES (${liveMatchesRemaining})</button>` : ''}${isHost ? '<button id="result-return-lobby" class="danger-btn result-nav-btn" type="button">↩ RETURN TO LOBBY</button>' : ''}</div>` : ''}
        </section>
      </div>`;

    this.ui.querySelector<HTMLButtonElement>('#result-matchups')?.addEventListener('click', () => this.scene.start('MatchupScene'));
    this.ui.querySelector<HTMLButtonElement>('#result-return-lobby')?.addEventListener('click', () => this.openReturnLobbyConfirm());
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
}

function findMyMatch(state: TournamentState): LaneMatchState | undefined {
  return state.matches.find((match) => match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId);
}

function laneMovementText(oldLane: number, newLane: number, championship: boolean): string {
  if (newLane > oldLane) return `⬆ PROMOTED: Lane ${oldLane} → ${newLane}${championship ? ' • Championship defended!' : ''}`;
  if (newLane < oldLane) return `⬇ RELEGATED: Lane ${oldLane} → ${newLane}`;
  if (championship) return '👑 Staying on the Championship Lane';
  return `↔ Staying on Lane ${oldLane}`;
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

function renderFinalScoreSide(name: string, raw: number, finalScore: number, timeouts: number, penaltyPercent: number, me: boolean): string {
  const penaltyPoints = Math.max(0, raw - finalScore);
  const penalty = penaltyPercent > 0
    ? `<div class="score-penalty"><span>Bowling score <b>${raw}</b></span><span>${timeouts} math timeout${timeouts === 1 ? '' : 's'} × 5% = <b>-${penaltyPercent}%</b></span><span>Penalty <b>-${penaltyPoints} pts</b></span></div>`
    : '<div class="score-penalty clean"><span>No maths penalties</span></div>';
  return `<div class="final-score-side${me ? ' me' : ''}"><span class="final-score-name">${escapeHtml(name)}</span><strong class="final-score-number">${finalScore}</strong>${penalty}</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}
