import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { network } from '../net/NetworkManager';
import { appState } from '../state';

export class StartScene extends BaseBowlingScene {
  private cleanup: Array<() => void> = [];

  constructor() {
    super('StartScene');
  }

  create(): void {
    appState.resetRoom();
    this.setupBaseScene();
    const ui = createSceneUi();
    ui.innerHTML = `
      <form class="start-card panel interactive" autocomplete="off">
        <h1 class="game-logo">🦃 TURKEY<br>BOWLING 🎳</h1>
        <div class="game-subtitle">Multiplayer Maths Bowling</div>
        <div class="form-grid">
          <label>
            <div class="field-label">Player name</div>
            <input id="player-name" class="text-input" maxlength="18" placeholder="Enter your name" enterkeyhint="done" />
          </label>
          <div class="room-row">
            <button id="host-btn" class="primary-btn" type="button" disabled>HOST GAME</button>
            <div>
              <div class="field-label">Room code</div>
              <input id="room-code" class="text-input" maxlength="5" placeholder="12345" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" />
            </div>
          </div>
          <button id="join-btn" class="secondary-btn" type="button" disabled>JOIN GAME</button>
        </div>
        <div class="connection-note">
          Online version: the free game server may take up to <strong>60 seconds</strong> to wake and connect. Host/Join stay disabled until the WebSocket is ready. No separate health check is required.
        </div>
        <div id="status" class="status-line">Connecting to game server…</div>
      </form>
    `;

    const nameInput = ui.querySelector<HTMLInputElement>('#player-name')!;
    const codeInput = ui.querySelector<HTMLInputElement>('#room-code')!;
    const hostBtn = ui.querySelector<HTMLButtonElement>('#host-btn')!;
    const joinBtn = ui.querySelector<HTMLButtonElement>('#join-btn')!;
    const status = ui.querySelector<HTMLDivElement>('#status')!;

    const setStatus = (text: string, state: 'normal' | 'error' | 'good' = 'normal') => {
      status.textContent = text;
      status.className = `status-line${state === 'normal' ? '' : ` ${state}`}`;
    };

    const setReady = (ready: boolean) => {
      hostBtn.disabled = !ready;
      joinBtn.disabled = !ready;
    };

    const validName = (): string | null => {
      const name = nameInput.value.trim().replace(/\s+/g, ' ');
      if (name.length < 2) {
        setStatus('Enter a name with at least 2 characters.', 'error');
        nameInput.focus();
        return null;
      }
      return name;
    };

    hostBtn.onclick = () => {
      const name = validName();
      if (!name) return;
      setReady(false);
      setStatus('Creating room…');
      network.createRoom(name, 1);
    };

    joinBtn.onclick = () => {
      const name = validName();
      if (!name) return;
      const code = codeInput.value.replace(/\D/g, '').slice(0, 5);
      if (!/^\d{5}$/.test(code)) {
        setStatus('Enter the 5-digit room code.', 'error');
        codeInput.focus();
        return;
      }
      setReady(false);
      setStatus('Joining room…');
      network.joinRoom(name, code);
    };

    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 5);
    });

    this.cleanup.push(
      network.on('open', () => {
        setReady(true);
        setStatus('Server connected — ready to play.', 'good');
      }),
      network.on('close', () => {
        setReady(false);
        setStatus('Connection lost — reconnecting through WebSocket…');
        window.setTimeout(() => {
          if (!this.scene.isActive()) return;
          network.connect().catch((error: Error) => {
            setReady(false);
            setStatus(`${error.message} Reload the page to try again.`, 'error');
          });
        }, 400);
      }),
      network.on('roomJoined', ({ playerId, room, matchups, phaseEndsAt, tournament, roundResult }) => {
        appState.playerId = playerId;
        appState.playerName = nameInput.value.trim().replace(/\s+/g, ' ');
        appState.room = room;
        appState.matchups = matchups ?? [];
        appState.matchupEndsAt = phaseEndsAt ?? null;
        appState.tournament = tournament ?? null;
        appState.roundResult = roundResult ?? null;
        appState.spectatingMatchId = null;
        this.scene.start(room.status === 'lobby' ? 'LobbyScene' : 'MatchupScene');
      }),
      network.on('error', ({ message }) => {
        setReady(network.isConnected);
        setStatus(message, 'error');
      })
    );

    if (network.isConnected) {
      setReady(true);
      setStatus('Server connected — ready to play.', 'good');
    } else {
      network.connect().catch((error: Error) => {
        setReady(false);
        setStatus(`${error.message} Check that the local server is running.`, 'error');
      });
    }

    this.events.once('shutdown', () => this.cleanup.splice(0).forEach((fn) => fn()));
  }
}
