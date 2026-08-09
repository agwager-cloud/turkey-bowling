export type GameLevel = 1 | 2 | 3;
export type RoomStatus = 'lobby' | 'matchup' | 'bowling' | 'round_result' | 'final_result';

export interface PlayerSummary {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  lane: number;
  wins: number;
  losses: number;
}

export interface RoomState {
  code: string;
  level: GameLevel;
  players: PlayerSummary[];
  maxPlayers: number;
  status: RoomStatus;
  round: number;
  totalRounds: number;
  championId: string | null;
}

export interface LaneMatchup {
  id: string;
  lane: number;
  playerA: PlayerSummary;
  playerB: PlayerSummary | null;
  championship: boolean;
}


export interface SpectatorShot {
  matchId: string;
  playerId: string;
  playerName: string;
  standingPins: number[];
  startPosition: number;
  aim: number;
  hook: number;
  power: number;
  releaseTiming: number;
  releaseInGreen: boolean;
  seed: number;
}

export interface SpectatorShotResult {
  matchId: string;
  playerId: string;
  knockedPins: number[];
  speedKmh: number;
  gutter: boolean;
}

export interface BowlerScorecard {
  playerId: string;
  frames: number[][];
  frameScores: Array<number | null>;
  cumulative: Array<number | null>;
  total: number | null;
  rawTotal: number | null;
  finalScore: number | null;
  mathTimeouts: number;
  penaltyPercent: number;
  mathEndsAt: number | null;
  currentFrame: number;
  complete: boolean;
  standingPins: number[];
  pendingMathFrames: number[];
  mathAttempts: number[];
}

export interface LaneMatchState extends LaneMatchup {
  games: BowlerScorecard[];
  currentPlayerId: string | null;
  complete: boolean;
  winnerId: string | null;
  loserId: string | null;
  tieBreak: boolean;
  turnEndsAt: number | null;
}

export interface TournamentState {
  room: RoomState;
  round: number;
  totalRounds: number;
  matches: LaneMatchState[];
}

export interface Movement {
  playerId: string;
  oldLane: number;
  newLane: number;
  outcome: 'win' | 'loss' | 'bye';
}

export interface RoundResultState extends TournamentState {
  finalRound: boolean;
  phaseEndsAt: number;
  movements: Movement[];
}

export interface FinalStanding {
  position: number;
  player: PlayerSummary;
  lane: number;
  wins: number;
  losses: number;
  finalScore: number | null;
  champion: boolean;
}

export interface FinalResultsState {
  room: RoomState;
  championId: string | null;
  standings: FinalStanding[];
}

export type ServerMessage =
  | { type: 'hello' }
  | { type: 'room_joined'; playerId: string; room: RoomState; matchups?: LaneMatchup[]; phaseEndsAt?: number | null; tournament?: TournamentState; roundResult?: RoundResultState }
  | { type: 'room_state'; room: RoomState }
  | { type: 'match_started'; room: RoomState; round: number; totalRounds: number; phaseEndsAt: number | null; matchups: LaneMatchup[] }
  | ({ type: 'bowling_started' | 'bowling_state' } & TournamentState)
  | ({ type: 'round_complete' } & RoundResultState)
  | ({ type: 'final_results' } & FinalResultsState)
  | { type: 'score_feedback'; correct: boolean; frameIndex: number; message: string }
  | { type: 'spectator_shot'; shot: SpectatorShot }
  | { type: 'spectator_shot_result'; result: SpectatorShotResult }
  | { type: 'error'; code: string; message: string }
  | { type: 'kicked'; message: string };
