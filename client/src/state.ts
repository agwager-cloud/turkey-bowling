import type { FinalResultsState, LaneMatchup, RoomState, RoundResultState, TournamentState } from './types';

class AppState {
  playerId = '';
  playerName = '';
  room: RoomState | null = null;
  matchups: LaneMatchup[] = [];
  matchupEndsAt = 0;
  tournament: TournamentState | null = null;
  roundResult: RoundResultState | null = null;
  finalResults: FinalResultsState | null = null;

  resetRoom(): void {
    this.playerId = '';
    this.playerName = '';
    this.room = null;
    this.matchups = [];
    this.matchupEndsAt = 0;
    this.tournament = null;
    this.roundResult = null;
    this.finalResults = null;
  }
}

export const appState = new AppState();
