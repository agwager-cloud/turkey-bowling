import type { FinalResultsState, LaneMatchup, RoomState, RoundResultState, TournamentState } from './types';

class AppState {
  playerId = '';
  playerName = '';
  room: RoomState | null = null;
  matchups: LaneMatchup[] = [];
  matchupEndsAt: number | null = null;
  tournament: TournamentState | null = null;
  roundResult: RoundResultState | null = null;
  finalResults: FinalResultsState | null = null;
  spectatingMatchId: string | null = null;

  resetRoom(): void {
    this.playerId = '';
    this.playerName = '';
    this.room = null;
    this.matchups = [];
    this.matchupEndsAt = null;
    this.tournament = null;
    this.roundResult = null;
    this.finalResults = null;
    this.spectatingMatchId = null;
  }
}

export const appState = new AppState();
