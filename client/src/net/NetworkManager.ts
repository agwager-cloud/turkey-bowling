import type { FinalResultsState, GameLevel, RoomState, RoundResultState, ServerMessage, SpectatorShot, SpectatorShotResult, TournamentState } from '../types';

type MatchStarted = Extract<ServerMessage, { type: 'match_started' }>;
type RoomJoined = Extract<ServerMessage, { type: 'room_joined' }>;

type EventMap = {
  open: void;
  close: void;
  roomJoined: Omit<RoomJoined, 'type'>;
  roomState: RoomState;
  matchStarted: MatchStarted;
  bowlingStarted: TournamentState;
  bowlingState: TournamentState;
  roundComplete: RoundResultState;
  finalResults: FinalResultsState;
  scoreFeedback: { correct: boolean; frameIndex: number; message: string };
  spectatorShot: SpectatorShot;
  spectatorShotResult: SpectatorShotResult;
  kicked: string;
  error: { code: string; message: string };
};

type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;

class NetworkManager {
  private socket: WebSocket | null = null;
  private listeners = new Map<keyof EventMap, Set<(payload: unknown) => void>>();
  private connectingPromise: Promise<void> | null = null;
  private pendingPlayerName = '';
  private pendingRoomCode = '';
  private resumeCredentials: { name: string; roomCode: string } | null = null;
  private graceReconnectActive = false;
  private suppressNextReconnect = false;

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(maxWaitMs = 60000): Promise<void> {
    if (this.isConnected) return;
    if (this.connectingPromise) return this.connectingPromise;

    const url = this.resolveUrl();

    this.connectingPromise = (async () => {
      const deadline = Date.now() + maxWaitMs;
      let lastError = new Error('Could not connect to the game server.');
      while (Date.now() < deadline) {
        try {
          await this.connectOnce(url);
          this.connectingPromise = null;
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : lastError;
          if (Date.now() >= deadline) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1800));
        }
      }
      this.connectingPromise = null;
      throw new Error(`${lastError.message} The free server may still be waking; try again.`);
    })();
    return this.connectingPromise;
  }

  private connectOnce(url: string, attemptTimeoutMs = 8000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let opened = false;
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        try { socket.close(); } catch { /* ignore */ }
        reject(new Error(message));
      };
      const timeout = window.setTimeout(() => fail('Connection attempt timed out.'), attemptTimeoutMs);

      socket.onopen = () => {
        if (settled) return;
        opened = true;
        settled = true;
        window.clearTimeout(timeout);
        this.emit('open', undefined);
        resolve();
      };
      socket.onerror = () => { if (!opened) fail('Could not connect to the game server.'); };
      socket.onclose = () => {
        window.clearTimeout(timeout);
        if (!opened) return fail('Could not connect to the game server.');
        if (this.socket === socket) this.socket = null;
        this.emit('close', undefined);
        if (this.suppressNextReconnect) {
          this.suppressNextReconnect = false;
        } else {
          void this.startGraceReconnect();
        }
      };
      socket.onmessage = (event) => this.handleMessage(String(event.data));
    });
  }

  createRoom(name: string, level: GameLevel): void {
    this.pendingPlayerName = name;
    this.pendingRoomCode = '';
    this.send({ type: 'create_room', name, level, deviceId: getDeviceId() });
  }
  joinRoom(name: string, roomCode: string): void {
    this.pendingPlayerName = name;
    this.pendingRoomCode = roomCode;
    this.send({ type: 'join_room', name, roomCode, deviceId: getDeviceId() });
  }
  setLevel(level: GameLevel): void { this.send({ type: 'set_level', level }); }
  kickPlayer(playerId: string): void { this.send({ type: 'kick_player', playerId }); }
  startMatch(): void { this.send({ type: 'start_match' }); }
  // Host-only manual start for the very first class matchup.
  beginRound(): void { this.send({ type: 'begin_round' }); }
  returnToLobby(): void { this.send({ type: 'return_to_lobby' }); }
  shotStarted(shot: Omit<SpectatorShot, 'matchId' | 'playerId' | 'playerName' | 'standingPins'>): void { this.send({ type: 'shot_started', shot }); }
  rollBall(knockedPins: number[], speedKmh: number, gutter: boolean): void { this.send({ type: 'roll_ball', knockedPins, speedKmh, gutter }); }
  submitScore(frameIndex: number, total: number): void { this.send({ type: 'submit_score', frameIndex, total }); }
  watchMatch(matchId: string): void { this.send({ type: 'watch_match', matchId }); }
  stopWatchingMatch(): void { this.send({ type: 'stop_watching_match' }); }
  devFinishRound(): void { this.send({ type: 'dev_finish_round' }); }

  private resolveUrl(): string {
    const configuredUrl = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
    const localUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8080`;
    const url = configuredUrl || (import.meta.env.DEV ? localUrl : '');
    if (!url) throw new Error('Production WebSocket URL is not configured. Build the itch.io client with VITE_WS_URL set to the Render wss:// address.');
    if (import.meta.env.PROD && !url.startsWith('wss://')) throw new Error('Production WebSocket URL must use secure WebSockets (wss://).');
    return url;
  }

  private async startGraceReconnect(): Promise<void> {
    if (this.graceReconnectActive || !this.resumeCredentials || this.isConnected) return;
    this.graceReconnectActive = true;
    const credentials = { ...this.resumeCredentials };
    const deadline = Date.now() + 18500;
    const url = this.resolveUrl();

    try {
      while (!this.isConnected && Date.now() < deadline && this.resumeCredentials) {
        try {
          const remaining = deadline - Date.now();
          await this.connectOnce(url, Math.max(1000, Math.min(3500, remaining)));
        } catch {
          if (Date.now() >= deadline) break;
          await new Promise((resolve) => window.setTimeout(resolve, 650));
        }
      }
      if (this.isConnected && this.resumeCredentials) {
        this.pendingPlayerName = credentials.name;
        this.pendingRoomCode = credentials.roomCode;
        this.send({ type: 'join_room', name: credentials.name, roomCode: credentials.roomCode, deviceId: getDeviceId() });
      }
    } finally {
      this.graceReconnectActive = false;
    }
  }

  on<K extends keyof EventMap>(event: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (payload: unknown) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (payload: unknown) => void);
  }

  private send(payload: object): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.emit('error', { code: 'NOT_CONNECTED', message: 'The game server is not connected yet.' });
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private handleMessage(raw: string): void {
    let message: ServerMessage;
    try { message = JSON.parse(raw) as ServerMessage; } catch { return; }
    switch (message.type) {
      case 'room_joined': {
        const { type: _type, ...payload } = message;
        if (this.pendingPlayerName) this.resumeCredentials = { name: this.pendingPlayerName, roomCode: message.room.code };
        this.pendingRoomCode = message.room.code;
        this.emit('roomJoined', payload);
        break;
      }
      case 'room_state': this.emit('roomState', message.room); break;
      case 'match_started': this.emit('matchStarted', message); break;
      case 'bowling_started': this.emit('bowlingStarted', toTournamentState(message)); break;
      case 'bowling_state': this.emit('bowlingState', toTournamentState(message)); break;
      case 'round_complete': this.emit('roundComplete', message); break;
      case 'final_results': this.emit('finalResults', message); break;
      case 'score_feedback': this.emit('scoreFeedback', { correct: message.correct, frameIndex: message.frameIndex, message: message.message }); break;
      case 'spectator_shot': this.emit('spectatorShot', message.shot); break;
      case 'spectator_shot_result': this.emit('spectatorShotResult', message.result); break;
      case 'kicked':
        this.resumeCredentials = null;
        this.suppressNextReconnect = true;
        this.emit('kicked', message.message);
        break;
      case 'error': this.emit('error', { code: message.code, message: message.message }); break;
      default: break;
    }
  }

  private emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }
}

function toTournamentState(message: Extract<ServerMessage, { type: 'bowling_started' | 'bowling_state' }>): TournamentState {
  return { room: message.room, round: message.round, totalRounds: message.totalRounds, matches: message.matches };
}

function getDeviceId(): string {
  const key = 'turkeyBowlingDeviceId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export const network = new NetworkManager();
