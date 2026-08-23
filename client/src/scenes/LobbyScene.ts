// @ts-nocheck
import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { network } from '../net/NetworkManager';
import { appState } from '../state';
export class LobbyScene extends BaseBowlingScene {
    constructor() {
        super('LobbyScene');
        this.cleanup = [];
    }
    create() {
        this.setupBaseScene();
        if (!appState.room)
            return void this.scene.start('StartScene');
        this.ui = createSceneUi();
        this.render(appState.room);
        this.cleanup.push(network.on('roomState', (room) => { appState.room = room; this.render(room); }), network.on('matchStarted', (message) => {
            appState.room = message.room;
            appState.matchups = message.matchups;
            appState.matchupEndsAt = message.phaseEndsAt;
            appState.roundResult = null;
            this.scene.start('MatchupScene');
        }), network.on('error', ({ message }) => alert(message)));
        this.events.once('shutdown', () => this.cleanup.splice(0).forEach((fn) => fn()));
    }
    render(room) {
        if (!this.ui)
            return;
        const me = room.players.find((player) => player.id === appState.playerId);
        if (!me)
            return;
        const isHost = me.isHost;
        this.ui.innerHTML = `
      <div class="lobby-shell interactive">
        <section class="lobby-main panel">
          <div class="lobby-header">
            <h1 class="lobby-title">Bowling Lobby</h1>
          </div>
          <p class="players-meta">${room.players.length} / ${room.maxPlayers} players connected</p>
          <div class="player-grid">
            ${room.players.map((p) => `
              <div class="player-chip${p.id === appState.playerId ? ' me' : ''}${p.isHost ? ' host' : ''}" title="${escapeHtml(p.name)}">
                <span class="player-chip-name">${escapeHtml(p.name)}</span>
                ${isHost && p.id !== appState.playerId && !p.isHost ? `<button class="player-kick-x" data-kick="${p.id}" type="button" aria-label="Remove ${escapeHtml(p.name)}" title="Remove ${escapeHtml(p.name)}">×</button>` : ''}
              </div>`).join('')}
          </div>
        </section>
        <aside class="lobby-side panel">
          <h2 class="side-title">Scoring Level</h2>
          <div class="level-stack">
            ${levelButton(1, 'Automatic scoring', room.level, isHost)}
            ${levelButton(2, 'Guided addition', room.level, isHost)}
            ${levelButton(3, 'Independent scoring', room.level, isHost)}
          </div>
          <div class="prototype-info"><strong>Class format:</strong> No round limit. Each round is one complete 10-frame bowling game. Winners gain 1 point and move right; losers keep their points and move left. The host can check the live leaderboard at any time and finish the activity whenever the class is ready.</div>
          <div class="host-actions">
            ${isHost ? `<button id="start-btn" class="primary-btn" type="button">${room.players.length === 1 ? 'START VS TURKEY BOT' : 'CREATE FIRST MATCHUPS'}</button>` : '<button class="secondary-btn" type="button" disabled>WAITING FOR HOST</button>'}
          </div>
          <p class="role-note">${isHost && room.players.length === 1 ? '<strong>Solo testing:</strong> Start now and the server will add Turkey Bot as your opponent.<br><br>' : ''}Level 1 remains the default. Levels 2 and 3 are carried through the complete match flow now; their maths-entry interfaces come after the bowling simulator is established.</p>
        </aside>
      </div>`;
        if (!isHost)
            return;
        this.ui.querySelectorAll('[data-level]').forEach((button) => {
            button.onclick = () => network.setLevel(Number(button.dataset.level));
        });
        this.ui.querySelectorAll('[data-kick]').forEach((button) => {
            button.onclick = () => {
                network.kickPlayer(button.dataset.kick);
                button.disabled = true;
                button.textContent = '…';
            };
        });
        this.ui.querySelector('#start-btn').onclick = () => network.startMatch();
    }
}
function levelButton(level, description, active, enabled) {
    return `<button class="level-btn${active === level ? ' active' : ''}" data-level="${level}" type="button" ${enabled ? '' : 'disabled'}><strong>Level ${level}</strong><small>${description}</small></button>`;
}
function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
