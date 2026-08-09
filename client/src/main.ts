import Phaser from 'phaser';
import './style.css';
import { StartScene } from './scenes/StartScene';
import { LobbyScene } from './scenes/LobbyScene';
import { MatchupScene } from './scenes/MatchupScene';
import { BowlingScene } from './scenes/BowlingScene';
import { LiveSpectatorScene } from './scenes/LiveSpectatorScene';
import { MatchResultScene } from './scenes/MatchResultScene';
import { FinalResultsScene } from './scenes/FinalResultsScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#180a27',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  render: { antialias: true, roundPixels: true },
  scene: [StartScene, LobbyScene, MatchupScene, BowlingScene, LiveSpectatorScene, MatchResultScene, FinalResultsScene]
});

window.addEventListener('turkey-bowling-sound-change', (event) => {
  game.sound.mute = (event as CustomEvent<boolean>).detail;
});
game.sound.mute = localStorage.getItem('turkeyBowlingMuted') === '1';

function installOrientationGuard(): void {
  const guard = document.createElement('div');
  guard.className = 'orientation-guard';
  guard.innerHTML = `<div class="orientation-card"><div class="orientation-icon">📱🎳</div><div class="orientation-title"></div><p class="orientation-copy"></p></div>`;
  document.body.appendChild(guard);
  const update = () => {
    const coarse = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
    if (!coarse) return guard.classList.remove('show');
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    const isPhone = shortSide < 600;
    const isPortrait = window.innerHeight >= window.innerWidth;
    guard.classList.toggle('show', isPhone ? !isPortrait : isPortrait);
    guard.querySelector<HTMLElement>('.orientation-title')!.textContent = isPhone ? 'Rotate to portrait' : 'Rotate to landscape';
    guard.querySelector<HTMLElement>('.orientation-copy')!.textContent = isPhone
      ? 'Turkey Bowling is designed for phones in portrait mode.'
      : 'Turkey Bowling is designed for iPads and touch tablets in landscape mode.';
  };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  update();
}

installOrientationGuard();
