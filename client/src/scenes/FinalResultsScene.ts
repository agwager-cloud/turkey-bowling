import { BaseBowlingScene } from './BaseBowlingScene';
import { createSceneUi } from '../ui/dom';
import { appState } from '../state';

export class FinalResultsScene extends BaseBowlingScene {
  constructor() { super('FinalResultsScene'); }

  create(): void {
    this.setupBaseScene();
    const results = appState.finalResults;
    if (!results) return void this.scene.start('StartScene');
    const ui = createSceneUi();
    const champion = results.standings.find((standing) => standing.champion);

    ui.innerHTML = `
      <div class="final-shell interactive">
        <header class="final-header panel">
          <div class="final-crown">👑</div>
          <div><div class="eyebrow">TOURNAMENT COMPLETE</div><h1>${champion ? `${escapeHtml(champion.player.name)} is the Turkey Bowling Champion!` : 'Final Results'}</h1></div>
          <div class="level-badge">LEVEL ${results.room.level}</div>
        </header>
        <section class="standings-panel panel">
          <div class="standings-head"><span>POS</span><span>PLAYER</span><span>FINAL LANE</span><span>WINS</span><span>FINAL GAME</span></div>
          <div class="standings-list">
            ${results.standings.map((standing) => `<div class="standing-row${standing.champion ? ' champion' : ''}${standing.player.id === appState.playerId ? ' me' : ''}">
              <span class="standing-pos">${standing.champion ? '👑' : standing.position}</span>
              <span class="standing-name">${escapeHtml(standing.player.name)}</span>
              <span>${standing.lane === Math.max(...results.standings.map((s) => s.lane)) ? 'Championship' : `Lane ${standing.lane}`}</span>
              <span>${standing.wins}</span>
              <span>${standing.finalScore ?? '—'}</span>
            </div>`).join('')}
          </div>
        </section>
        <div class="final-note">12 class rounds complete. The Championship Lane winner is crowned first; remaining players are ordered by total wins.</div>
      </div>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}
