// @ts-nocheck
class NetworkManager {
    socket = null;
    listeners = new Map();
    connectingPromise = null;
    pendingPlayerName = '';
    pendingRoomCode = '';
    resumeCredentials = null;
    graceReconnectActive = false;
    suppressNextReconnect = false;
    get isConnected() {
        return this.socket?.readyState === WebSocket.OPEN;
    }
    async connect(maxWaitMs = 60000) {
        if (this.isConnected)
            return;
        if (this.connectingPromise)
            return this.connectingPromise;
        const url = this.resolveUrl();
        this.connectingPromise = (async () => {
            const deadline = Date.now() + maxWaitMs;
            let lastError = new Error('Could not connect to the game server.');
            while (Date.now() < deadline) {
                try {
                    await this.connectOnce(url);
                    this.connectingPromise = null;
                    return;
                }
                catch (error) {
                    lastError = error instanceof Error ? error : lastError;
                    if (Date.now() >= deadline)
                        break;
                    await new Promise((resolve) => window.setTimeout(resolve, 1800));
                }
            }
            this.connectingPromise = null;
            throw new Error(`${lastError.message} The free server may still be waking; try again.`);
        })();
        return this.connectingPromise;
    }
    connectOnce(url, attemptTimeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(url);
            this.socket = socket;
            let opened = false;
            let settled = false;
            const fail = (message) => {
                if (settled)
                    return;
                settled = true;
                window.clearTimeout(timeout);
                try {
                    socket.close();
                }
                catch { /* ignore */ }
                reject(new Error(message));
            };
            const timeout = window.setTimeout(() => fail('Connection attempt timed out.'), attemptTimeoutMs);
            socket.onopen = () => {
                if (settled)
                    return;
                opened = true;
                settled = true;
                window.clearTimeout(timeout);
                this.emit('open', undefined);
                resolve();
            };
            socket.onerror = () => { if (!opened)
                fail('Could not connect to the game server.'); };
            socket.onclose = () => {
                window.clearTimeout(timeout);
                if (!opened)
                    return fail('Could not connect to the game server.');
                if (this.socket === socket)
                    this.socket = null;
                this.emit('close', undefined);
                if (this.suppressNextReconnect) {
                    this.suppressNextReconnect = false;
                }
                else {
                    void this.startGraceReconnect();
                }
            };
            socket.onmessage = (event) => this.handleMessage(String(event.data));
        });
    }
    createRoom(name, level) {
        this.pendingPlayerName = name;
        this.pendingRoomCode = '';
        this.send({ type: 'create_room', name, level, deviceId: getDeviceId() });
    }
    joinRoom(name, roomCode) {
        this.pendingPlayerName = name;
        this.pendingRoomCode = roomCode;
        this.send({ type: 'join_room', name, roomCode, deviceId: getDeviceId() });
    }
    setLevel(level) { this.send({ type: 'set_level', level }); }
    kickPlayer(playerId) { this.send({ type: 'kick_player', playerId }); }
    startMatch() { this.send({ type: 'start_match' }); }
    // Host-only manual start for the very first class matchup.
    beginRound() { this.send({ type: 'begin_round' }); }
    returnToLobby() { this.send({ type: 'return_to_lobby' }); }
    shotStarted(matchId, shotId, shot) { this.send({ type: 'shot_started', matchId, shotId, shot }); }
    rollBall(matchId, shotId, knockedPins, speedKmh, gutter) { this.send({ type: 'roll_ball', matchId, shotId, knockedPins, speedKmh, gutter }); }
    submitScore(frameIndex, total) { this.send({ type: 'submit_score', frameIndex, total }); }
    watchMatch(matchId) { this.send({ type: 'watch_match', matchId }); }
    stopWatchingMatch() { this.send({ type: 'stop_watching_match' }); }
    setHostParticipation(participating) { this.send({ type: 'set_host_participation', participating }); }
    devFinishRound() { this.send({ type: 'dev_finish_round' }); }
    resolveUrl() {
        const url = 'wss://turkey-bowling-server.onrender.com';
        if (!url.startsWith('wss://'))
            throw new Error('Production WebSocket URL must use secure WebSockets (wss://).');
        return url;
    }
    async startGraceReconnect() {
        if (this.graceReconnectActive || !this.resumeCredentials || this.isConnected)
            return;
        this.graceReconnectActive = true;
        const credentials = { ...this.resumeCredentials };
        const deadline = Date.now() + 18500;
        const url = this.resolveUrl();
        try {
            while (!this.isConnected && Date.now() < deadline && this.resumeCredentials) {
                try {
                    const remaining = deadline - Date.now();
                    await this.connectOnce(url, Math.max(1000, Math.min(3500, remaining)));
                }
                catch {
                    if (Date.now() >= deadline)
                        break;
                    await new Promise((resolve) => window.setTimeout(resolve, 650));
                }
            }
            if (this.isConnected && this.resumeCredentials) {
                this.pendingPlayerName = credentials.name;
                this.pendingRoomCode = credentials.roomCode;
                this.send({ type: 'join_room', name: credentials.name, roomCode: credentials.roomCode, deviceId: getDeviceId() });
            }
        }
        finally {
            this.graceReconnectActive = false;
        }
    }
    on(event, listener) {
        const set = this.listeners.get(event) ?? new Set();
        set.add(listener);
        this.listeners.set(event, set);
        return () => set.delete(listener);
    }
    send(payload) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.emit('error', { code: 'NOT_CONNECTED', message: 'The game server is not connected yet.' });
            return;
        }
        this.socket.send(JSON.stringify(payload));
    }
    handleMessage(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            return;
        }
        switch (message.type) {
            case 'room_joined': {
                const { type: _type, ...payload } = message;
                if (this.pendingPlayerName)
                    this.resumeCredentials = { name: this.pendingPlayerName, roomCode: message.room.code };
                this.pendingRoomCode = message.room.code;
                this.emit('roomJoined', payload);
                break;
            }
            case 'room_state':
                this.emit('roomState', message.room);
                break;
            case 'match_started':
                this.emit('matchStarted', message);
                break;
            case 'bowling_started':
                this.emit('bowlingStarted', toTournamentState(message));
                break;
            case 'bowling_state':
                this.emit('bowlingState', toTournamentState(message));
                break;
            case 'round_complete':
                this.emit('roundComplete', message);
                break;
            case 'final_results':
                this.emit('finalResults', message);
                break;
            case 'score_feedback':
                this.emit('scoreFeedback', { correct: message.correct, frameIndex: message.frameIndex, message: message.message });
                break;
            case 'spectator_shot':
                this.emit('spectatorShot', message.shot);
                break;
            case 'spectator_shot_result':
                this.emit('spectatorShotResult', message.result);
                break;
            case 'kicked':
                this.resumeCredentials = null;
                this.suppressNextReconnect = true;
                this.emit('kicked', message.message);
                break;
            case 'error':
                this.emit('error', { code: message.code, message: message.message });
                break;
            default: break;
        }
    }
    emit(event, payload) {
        this.listeners.get(event)?.forEach((listener) => listener(payload));
    }
}
function toTournamentState(message) {
    return { room: message.room, round: message.round, totalRounds: message.totalRounds, matches: message.matches };
}
function getDeviceId() {
    const key = 'turkeyBowlingDeviceId';
    let id = localStorage.getItem(key);
    if (!id) {
        id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, id);
    }
    return id;
}
export const network = new NetworkManager();
