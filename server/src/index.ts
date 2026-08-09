import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

type GameLevel = 1 | 2 | 3;
type RoomStatus = 'lobby' | 'matchup' | 'bowling' | 'round_result' | 'final_result';

type ShotVisualInput = {
  startPosition: number;
  aim: number;
  hook: number;
  power: number;
  releaseTiming: number;
  releaseInGreen: boolean;
  seed: number;
};


type ClientMessage =
  | { type: 'create_room'; name: string; level: GameLevel; deviceId: string }
  | { type: 'join_room'; name: string; roomCode: string; deviceId: string }
  | { type: 'set_level'; level: GameLevel }
  | { type: 'kick_player'; playerId: string }
  | { type: 'start_match' }
  | { type: 'begin_round' }
  | { type: 'return_to_lobby' }
  | { type: 'shot_started'; shot: ShotVisualInput }
  | { type: 'roll_ball'; knockedPins?: number[]; speedKmh?: number; gutter?: boolean }
  | { type: 'submit_score'; frameIndex: number; total: number }
  | { type: 'watch_match'; matchId: string }
  | { type: 'stop_watching_match' }
  | { type: 'dev_finish_round' };

interface Player {
  id: string;
  name: string;
  normalizedName: string;
  deviceId: string;
  isHost: boolean;
  isBot: boolean;
  socket: WebSocket | null;
  joinedAt: number;
  ladderRank: number;
  wins: number;
  losses: number;
  watchingMatchId: string | null;
  disconnectEndsAt: number | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

interface BowlerGame {
  playerId: string;
  frames: number[][];
  currentFrame: number;
  complete: boolean;
  standingPins: number[];
  verifiedCumulative: Array<number | null>;
  pendingMathFrames: number[];
  mathEndsAt: number | null;
  mathTimeouts: number;
  mathAttempts: number[];
  pausedMathRemainingMs: number | null;
}

interface LaneMatch {
  id: string;
  lane: number;
  championship: boolean;
  playerAId: string;
  playerBId: string | null;
  games: Map<string, BowlerGame>;
  currentPlayerId: string | null;
  complete: boolean;
  winnerId: string | null;
  loserId: string | null;
  tieBreak: boolean;
  turnEndsAt: number | null;
  shotInMotion: boolean;
  disconnectedPlayerId: string | null;
  reconnectEndsAt: number | null;
  pausedTurnRemainingMs: number | null;
  forfeitPlayerId: string | null;
}

interface Movement {
  playerId: string;
  oldLane: number;
  newLane: number;
  outcome: 'win' | 'loss' | 'bye';
}

interface Room {
  code: string;
  level: GameLevel;
  players: Player[];
  maxPlayers: number;
  status: RoomStatus;
  kickedNames: Set<string>;
  round: number;
  totalRounds: number;
  matches: LaneMatch[];
  pendingMatches: LaneMatch[];
  phaseEndsAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  botTimer: ReturnType<typeof setTimeout> | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  mathTimer: ReturnType<typeof setTimeout> | null;
  lastMovements: Movement[];
  championId: string | null;
}

const PORT = Number(process.env.PORT || 8080);
const MATCH_RESULT_HOLD_MS = 10000;
const AUTO_MATCHUP_COUNTDOWN_MS = 5000;
const SHOT_CLOCK_MS = 15000;
const SHOT_RESULT_GRACE_MS = 6000;
const LEVEL_2_MATH_MS = 20000;
const LEVEL_3_MATH_MS = 30000;
const MATH_PENALTY_PERCENT = 5;
const DISCONNECT_GRACE_MS = 20000;
const WEBSOCKET_HEARTBEAT_MS = 25000;
const rooms = new Map<string, Room>();
const membership = new Map<WebSocket, { roomCode: string; playerId: string }>();

const httpServer = createServer((_req, res) => {
  // Informational only. The client connects directly by WebSocket and never requires a /health check.
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Turkey Bowling WebSocket server');
});

const wss = new WebSocketServer({ server: httpServer });

type LiveSocket = WebSocket & { isAlive?: boolean };

const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((rawSocket) => {
    const socket = rawSocket as LiveSocket;
    if (socket.isAlive === false) {
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  });
}, WEBSOCKET_HEARTBEAT_MS);


wss.on('close', () => clearInterval(heartbeatTimer));

wss.on('connection', (socket) => {
  const liveSocket = socket as LiveSocket;
  liveSocket.isAlive = true;
  liveSocket.on('pong', () => { liveSocket.isAlive = true; });
  send(socket, { type: 'hello' });

  socket.on('message', (data) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return sendError(socket, 'BAD_MESSAGE', 'The server received an invalid message.');
    }

    switch (message.type) {
      case 'create_room': createRoom(socket, message.name, message.deviceId, message.level); break;
      case 'join_room': joinRoom(socket, message.name, message.deviceId, message.roomCode); break;
      case 'set_level': setLevel(socket, message.level); break;
      case 'kick_player': kickPlayer(socket, message.playerId); break;
      case 'start_match': startTournament(socket); break;
      case 'begin_round': beginRound(socket); break;
      case 'return_to_lobby': returnToLobby(socket); break;
      case 'shot_started': shotStarted(socket, message.shot); break;
      case 'roll_ball': rollBall(socket, message.knockedPins, message.speedKmh, message.gutter); break;
      case 'submit_score': submitScore(socket, message.frameIndex, message.total); break;
      case 'watch_match': watchMatch(socket, message.matchId); break;
      case 'stop_watching_match': stopWatchingMatch(socket); break;
      case 'dev_finish_round': devFinishRound(socket); break;
    }
  });

  socket.on('close', () => removeSocket(socket));
  socket.on('error', () => removeSocket(socket));
});

function createRoom(socket: WebSocket, rawName: string, deviceId: string, rawLevel: GameLevel): void {
  if (membership.has(socket)) return sendError(socket, 'ALREADY_JOINED', 'This tab is already in a room.');
  const name = cleanName(rawName);
  if (!validName(name)) return sendError(socket, 'BAD_NAME', 'Use a name between 2 and 18 characters.');
  if (!deviceId) return sendError(socket, 'NO_DEVICE', 'This device could not be identified.');

  const code = createRoomCode();
  const player = makePlayer(socket, name, deviceId, true);
  const room: Room = {
    code,
    level: isLevel(rawLevel) ? rawLevel : 1,
    players: [player],
    maxPlayers: 40,
    status: 'lobby',
    kickedNames: new Set(),
    round: 0,
    totalRounds: 0,
    matches: [],
    pendingMatches: [],
    phaseEndsAt: null,
    timer: null,
    botTimer: null,
    turnTimer: null,
    mathTimer: null,
    lastMovements: [],
    championId: null
  };
  rooms.set(code, room);
  membership.set(socket, { roomCode: code, playerId: player.id });
  send(socket, roomJoinedPayload(room, player.id));
}

function joinRoom(socket: WebSocket, rawName: string, deviceId: string, rawCode: string): void {
  if (membership.has(socket)) return sendError(socket, 'ALREADY_JOINED', 'This tab is already in a room.');
  const code = String(rawCode || '').replace(/\D/g, '').slice(0, 5);
  const room = rooms.get(code);
  if (!room) return sendError(socket, 'ROOM_NOT_FOUND', 'That room code does not exist.');
  if (room.status === 'final_result') return sendError(socket, 'MATCH_FINISHED', 'That class game has already finished.');

  const name = cleanName(rawName);
  const normalized = normalizeName(name);
  if (!validName(name)) return sendError(socket, 'BAD_NAME', 'Use a name between 2 and 18 characters.');
  if (room.kickedNames.has(normalized)) return sendError(socket, 'CHANGE_NAME', 'You were removed from this room. Change your name before rejoining.');

  // Reconnect the same student/device to their existing room identity. During
  // the 20-second active-match grace period this resumes the exact lane state;
  // after a forfeit it simply returns them as a waiting player for the next cycle.
  const reconnecting = room.players.find((player) => !player.isBot && !player.socket && player.normalizedName === normalized && player.deviceId === deviceId);
  if (reconnecting) {
    reconnectPlayer(room, reconnecting, socket);
    send(socket, roomJoinedPayload(room, reconnecting.id));
    if (room.status === 'lobby') broadcastRoom(room);
    else if (room.status === 'bowling') broadcastBowling(room, 'bowling_state');
    else broadcastRoom(room);
    return;
  }

  if (room.players.length >= room.maxPlayers) return sendError(socket, 'ROOM_FULL', 'That room is full.');
  if (room.players.some((player) => player.normalizedName === normalized)) return sendError(socket, 'DUPLICATE_NAME', 'That name is already being used in this room.');
  if (room.players.some((player) => player.deviceId === deviceId)) return sendError(socket, 'DUPLICATE_DEVICE', 'Only one player account can join this room from the same device.');

  const player = makePlayer(socket, name, deviceId, false);
  room.players.push(player);
  membership.set(socket, { roomCode: code, playerId: player.id });

  // A student may join after the ladder has started. They are not inserted into
  // an active LaneMatch; they arrive on Class Matchups as a spectator and are
  // included by the next matchmaking cycle. If the class is already on the
  // result hold, rebuild the pending pairings so the late joiner is included in
  // the immediately upcoming set rather than waiting an extra full game.
  if (room.status === 'round_result' && room.pendingMatches.length > 0) {
    const ordered = [...room.players].sort((a, b) => a.ladderRank - b.ladderRank || a.joinedAt - b.joinedAt);
    room.pendingMatches = createMatchesFromOrderedPlayers(room, ordered);
    setRanksFromMatches(room, room.pendingMatches);
  }

  send(socket, roomJoinedPayload(room, player.id));
  if (room.status === 'lobby') broadcastRoom(room);
  else if (room.status === 'bowling') broadcastBowling(room, 'bowling_state');
  else broadcastRoom(room);
}

function setLevel(socket: WebSocket, level: GameLevel): void {
  const context = getContext(socket);
  if (!context) return;
  if (!context.player.isHost) return sendError(socket, 'HOST_ONLY', 'Only the host can change the scoring level.');
  if (!isLevel(level)) return sendError(socket, 'BAD_LEVEL', 'Choose Level 1, 2, or 3.');
  if (context.room.status !== 'lobby') return;
  context.room.level = level;
  broadcastRoom(context.room);
}

function kickPlayer(socket: WebSocket, targetId: string): void {
  const context = getContext(socket);
  if (!context) return;
  if (!context.player.isHost) return sendError(socket, 'HOST_ONLY', 'Only the host can manage players.');
  if (context.room.status !== 'lobby') return sendError(socket, 'LOBBY_ONLY', 'Players can only be removed from the lobby in this prototype.');
  const target = context.room.players.find((player) => player.id === targetId);
  if (!target || target.isHost) return;

  if (!target.socket) return;
  context.room.kickedNames.add(target.normalizedName);
  send(target.socket, { type: 'kicked', message: 'The host removed you from the room. Change your name before rejoining.' });
  membership.delete(target.socket);
  context.room.players = context.room.players.filter((player) => player.id !== target.id);
  target.socket.close(4001, 'Removed by host');
  broadcastRoom(context.room);
}

function startTournament(socket: WebSocket): void {
  const context = getContext(socket);
  if (!context) return;
  const { room, player } = context;
  if (!player.isHost) return sendError(socket, 'HOST_ONLY', 'Only the host can create the first matchups.');
  if (room.status !== 'lobby') return;
  if (room.players.length === 1) room.players.push(makeBotPlayer());
  if (room.players.length < 2) return sendError(socket, 'NEED_PLAYERS', 'At least 2 players are required to create matchups.');

  room.players.forEach((p) => {
    p.wins = 0;
    p.losses = 0;
    p.ladderRank = 1;
  });
  room.championId = null;
  room.round = 1;
  // 0 is retained in the wire shape for compatibility with older clients;
  // the class ladder now has no round limit.
  room.totalRounds = 0;
  room.matches = createOpeningMatches(room);
  setRanksFromMatches(room, room.matches);
  beginMatchupPhase(room, false);
}

function beginMatchupPhase(room: Room, autoStart: boolean): void {
  clearRoomTimer(room);
  clearSpectatorSubscriptions(room);
  clearBotTimer(room);
  clearTurnTimer(room);
  clearMathTimer(room);
  room.status = 'matchup';
  room.phaseEndsAt = autoStart ? Date.now() + AUTO_MATCHUP_COUNTDOWN_MS : null;
  broadcast(room, {
    type: 'match_started',
    room: publicRoom(room),
    round: room.round,
    totalRounds: room.totalRounds,
    phaseEndsAt: room.phaseEndsAt,
    matchups: publicMatchups(room)
  });

  // The host starts Round 1 manually. Every later class matchup begins
  // automatically after everyone has had five seconds to view the new lanes.
  if (autoStart) {
    room.timer = setTimeout(() => {
      room.timer = null;
      beginBowling(room);
    }, AUTO_MATCHUP_COUNTDOWN_MS);
  }
}

function returnToLobby(socket: WebSocket): void {
  const context = getContext(socket);
  if (!context) return;
  const { room, player } = context;
  if (!player.isHost) return sendError(socket, 'HOST_ONLY', 'Only the host can return the class to the lobby.');
  if (room.status === 'lobby') return;

  // Cancel every active lane, countdown, bot action and shot clock. Returning
  // to the lobby is a clean class reset, but all connected human players remain
  // in the room so the teacher can immediately adjust the level or restart.
  clearRoomTimer(room);
  clearBotTimer(room);
  clearTurnTimer(room);
  clearMathTimer(room);
  clearSpectatorSubscriptions(room);
  room.players.forEach((candidate) => { if (candidate.disconnectTimer) clearTimeout(candidate.disconnectTimer); });
  room.players = room.players.filter((candidate) => !candidate.isBot && candidate.socket?.readyState === WebSocket.OPEN);
  room.players.forEach((candidate) => {
    candidate.wins = 0;
    candidate.losses = 0;
    candidate.ladderRank = 1;
  });
  room.status = 'lobby';
  room.round = 0;
  room.totalRounds = 0;
  room.matches = [];
  room.pendingMatches = [];
  room.phaseEndsAt = null;
  room.lastMovements = [];
  room.championId = null;
  broadcastRoom(room);
}

function beginRound(socket: WebSocket): void {
  const context = getContext(socket);
  if (!context) return;
  if (!context.player.isHost) return sendError(socket, 'HOST_ONLY', 'Only the host can start the bowling round.');
  if (context.room.status !== 'matchup') return sendError(socket, 'NOT_READY', 'The next matchups are not ready yet.');
  beginBowling(context.room);
}

function beginBowling(room: Room): void {
  if (!rooms.has(room.code) || room.status !== 'matchup') return;
  clearRoomTimer(room);
  room.status = 'bowling';
  room.phaseEndsAt = null;
  room.matches.forEach((match) => armMatchShotClock(room, match));
  broadcastBowling(room, 'bowling_started');
  scheduleTurnTimeout(room);
  scheduleMathTimeouts(room);
  if (room.matches.every((match) => match.complete)) scheduleFinishRound(room);
  else queueBotTurn(room);
}

function shotStarted(socket: WebSocket, rawShot: ShotVisualInput): void {
  const context = getContext(socket);
  if (!context) return;
  const { room, player } = context;
  if (room.status !== 'bowling') return;
  const match = room.matches.find((candidate) => candidate.playerAId === player.id || candidate.playerBId === player.id);
  if (!match || match.complete || match.disconnectedPlayerId || match.currentPlayerId !== player.id || match.shotInMotion) return;
  const game = match.games.get(player.id);
  if (matchHasPendingMath(match)) return sendError(socket, 'MATH_REQUIRED', 'Wait until the required score calculation is complete before the next bowl.');

  // The visible 15-second clock is for setting up and releasing the delivery.
  // Once released, allow enough time for the 2.5D animation to settle and report
  // its authoritative pin IDs without letting a broken client stall the class.
  match.shotInMotion = true;
  match.turnEndsAt = Date.now() + SHOT_RESULT_GRACE_MS;

  const shot = sanitizeShotVisual(rawShot);
  if (shot) {
    sendToMatchViewers(room, match, player.id, {
      type: 'spectator_shot',
      shot: {
        matchId: match.id,
        playerId: player.id,
        playerName: player.name,
        standingPins: [...(game?.standingPins ?? [])],
        ...shot
      }
    });
  }
  scheduleTurnTimeout(room);
}

function rollBall(socket: WebSocket, submittedKnockedPins?: number[], rawSpeedKmh?: number, rawGutter?: boolean): void {
  const context = getContext(socket);
  if (!context) return;
  const { room, player } = context;
  if (room.status !== 'bowling') return sendError(socket, 'NOT_BOWLING', 'Wait for the bowling round to begin.');
  const match = room.matches.find((candidate) => candidate.playerAId === player.id || candidate.playerBId === player.id);
  if (!match || match.complete) return;
  if (match.disconnectedPlayerId) return sendError(socket, 'OPPONENT_RECONNECTING', 'This lane is paused while the disconnected player has 20 seconds to rejoin.');
  if (match.currentPlayerId !== player.id) return sendError(socket, 'NOT_YOUR_TURN', 'Wait for your opponent to finish this frame.');
  const game = match.games.get(player.id);
  if (!game) return;
  if (matchHasPendingMath(match)) return sendError(socket, 'MATH_REQUIRED', 'Wait until the required score calculation is complete before the next bowl.');

  match.shotInMotion = false;
  const actualKnockedPins = sanitizeKnockedPins(game, submittedKnockedPins ?? []);
  const speedKmh = Number.isFinite(Number(rawSpeedKmh)) ? Math.max(0, Math.min(80, Number(rawSpeedKmh))) : 0;
  const gutter = Boolean(rawGutter);
  rollForPlayer(room, match, player.id, actualKnockedPins, room.level !== 1 && !player.isBot);
  sendToMatchViewers(room, match, player.id, {
    type: 'spectator_shot_result',
    result: { matchId: match.id, playerId: player.id, knockedPins: actualKnockedPins, speedKmh, gutter }
  });
  resolveMatchIfComplete(match);
  if (match.complete) clearWatchersForMatch(room, match.id);
  armMatchShotClock(room, match);
  broadcastBowling(room, 'bowling_state');
  scheduleTurnTimeout(room);
  scheduleMathTimeouts(room);
  if (room.matches.every((candidate) => candidate.complete)) scheduleFinishRound(room);
  else queueBotTurn(room);
}

function submitScore(socket: WebSocket, rawFrameIndex: number, rawTotal: number): void {
  const context = getContext(socket);
  if (!context) return;
  const { room, player } = context;
  if (room.level === 1) return sendError(socket, 'AUTO_SCORING', 'Level 1 scores automatically.');
  if (room.status !== 'bowling') return sendError(socket, 'NOT_BOWLING', 'Scoring is only available during the bowling match.');

  const match = room.matches.find((candidate) => candidate.playerAId === player.id || candidate.playerBId === player.id);
  const game = match?.games.get(player.id);
  if (!match || !game) return;
  if (match.disconnectedPlayerId) return sendError(socket, 'OPPONENT_RECONNECTING', 'This lane is paused while the disconnected player has 20 seconds to rejoin.');
  const expectedFrame = game.pendingMathFrames[0];
  if (expectedFrame === undefined) return sendError(socket, 'NO_SCORE_TASK', 'There is no score calculation waiting right now.');

  const frameIndex = Math.trunc(Number(rawFrameIndex));
  const total = Math.trunc(Number(rawTotal));
  if (frameIndex !== expectedFrame || !Number.isFinite(total) || total < 0 || total > 300) {
    return send(socket, { type: 'score_feedback', correct: false, frameIndex: expectedFrame, message: 'Check the score and try again.' });
  }

  const scored = scoreGame(game);
  const correctTotal = scored.cumulative[expectedFrame];
  if (correctTotal === null || total !== correctTotal) {
    game.mathAttempts.push(total);
    send(socket, { type: 'score_feedback', correct: false, frameIndex: expectedFrame, message: 'Not quite — check the bowling score and try again.' });
    broadcastBowling(room, 'bowling_state');
    return;
  }

  game.verifiedCumulative[expectedFrame] = correctTotal;
  game.pendingMathFrames.shift();
  armMathClock(room, game);
  send(socket, { type: 'score_feedback', correct: true, frameIndex: expectedFrame, message: 'Correct!' });

  resolveMatchIfComplete(match);
  // A lane is paused while either bowler has a required maths task. Once the
  // task is resolved, arm a fresh 15-second clock for whoever actually bowls
  // next (which may be the opponent rather than the player who did the maths).
  if (!match.complete && match.currentPlayerId) armMatchShotClock(room, match);
  broadcastBowling(room, 'bowling_state');
  scheduleTurnTimeout(room);
  scheduleMathTimeouts(room);
  if (room.matches.every((candidate) => candidate.complete)) scheduleFinishRound(room);
  else queueBotTurn(room);
}

function watchMatch(socket: WebSocket, rawMatchId: string): void {
  const context = getContext(socket);
  if (!context) return;
  const { room, player } = context;
  if (room.status !== 'bowling') return sendError(socket, 'NOT_BOWLING', 'Live spectating is available while bowling matches are in progress.');
  const matchId = String(rawMatchId || '');
  const watched = room.matches.find((match) => match.id === matchId);
  if (!watched || watched.complete || !watched.playerBId) return sendError(socket, 'MATCH_NOT_LIVE', 'That lane is no longer live.');

  const ownMatch = room.matches.find((match) => match.playerAId === player.id || match.playerBId === player.id);
  if (!player.isHost && ownMatch && !ownMatch.complete) {
    return sendError(socket, 'OWN_MATCH_ACTIVE', 'Your own bowling match is active. Return to your lane before spectating another match.');
  }

  player.watchingMatchId = watched.id;
}

function stopWatchingMatch(socket: WebSocket): void {
  const context = getContext(socket);
  if (!context) return;
  context.player.watchingMatchId = null;
}

function devFinishRound(socket: WebSocket): void {
  const context = getContext(socket);
  if (!context) return;
  if (!context.player.isHost) return sendError(socket, 'HOST_ONLY', 'Only the host can use the development auto-finish control.');
  if (context.room.status !== 'bowling') return;

  for (const match of context.room.matches) {
    let guard = 0;
    while (!match.complete && guard++ < 80) {
      if (!match.currentPlayerId) break;
      rollForPlayer(context.room, match, match.currentPlayerId, undefined, false);
      resolveMatchIfComplete(match);
    }
  }
  broadcastBowling(context.room, 'bowling_state');
  if (context.room.matches.every((match) => match.complete)) scheduleFinishRound(context.room);
}

function rollForPlayer(room: Room, match: LaneMatch, playerId: string, submittedKnockedPins?: number[], requiresMath = false): void {
  const game = match.games.get(playerId);
  if (!game || game.complete) return;

  const knockedPins = submittedKnockedPins
    ? sanitizeKnockedPins(game, submittedKnockedPins)
    : randomKnockedPins(game, testPinResult(game.standingPins.length));

  game.frames[game.currentFrame].push(knockedPins.length);
  if (knockedPins.length > 0) {
    const knockedSet = new Set(knockedPins);
    game.standingPins = game.standingPins.filter((pinId) => !knockedSet.has(pinId));
  }
  advanceGameIfNeeded(game);
  syncMathState(room, game, requiresMath);

  if (game.complete) {
    const opponentId = opponentOf(match, playerId);
    const opponentGame = opponentId ? match.games.get(opponentId) : null;
    match.currentPlayerId = opponentGame && !opponentGame.complete ? opponentId : null;
    return;
  }

  // Keep a bowler for the second/bonus ball of the same frame; alternate only when the frame ends.
  const frame = game.frames[game.currentFrame];
  if (frame.length === 0) {
    const opponentId = opponentOf(match, playerId);
    const opponentGame = opponentId ? match.games.get(opponentId) : null;
    match.currentPlayerId = opponentGame && !opponentGame.complete ? opponentId : playerId;
  } else {
    match.currentPlayerId = playerId;
  }
}

function sanitizeShotVisual(raw: ShotVisualInput | undefined): ShotVisualInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const finite = (value: unknown, min: number, max: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
  };
  const startPosition = finite(raw.startPosition, -1, 1);
  const aim = finite(raw.aim, -1, 1);
  const hook = finite(raw.hook, -1, 1);
  const power = finite(raw.power, 0, 1);
  const releaseTiming = finite(raw.releaseTiming, -1, 1);
  const seedNumber = Number(raw.seed);
  if ([startPosition, aim, hook, power, releaseTiming].some((value) => value === null) || !Number.isFinite(seedNumber)) return null;
  return {
    startPosition: startPosition!,
    aim: aim!,
    hook: hook!,
    power: power!,
    releaseTiming: releaseTiming!,
    releaseInGreen: Boolean(raw.releaseInGreen),
    seed: Math.trunc(seedNumber) >>> 0
  };
}

function sanitizeKnockedPins(game: BowlerGame, submitted: number[]): number[] {
  const standing = new Set(game.standingPins);
  const unique = new Set<number>();
  for (const value of submitted) {
    if (!Number.isInteger(value)) continue;
    const pinId = Number(value);
    if (pinId < 0 || pinId > 9 || !standing.has(pinId)) continue;
    unique.add(pinId);
  }
  return [...unique].sort((a, b) => a - b);
}

function randomKnockedPins(game: BowlerGame, count: number): number[] {
  const pool = [...game.standingPins];
  shuffle(pool);
  return pool.slice(0, Math.max(0, Math.min(pool.length, count))).sort((a, b) => a - b);
}

function resetRack(game: BowlerGame): void {
  game.standingPins = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
}

function advanceGameIfNeeded(game: BowlerGame): void {
  const i = game.currentFrame;
  const rolls = game.frames[i];

  if (i < 9) {
    const frameDone = rolls[0] === 10 || rolls.length >= 2;
    if (frameDone) {
      game.currentFrame++;
      game.frames[game.currentFrame] ??= [];
      resetRack(game);
    }
    return;
  }

  // 10th frame rack logic:
  // - strike on ball 1 -> fresh rack for ball 2
  // - strike on ball 2 after a strike -> fresh rack for ball 3
  // - spare on balls 1+2 -> fresh rack for ball 3
  // - otherwise the third ball (when earned) uses the pins left standing.
  const first = rolls[0];
  const second = rolls[1];

  if (rolls.length === 1) {
    if (first === 10) resetRack(game);
    return;
  }

  if (rolls.length === 2) {
    if (first === 10) {
      if (second === 10) resetRack(game);
      return;
    }
    if (first + second === 10) {
      resetRack(game);
      return;
    }
    game.complete = true;
    return;
  }

  if (rolls.length >= 3) game.complete = true;
}

function resolveMatchIfComplete(match: LaneMatch): void {
  if (match.complete || !match.playerBId) return;
  const a = match.games.get(match.playerAId)!;
  const b = match.games.get(match.playerBId)!;
  if (!a.complete || !b.complete || a.pendingMathFrames.length || b.pendingMathFrames.length) return;

  const aScore = adjustedGameScore(a);
  const bScore = adjustedGameScore(b);
  match.complete = true;
  match.currentPlayerId = null;
  if (aScore === bScore) {
    // Temporary flow-prototype tie-break. A proper bowling roll-off will replace this with the physics stage.
    match.tieBreak = true;
    match.winnerId = Math.random() < 0.5 ? match.playerAId : match.playerBId;
  } else {
    match.winnerId = aScore > bScore ? match.playerAId : match.playerBId;
  }
  match.loserId = match.winnerId === match.playerAId ? match.playerBId : match.playerAId;
}

function scheduleFinishRound(room: Room): void {
  if (room.status !== 'bowling' || room.timer) return;
  room.timer = setTimeout(() => finishRound(room), 900);
}

function finishRound(room: Room): void {
  if (!rooms.has(room.code) || room.status !== 'bowling') return;
  clearRoomTimer(room);
  clearBotTimer(room);
  clearTurnTimer(room);
  clearMathTimer(room);
  clearSpectatorSubscriptions(room);

  const targetRanks = new Map<string, number>();
  const oldLane = new Map<string, number>();
  const outcome = new Map<string, 'win' | 'loss' | 'bye'>();
  const maxLane = Math.max(1, room.matches.length);
  const championshipMatch = room.matches.find((match) => match.championship);
  if (championshipMatch?.winnerId) room.championId = championshipMatch.winnerId;

  for (const match of room.matches) {
    oldLane.set(match.playerAId, match.lane);
    if (!match.playerBId) {
      // A bye does not award a leaderboard point. Keep the player near their current lane.
      outcome.set(match.playerAId, 'bye');
      targetRanks.set(match.playerAId, match.lane);
      continue;
    }
    oldLane.set(match.playerBId, match.lane);
    if (match.winnerId) {
      outcome.set(match.winnerId, 'win');
      targetRanks.set(match.winnerId, Math.min(maxLane, match.lane + 1));
      const winner = findPlayer(room, match.winnerId);
      if (winner) winner.wins++;
    }
    if (match.loserId) {
      outcome.set(match.loserId, 'loss');
      targetRanks.set(match.loserId, Math.max(1, match.lane - 1));
      const loser = findPlayer(room, match.loserId);
      if (loser) loser.losses++;
    }
  }

  const rankedPlayers = [...room.players].sort((a, b) => {
    const rankDiff = (targetRanks.get(a.id) ?? a.ladderRank) - (targetRanks.get(b.id) ?? b.ladderRank);
    if (rankDiff !== 0) return rankDiff;
    const outcomeWeight = (id: string) => outcome.get(id) === 'loss' ? 0 : outcome.get(id) === 'bye' ? 1 : 2;
    return outcomeWeight(a.id) - outcomeWeight(b.id) || a.joinedAt - b.joinedAt;
  });

  room.pendingMatches = createMatchesFromOrderedPlayers(room, rankedPlayers);
  const newLane = new Map<string, number>();
  room.pendingMatches.forEach((match) => {
    newLane.set(match.playerAId, match.lane);
    if (match.playerBId) newLane.set(match.playerBId, match.lane);
  });

  room.lastMovements = room.players.map((player) => ({
    playerId: player.id,
    oldLane: oldLane.get(player.id) ?? player.ladderRank,
    newLane: newLane.get(player.id) ?? player.ladderRank,
    outcome: outcome.get(player.id) ?? 'bye'
  }));
  room.players.forEach((player) => { player.ladderRank = newLane.get(player.id) ?? player.ladderRank; });

  // Turkey Bowling is an open-ended classroom ladder. There is deliberately
  // no final round: the host decides when to stop the activity and can inspect
  // the live wins leaderboard between (or during) matches.
  const finalRound = false;
  room.status = 'round_result';
  room.phaseEndsAt = Date.now() + MATCH_RESULT_HOLD_MS;
  broadcast(room, {
    type: 'round_complete',
    room: publicRoom(room),
    round: room.round,
    totalRounds: room.totalRounds,
    finalRound,
    phaseEndsAt: room.phaseEndsAt,
    matches: publicMatches(room),
    movements: room.lastMovements
  });

  room.timer = setTimeout(() => {
    if (!rooms.has(room.code) || room.status !== 'round_result') return;
    clearRoomTimer(room);
    room.players = room.players.filter((player) => player.isBot || player.socket?.readyState === WebSocket.OPEN);
    if (room.players.length === 0 || room.players.every((player) => player.isBot)) {
      rooms.delete(room.code);
      return;
    }
    const ordered = [...room.players].sort((a, b) => a.ladderRank - b.ladderRank || a.joinedAt - b.joinedAt);
    room.pendingMatches = createMatchesFromOrderedPlayers(room, ordered);
    setRanksFromMatches(room, room.pendingMatches);
    room.round++;
    room.matches = room.pendingMatches;
    room.pendingMatches = [];
    beginMatchupPhase(room, true);
  }, MATCH_RESULT_HOLD_MS);
}

function finishTournament(room: Room): void {
  clearRoomTimer(room);
  clearBotTimer(room);
  clearTurnTimer(room);
  clearMathTimer(room);
  room.status = 'final_result';
  room.phaseEndsAt = null;

  const finalScores = new Map<string, number | null>();
  for (const match of room.matches) {
    for (const game of match.games.values()) finalScores.set(game.playerId, adjustedGameScore(game));
  }

  const ordered = [...room.players].sort((a, b) => {
    if (a.id === room.championId && b.id !== room.championId) return -1;
    if (b.id === room.championId && a.id !== room.championId) return 1;
    return b.wins - a.wins || b.ladderRank - a.ladderRank || a.losses - b.losses || a.joinedAt - b.joinedAt;
  });

  broadcast(room, {
    type: 'final_results',
    room: publicRoom(room),
    championId: room.championId,
    standings: ordered.map((player, index) => ({
      position: index + 1,
      player: publicPlayer(player),
      lane: player.ladderRank,
      wins: player.wins,
      losses: player.losses,
      finalScore: finalScores.get(player.id) ?? null,
      champion: player.id === room.championId
    }))
  });
}

function createOpeningMatches(room: Room): LaneMatch[] {
  return createMatchesFromOrderedPlayers(room, shuffle([...room.players]));
}

function createMatchesFromOrderedPlayers(room: Room, ordered: Player[]): LaneMatch[] {
  const players = ordered.filter((player) => player.isBot || player.socket?.readyState === WebSocket.OPEN);
  const matches: LaneMatch[] = [];
  const laneCount = Math.ceil(players.length / 2);
  let lane = 1;

  // If odd, put the bye on the lowest lane so the Championship Lane is always contested when possible.
  if (players.length % 2 === 1) {
    const bye = players.shift()!;
    matches.push(makeLaneMatch(lane++, laneCount, bye, null));
  }
  while (players.length > 0) {
    const a = players.shift()!;
    const b = players.shift() ?? null;
    matches.push(makeLaneMatch(lane++, laneCount, a, b));
  }
  return matches;
}

function makeLaneMatch(lane: number, laneCount: number, a: Player, b: Player | null): LaneMatch {
  const games = new Map<string, BowlerGame>();
  games.set(a.id, newBowlerGame(a.id));
  if (b) games.set(b.id, newBowlerGame(b.id));
  return {
    id: randomUUID(),
    lane,
    championship: lane === laneCount,
    playerAId: a.id,
    playerBId: b?.id ?? null,
    games,
    currentPlayerId: b ? a.id : null,
    complete: !b,
    winnerId: b ? null : a.id,
    loserId: null,
    tieBreak: false,
    turnEndsAt: null,
    shotInMotion: false,
    disconnectedPlayerId: null,
    reconnectEndsAt: null,
    pausedTurnRemainingMs: null,
    forfeitPlayerId: null
  };
}

function newBowlerGame(playerId: string): BowlerGame {
  return {
    playerId,
    frames: Array.from({ length: 10 }, () => []),
    currentFrame: 0,
    complete: false,
    standingPins: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    verifiedCumulative: Array(10).fill(null),
    pendingMathFrames: [],
    mathEndsAt: null,
    mathTimeouts: 0,
    mathAttempts: [],
    pausedMathRemainingMs: null
  };
}

function syncMathState(room: Room, game: BowlerGame, requiresMath: boolean): void {
  const scored = scoreGame(game);
  const hadPending = game.pendingMathFrames.length > 0;
  for (let frameIndex = 0; frameIndex < scored.cumulative.length; frameIndex++) {
    const total = scored.cumulative[frameIndex];
    if (total === null || game.verifiedCumulative[frameIndex] !== null) continue;
    if (requiresMath) {
      if (!game.pendingMathFrames.includes(frameIndex)) game.pendingMathFrames.push(frameIndex);
    } else {
      game.verifiedCumulative[frameIndex] = total;
      game.pendingMathFrames = game.pendingMathFrames.filter((pending) => pending !== frameIndex);
    }
  }
  if (!requiresMath || !game.pendingMathFrames.length) {
    game.mathEndsAt = null;
  } else if (!hadPending || !game.mathEndsAt) {
    armMathClock(room, game);
  }
}

function mathDurationMs(level: GameLevel): number {
  return level === 2 ? LEVEL_2_MATH_MS : level === 3 ? LEVEL_3_MATH_MS : 0;
}

function armMathClock(room: Room, game: BowlerGame): void {
  game.mathAttempts = [];
  if (room.level === 1 || !game.pendingMathFrames.length || findPlayer(room, game.playerId)?.isBot) {
    game.mathEndsAt = null;
    return;
  }
  game.mathEndsAt = Date.now() + mathDurationMs(room.level);
}

function mathPenaltyPercent(game: BowlerGame): number {
  return game.mathTimeouts * MATH_PENALTY_PERCENT;
}

function adjustedGameScore(game: BowlerGame): number {
  const raw = scoreGame(game).total ?? 0;
  return Math.max(0, Math.round(raw * (1 - mathPenaltyPercent(game) / 100)));
}

function publicGame(room: Room, game: BowlerGame) {
  const scored = scoreGame(game);
  const automatic = room.level === 1 || Boolean(findPlayer(room, game.playerId)?.isBot);
  if (automatic) syncMathState(room, game, false);
  const cumulative = automatic ? scored.cumulative : [...game.verifiedCumulative];
  return {
    playerId: game.playerId,
    frameScores: scored.frameScores,
    cumulative,
    total: game.complete && !game.pendingMathFrames.length ? scored.total : null,
    rawTotal: game.complete && !game.pendingMathFrames.length ? scored.total : null,
    finalScore: game.complete && !game.pendingMathFrames.length ? adjustedGameScore(game) : null,
    mathTimeouts: game.mathTimeouts,
    penaltyPercent: mathPenaltyPercent(game),
    mathEndsAt: automatic ? null : game.mathEndsAt,
    frames: game.frames,
    currentFrame: Math.min(10, game.currentFrame + 1),
    complete: game.complete,
    standingPins: game.standingPins,
    pendingMathFrames: automatic ? [] : [...game.pendingMathFrames],
    mathAttempts: automatic ? [] : [...game.mathAttempts]
  };
}

function scoreGame(game: BowlerGame) {
  const frameScores: Array<number | null> = Array(10).fill(null);
  const cumulative: Array<number | null> = Array(10).fill(null);
  let running = 0;
  let cumulativeBlocked = false;

  for (let i = 0; i < 10; i++) {
    const frame = game.frames[i];
    let score: number | null = null;
    if (i < 9) {
      if (frame[0] === 10) {
        const bonus = futureRolls(game.frames, i, 2);
        if (bonus.length === 2) score = 10 + bonus[0] + bonus[1];
      } else if (frame.length >= 2) {
        const sum = frame[0] + frame[1];
        if (sum === 10) {
          const bonus = futureRolls(game.frames, i, 1);
          if (bonus.length === 1) score = 10 + bonus[0];
        } else score = sum;
      }
    } else if (game.complete) {
      score = frame.reduce((sum, roll) => sum + roll, 0);
    }
    frameScores[i] = score;
    if (score === null || cumulativeBlocked) {
      cumulativeBlocked = true;
      cumulative[i] = null;
    } else {
      running += score;
      cumulative[i] = running;
    }
  }

  return { frameScores, cumulative, total: game.complete ? cumulative[9] : null };
}

function futureRolls(frames: number[][], frameIndex: number, count: number): number[] {
  const out: number[] = [];
  for (let i = frameIndex + 1; i < frames.length && out.length < count; i++) {
    for (const roll of frames[i]) {
      out.push(roll);
      if (out.length >= count) break;
    }
  }
  return out;
}

function roomJoinedPayload(room: Room, playerId: string) {
  const payload: Record<string, unknown> = {
    type: 'room_joined',
    playerId,
    room: publicRoom(room)
  };
  if (room.status !== 'lobby') payload.matchups = publicMatchups(room);
  if (room.status === 'matchup') payload.phaseEndsAt = room.phaseEndsAt;
  if (room.status === 'bowling' || room.status === 'round_result') {
    const tournament = publicTournamentState(room);
    payload.tournament = tournament;
    if (room.status === 'round_result') {
      payload.roundResult = {
        ...tournament,
        finalRound: false,
        phaseEndsAt: room.phaseEndsAt ?? Date.now(),
        movements: room.lastMovements
      };
    }
  }
  return payload;
}

function publicTournamentState(room: Room) {
  return {
    room: publicRoom(room),
    round: room.round,
    totalRounds: room.totalRounds,
    matches: publicMatches(room)
  };
}

function publicRoom(room: Room) {
  return {
    code: room.code,
    level: room.level,
    players: room.players.map(publicPlayer),
    maxPlayers: room.maxPlayers,
    status: room.status,
    round: room.round,
    totalRounds: room.totalRounds,
    championId: room.championId
  };
}

function publicPlayer(player: Player) {
  return {
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    isBot: player.isBot,
    lane: player.ladderRank,
    wins: player.wins,
    losses: player.losses,
    connected: player.isBot || player.socket?.readyState === WebSocket.OPEN
  };
}

function publicMatchups(room: Room) {
  return room.matches.map((match) => ({
    id: match.id,
    lane: match.lane,
    championship: match.championship,
    playerA: publicPlayerById(room, match.playerAId),
    playerB: match.playerBId ? publicPlayerById(room, match.playerBId) : null
  }));
}

function publicPlayerById(room: Room, id: string) {
  const player = findPlayer(room, id);
  if (player) return publicPlayer(player);
  return { id, name: 'Disconnected', isHost: false, isBot: false, lane: 1, wins: 0, losses: 0, connected: false };
}

function publicMatches(room: Room) {
  return room.matches.map((match) => ({
    ...publicMatchups(room).find((candidate) => candidate.id === match.id)!,
    games: [...match.games.values()].map((game) => publicGame(room, game)),
    currentPlayerId: match.currentPlayerId,
    complete: match.complete,
    winnerId: match.winnerId,
    loserId: match.loserId,
    tieBreak: match.tieBreak,
    turnEndsAt: match.turnEndsAt,
    disconnectedPlayerId: match.disconnectedPlayerId,
    reconnectEndsAt: match.reconnectEndsAt,
    forfeitPlayerId: match.forfeitPlayerId
  }));
}

function broadcastBowling(room: Room, type: 'bowling_started' | 'bowling_state'): void {
  broadcast(room, {
    type,
    room: publicRoom(room),
    round: room.round,
    totalRounds: room.totalRounds,
    matches: publicMatches(room)
  });
}

function setRanksFromMatches(room: Room, matches: LaneMatch[]): void {
  matches.forEach((match) => {
    const a = findPlayer(room, match.playerAId);
    const b = match.playerBId ? findPlayer(room, match.playerBId) : null;
    if (a) a.ladderRank = match.lane;
    if (b) b.ladderRank = match.lane;
  });
}

function opponentOf(match: LaneMatch, playerId: string): string | null {
  if (match.playerAId === playerId) return match.playerBId;
  if (match.playerBId === playerId) return match.playerAId;
  return null;
}

function matchHasPendingMath(match: LaneMatch): boolean {
  return [...match.games.values()].some((game) => game.pendingMathFrames.length > 0);
}

function makeBotPlayer(): Player {
  const name = 'Turkey Bot';
  return {
    id: randomUUID(),
    name,
    normalizedName: normalizeName(name),
    deviceId: `bot-${randomUUID()}`,
    isHost: false,
    isBot: true,
    socket: null,
    joinedAt: Date.now() + 1,
    ladderRank: 1,
    wins: 0,
    losses: 0,
    watchingMatchId: null,
    disconnectEndsAt: null,
    disconnectTimer: null
  };
}

function queueBotTurn(room: Room): void {
  clearBotTimer(room);
  if (room.status !== 'bowling') return;

  const match = room.matches.find((candidate) => {
    if (candidate.complete || candidate.disconnectedPlayerId || !candidate.currentPlayerId) return false;
    // Do not let the next bowler (including Turkey Bot) start while the other
    // player is still completing a required Level 2/3 score calculation.
    if (matchHasPendingMath(candidate)) return false;
    return Boolean(findPlayer(room, candidate.currentPlayerId)?.isBot);
  });
  if (!match) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!rooms.has(room.code) || room.status !== 'bowling' || match.complete || !match.currentPlayerId) return;
    const bot = findPlayer(room, match.currentPlayerId);
    if (!bot?.isBot) return;

    match.shotInMotion = false;
    rollForPlayer(room, match, bot.id, undefined, false);
    resolveMatchIfComplete(match);
    armMatchShotClock(room, match);
    broadcastBowling(room, 'bowling_state');
    scheduleTurnTimeout(room);
    scheduleMathTimeouts(room);

    if (room.matches.every((candidate) => candidate.complete)) scheduleFinishRound(room);
    else queueBotTurn(room);
  }, 550);
}

function armMatchShotClock(room: Room, match: LaneMatch): void {
  match.shotInMotion = false;
  if (room.status !== 'bowling' || match.complete || match.disconnectedPlayerId || !match.currentPlayerId) {
    match.turnEndsAt = null;
    return;
  }
  const player = findPlayer(room, match.currentPlayerId);
  // Maths is part of the turn sequence. If either bowler has an unresolved
  // score check, freeze the lane completely: no opponent shot clock and no bot
  // turn. The next bowler receives a brand-new 15 seconds only after the maths
  // task is answered correctly or resolved by its own timeout.
  if (matchHasPendingMath(match)) {
    match.turnEndsAt = null;
    return;
  }
  match.turnEndsAt = player && !player.isBot ? Date.now() + SHOT_CLOCK_MS : null;
}

function scheduleTurnTimeout(room: Room): void {
  clearTurnTimer(room);
  if (room.status !== 'bowling') return;
  const deadlines = room.matches
    .filter((match) => !match.complete && !match.disconnectedPlayerId && match.currentPlayerId && match.turnEndsAt)
    .map((match) => match.turnEndsAt as number);
  if (!deadlines.length) return;
  const nextDeadline = Math.min(...deadlines);
  room.turnTimer = setTimeout(() => handleTurnTimeouts(room), Math.max(25, nextDeadline - Date.now() + 15));
}

function handleTurnTimeouts(room: Room): void {
  room.turnTimer = null;
  if (!rooms.has(room.code) || room.status !== 'bowling') return;
  const now = Date.now();
  let changed = false;

  for (const match of room.matches) {
    if (match.complete || match.disconnectedPlayerId || !match.currentPlayerId || !match.turnEndsAt || match.turnEndsAt > now) continue;
    const timedOutId = match.currentPlayerId;
    const player = findPlayer(room, timedOutId);
    if (player?.isBot) {
      match.turnEndsAt = null;
      continue;
    }

    // Expiring the clock records a zero-pin delivery, ensuring one distracted
    // student cannot hold up every other lane.
    match.shotInMotion = false;
    rollForPlayer(room, match, timedOutId, [], room.level !== 1 && !player?.isBot);
    resolveMatchIfComplete(match);
    armMatchShotClock(room, match);
    if (player?.socket) sendError(player.socket, 'SHOT_CLOCK', '15-second shot clock expired — 0 pins recorded.');
    changed = true;
  }

  if (changed) broadcastBowling(room, 'bowling_state');
  scheduleMathTimeouts(room);
  if (room.matches.every((match) => match.complete)) scheduleFinishRound(room);
  else {
    queueBotTurn(room);
    scheduleTurnTimeout(room);
  }
}

function scheduleMathTimeouts(room: Room): void {
  clearMathTimer(room);
  if (room.status !== 'bowling' || room.level === 1) return;
  const deadlines: number[] = [];
  for (const match of room.matches) {
    if (match.disconnectedPlayerId) continue;
    for (const game of match.games.values()) {
      if (game.pendingMathFrames.length && game.mathEndsAt) deadlines.push(game.mathEndsAt);
    }
  }
  if (!deadlines.length) return;
  const nextDeadline = Math.min(...deadlines);
  room.mathTimer = setTimeout(() => handleMathTimeouts(room), Math.max(25, nextDeadline - Date.now() + 15));
}

function handleMathTimeouts(room: Room): void {
  room.mathTimer = null;
  if (!rooms.has(room.code) || room.status !== 'bowling' || room.level === 1) return;
  const now = Date.now();
  let changed = false;

  for (const match of room.matches) {
    if (match.disconnectedPlayerId) continue;
    for (const game of match.games.values()) {
      if (!game.pendingMathFrames.length || !game.mathEndsAt || game.mathEndsAt > now) continue;
      const player = findPlayer(room, game.playerId);
      if (player?.isBot) {
        game.mathEndsAt = null;
        continue;
      }
      const frameIndex = game.pendingMathFrames[0];
      const correctTotal = scoreGame(game).cumulative[frameIndex];
      if (correctTotal !== null) game.verifiedCumulative[frameIndex] = correctTotal;
      game.pendingMathFrames.shift();
      game.mathTimeouts++;
      armMathClock(room, game);
      if (player?.socket) sendError(player.socket, 'MATH_CLOCK', `Math timer expired — ${MATH_PENALTY_PERCENT}% final-score penalty applied.`);
      changed = true;
    }
    resolveMatchIfComplete(match);
    if (!match.complete && match.currentPlayerId) armMatchShotClock(room, match);
  }

  if (changed) broadcastBowling(room, 'bowling_state');
  scheduleTurnTimeout(room);
  if (room.matches.every((match) => match.complete)) scheduleFinishRound(room);
  else queueBotTurn(room);
  scheduleMathTimeouts(room);
}

function clearMathTimer(room: Room): void {
  if (room.mathTimer) clearTimeout(room.mathTimer);
  room.mathTimer = null;
}

function clearTurnTimer(room: Room): void {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
}

function clearBotTimer(room: Room): void {
  if (room.botTimer) clearTimeout(room.botTimer);
  room.botTimer = null;
}

function testPinResult(maxPins: number): number {
  if (maxPins <= 0) return 0;
  if (maxPins === 10 && Math.random() < 0.12) return 10;
  const curved = Math.round(((Math.random() + Math.random()) / 2) * maxPins);
  return Math.max(0, Math.min(maxPins, curved));
}

function removeSocket(socket: WebSocket): void {
  const member = membership.get(socket);
  if (!member) return;
  membership.delete(socket);
  const room = rooms.get(member.roomCode);
  if (!room) return;
  const leaving = room.players.find((player) => player.id === member.playerId);
  if (!leaving || leaving.socket !== socket) return;
  leaving.socket = null;
  leaving.watchingMatchId = null;

  if (room.status === 'bowling') {
    const match = room.matches.find((candidate) => !candidate.complete && (candidate.playerAId === leaving.id || candidate.playerBId === leaving.id));
    if (match) {
      pauseMatchForDisconnect(room, match, leaving);
      return;
    }
  }

  // Outside an active bowling match there is no game state to preserve, so keep
  // the original immediate-leave behaviour.
  removePlayerFromRoom(room, leaving.id);
}

function pauseMatchForDisconnect(room: Room, match: LaneMatch, player: Player): void {
  if (match.complete || match.disconnectedPlayerId) return;
  const now = Date.now();
  match.disconnectedPlayerId = player.id;
  match.reconnectEndsAt = now + DISCONNECT_GRACE_MS;
  match.pausedTurnRemainingMs = match.turnEndsAt ? Math.max(0, match.turnEndsAt - now) : null;
  match.turnEndsAt = null;
  // A released bowl is not committed until roll_ball arrives. If the connection
  // drops mid-animation, preserve the score/pins and let that delivery be replayed
  // after reconnect rather than turning a network fault into a zero-pin result.
  if (match.shotInMotion) {
    match.shotInMotion = false;
    match.pausedTurnRemainingMs = SHOT_CLOCK_MS;
  }
  for (const game of match.games.values()) {
    game.pausedMathRemainingMs = game.mathEndsAt ? Math.max(0, game.mathEndsAt - now) : null;
    game.mathEndsAt = null;
  }

  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  player.disconnectEndsAt = match.reconnectEndsAt;
  player.disconnectTimer = setTimeout(() => forfeitDisconnectedPlayer(room.code, player.id, match.id), DISCONNECT_GRACE_MS + 20);

  clearBotTimer(room);
  scheduleTurnTimeout(room);
  scheduleMathTimeouts(room);
  broadcastBowling(room, 'bowling_state');
  queueBotTurn(room);
}

function reconnectPlayer(room: Room, player: Player, socket: WebSocket): void {
  let match = room.matches.find((candidate) => candidate.disconnectedPlayerId === player.id && !candidate.complete);
  // If a join packet arrives just after the grace deadline but before the timer
  // callback has executed, resolve the forfeit first so the expired lane cannot
  // become permanently paused.
  if (match?.reconnectEndsAt && match.reconnectEndsAt < Date.now()) {
    forfeitDisconnectedPlayer(room.code, player.id, match.id);
    match = undefined;
  }

  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  player.disconnectEndsAt = null;
  player.socket = socket;
  membership.set(socket, { roomCode: room.code, playerId: player.id });

  if (match && match.reconnectEndsAt && match.reconnectEndsAt >= Date.now()) {
    const now = Date.now();
    match.disconnectedPlayerId = null;
    match.reconnectEndsAt = null;
    for (const game of match.games.values()) {
      if (game.pendingMathFrames.length && game.pausedMathRemainingMs !== null) {
        game.mathEndsAt = now + Math.max(250, game.pausedMathRemainingMs);
      }
      game.pausedMathRemainingMs = null;
    }
    if (!matchHasPendingMath(match) && match.currentPlayerId) {
      const current = findPlayer(room, match.currentPlayerId);
      match.turnEndsAt = current && !current.isBot
        ? now + Math.max(250, match.pausedTurnRemainingMs ?? SHOT_CLOCK_MS)
        : null;
    }
    match.pausedTurnRemainingMs = null;
    scheduleTurnTimeout(room);
    scheduleMathTimeouts(room);
    queueBotTurn(room);
  }

  // A player who reconnects after the grace period has already forfeited that
  // match, but can still wait/spectate and be included in the next ladder cycle.
  if (room.status === 'round_result' && room.pendingMatches.length > 0) {
    const ordered = [...room.players].sort((a, b) => a.ladderRank - b.ladderRank || a.joinedAt - b.joinedAt);
    room.pendingMatches = createMatchesFromOrderedPlayers(room, ordered);
    setRanksFromMatches(room, room.pendingMatches);
  }
}

function forfeitDisconnectedPlayer(roomCode: string, playerId: string, matchId: string): void {
  const room = rooms.get(roomCode);
  if (!room || room.status !== 'bowling') return;
  const player = findPlayer(room, playerId);
  const match = room.matches.find((candidate) => candidate.id === matchId);
  if (!player || player.socket || !match || match.complete || match.disconnectedPlayerId !== playerId) return;

  const opponentId = opponentOf(match, playerId);
  if (!opponentId) return;
  const opponent = findPlayer(room, opponentId);
  if (!opponent || (!opponent.isBot && !opponent.socket)) return;

  player.disconnectTimer = null;
  player.disconnectEndsAt = null;
  match.complete = true;
  match.winnerId = opponentId;
  match.loserId = playerId;
  match.forfeitPlayerId = playerId;
  match.currentPlayerId = null;
  match.turnEndsAt = null;
  match.disconnectedPlayerId = null;
  match.reconnectEndsAt = null;
  match.pausedTurnRemainingMs = null;
  match.shotInMotion = false;
  for (const game of match.games.values()) {
    game.mathEndsAt = null;
    game.pausedMathRemainingMs = null;
  }
  clearWatchersForMatch(room, match.id);

  if (player.isHost) {
    player.isHost = false;
    const nextHost = room.players
      .filter((candidate) => !candidate.isBot && candidate.socket?.readyState === WebSocket.OPEN)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (nextHost) nextHost.isHost = true;
  }

  broadcastBowling(room, 'bowling_state');
  scheduleTurnTimeout(room);
  scheduleMathTimeouts(room);
  clearBotTimer(room);
  queueBotTurn(room);
  if (room.matches.every((candidate) => candidate.complete)) scheduleFinishRound(room);
}

function removePlayerFromRoom(room: Room, playerId: string): void {
  const leaving = findPlayer(room, playerId);
  if (!leaving) return;
  if (leaving.disconnectTimer) clearTimeout(leaving.disconnectTimer);
  room.players = room.players.filter((player) => player.id !== playerId);

  if (room.players.length === 0 || room.players.every((player) => player.isBot)) {
    clearRoomTimer(room);
    clearBotTimer(room);
    clearTurnTimer(room);
    clearMathTimer(room);
    rooms.delete(room.code);
    return;
  }
  if (leaving.isHost) {
    room.players.forEach((player) => { player.isHost = false; });
    const nextHost = room.players
      .filter((player) => !player.isBot && player.socket?.readyState === WebSocket.OPEN)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (nextHost) nextHost.isHost = true;
  }

  if (room.status === 'lobby') broadcastRoom(room);
  else if (room.status === 'bowling') broadcastBowling(room, 'bowling_state');
  else broadcastRoom(room);
}

function getContext(socket: WebSocket): { room: Room; player: Player } | null {
  const member = membership.get(socket);
  if (!member) {
    sendError(socket, 'NOT_IN_ROOM', 'You are not currently in a room.');
    return null;
  }
  const room = rooms.get(member.roomCode);
  const player = room?.players.find((candidate) => candidate.id === member.playerId);
  if (!room || !player) return null;
  return { room, player };
}

function findPlayer(room: Room, id: string): Player | undefined {
  return room.players.find((player) => player.id === id);
}

function sendToMatchViewers(room: Room, match: LaneMatch, bowlerId: string, payload: object): void {
  const recipientIds = new Set<string>();
  const opponentId = opponentOf(match, bowlerId);
  if (opponentId) recipientIds.add(opponentId);
  for (const player of room.players) {
    if (player.watchingMatchId === match.id && player.id !== bowlerId) recipientIds.add(player.id);
  }

  const data = JSON.stringify(payload);
  for (const playerId of recipientIds) {
    const socket = findPlayer(room, playerId)?.socket;
    if (socket?.readyState === WebSocket.OPEN) socket.send(data);
  }
}

function clearWatchersForMatch(room: Room, matchId: string): void {
  room.players.forEach((player) => {
    if (player.watchingMatchId === matchId) player.watchingMatchId = null;
  });
}

function clearSpectatorSubscriptions(room: Room): void {
  room.players.forEach((player) => { player.watchingMatchId = null; });
}

function broadcastRoom(room: Room): void {
  broadcast(room, { type: 'room_state', room: publicRoom(room) });
}

function broadcast(room: Room, payload: object): void {
  const data = JSON.stringify(payload);
  room.players.forEach((player) => {
    if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(data);
  });
}

function send(socket: WebSocket, payload: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function sendError(socket: WebSocket, code: string, message: string): void {
  send(socket, { type: 'error', code, message });
}

function makePlayer(socket: WebSocket, name: string, deviceId: string, isHost: boolean): Player {
  return {
    id: randomUUID(),
    name,
    normalizedName: normalizeName(name),
    deviceId,
    isHost,
    isBot: false,
    socket,
    joinedAt: Date.now(),
    ladderRank: 1,
    wins: 0,
    losses: 0,
    watchingMatchId: null,
    disconnectEndsAt: null,
    disconnectTimer: null
  };
}

function cleanName(name: string): string {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 18);
}

function normalizeName(name: string): string {
  return cleanName(name).toLocaleLowerCase();
}

function validName(name: string): boolean {
  return name.length >= 2 && name.length <= 18;
}

function isLevel(value: number): value is GameLevel {
  return value === 1 || value === 2 || value === 3;
}

function createRoomCode(): string {
  for (let tries = 0; tries < 1000; tries++) {
    const code = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate room code');
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function clearRoomTimer(room: Room): void {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Turkey Bowling server listening on ws://localhost:${PORT}`);
});
