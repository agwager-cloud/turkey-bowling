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
        appState.matchups = state.matches;
        const activeMatch = findActiveMyMatch(state);
        if (activeMatch) {
          this.scene.start('BowlingScene');
          return;
        }
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
    const hostRemovedForfeit = Boolean(match.forfeitPlayerId && !state.room.players.some((player) => player.id === match.forfeitPlayerId));
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
          <div class="result-kicker">${match.tieBreak ? '🔥 BOWL-OFF RESULT' : 'MATCH RESULT'}</div>
          <div class="result-icon">${bye ? '🦃' : wonByForfeit ? '📡🏆' : lostByForfeit ? '📡' : match.tieBreak && won ? '🔥🏆' : match.tieBreak ? '🔥🎳' : won ? '🏆' : '🎳'}</div>
          <h1>${bye ? 'Automatic Bye Win' : wonByForfeit ? 'Won by Forfeit' : lostByForfeit ? 'Match Forfeited' : match.tieBreak && won ? 'Bowl-Off Victory!' : match.tieBreak ? 'Bowl-Off Decided' : won ? 'You Won!' : 'Match Complete'}</h1>
          ${wonByForfeit ? `<div class="forfeit-result-note">${hostRemovedForfeit ? 'The host removed your opponent from the room. You receive the match win.' : 'Your opponent did not reconnect within 20 seconds. You receive the match win.'}</div>` : lostByForfeit ? `<div class="forfeit-result-note">${hostRemovedForfeit ? 'The host removed this player from the room.' : 'The 20-second reconnect window expired.'}</div>` : ''}
          ${wonByForfeit || lostByForfeit
            ? `<div class="forfeit-score-summary"><strong>${wonByForfeit ? escapeHtml(appState.playerName) : escapeHtml(opponent?.name ?? 'Opponent')}</strong><span>WIN BY FORFEIT</span><em>${hostRemovedForfeit ? 'Player removed by host' : '20-second reconnect window expired'}</em></div>`
            : `<div class="final-score-heading">FINAL SCORE</div>
              <div class="result-scoreline penalty-scoreline">
                ${renderFinalScoreSide(appState.playerName, mineRaw, mineFinal, mine?.mathTimeouts ?? 0, mine?.penaltyPercent ?? 0, true)}
                <em>VS</em>
                ${renderFinalScoreSide(opponent?.name ?? 'BYE', theirsRaw, theirsFinal, theirs?.mathTimeouts ?? 0, theirs?.penaltyPercent ?? 0, false)}
              </div>`}
          ${match.tieBreak ? renderBowlOffResult(match) : ''}
          <div class="movement-box ${movement ? 'ready' : ''}">
            ${waiting ? '<strong>Final score locked</strong><small>Waiting for the other lanes to finish…</small>' : `<div class="result-countdown"><span>NEXT MATCHUPS IN</span><strong>${seconds}</strong><small>seconds</small></div><strong>${movementText}</strong>`}
          </div>
          <div class="result-record">Wins leaderboard score: <strong>${me?.wins ?? 0}</strong> • Each match win adds 1 point.</div>
          ${isHost || (waiting && liveMatchesRemaining > 0) ? `<div class="result-host-actions">${isHost ? '<button id="result-class-matchups" class="secondary-btn result-nav-btn" type="button">↩ RETURN TO CLASS MATCHUPS</button>' : `<button id="result-matchups" class="secondary-btn result-nav-btn live-watch-result-btn" type="button">👁 WATCH LIVE MATCHES (${liveMatchesRemaining})</button>`}</div>` : ''}
        </section>
      </div>`;

    this.ui.querySelector<HTMLButtonElement>('#result-matchups')?.addEventListener('click', () => this.scene.start('MatchupScene'));
    this.ui.querySelector<HTMLButtonElement>('#result-class-matchups')?.addEventListener('click', () => this.scene.start('MatchupScene'));
  }
}

function findMyMatch(state: TournamentState): LaneMatchState | undefined {
  return findActiveMyMatch(state)
    ?? state.matches
      .filter((match) => match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
}

function findActiveMyMatch(state: TournamentState): LaneMatchState | undefined {
  return state.matches
    .filter((match) => !match.complete && (match.playerA.id === appState.playerId || match.playerB?.id === appState.playerId))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

function renderBowlOffResult(match: LaneMatchState): string {
  const rounds = match.bowlOffHistory ?? [];
  const last = rounds[rounds.length - 1];
  const winnerName = match.winnerId === match.playerA.id ? match.playerA.name : match.playerB?.name ?? 'Winner';
  const roundSummary = rounds.length
    ? rounds.map((round) => `<span>R${round.round}: <b>${escapeHtml(match.playerA.name)} ${round.playerAScore}–${round.playerBScore} ${escapeHtml(match.playerB?.name ?? 'Opponent')}</b></span>`).join('')
    : '<span>Bowl-Off result recorded.</span>';
  return `<div class="bowl-off-result-note">
    <strong>🔥 TIED AFTER 10 FRAMES — DECIDED BY BOWL-OFF</strong>
    <div class="bowl-off-result-rounds">${roundSummary}</div>
    <em>${last ? `${escapeHtml(winnerName)} won Bowl-Off Round ${last.round}.` : `${escapeHtml(winnerName)} won the Bowl-Off.`} The official 10-frame scores stay unchanged.</em>
  </div>`;
}

function laneMovementText(oldLane: number, newLane: number, championship: boolean): string {
  if (newLane > oldLane) return `⬆ PROMOTED: Lane ${oldLane} → ${newLane}${championship ? ' • Championship defended!' : ''}`;
  if (newLane < oldLane) return `⬇ RELEGATED: Lane ${oldLane} → ${newLane}`;
  if (championship) return '👑 Staying on the Championship Lane';
  return `↔ Staying on Lane ${oldLane}`;
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
