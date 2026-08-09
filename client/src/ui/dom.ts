const uiRoot = (): HTMLElement => {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('Missing #ui-root');
  return root;
};

export function clearSceneUi(): void {
  uiRoot().querySelectorAll('.scene-ui').forEach((el) => el.remove());
}

export function createSceneUi(): HTMLDivElement {
  clearSceneUi();
  const layer = document.createElement('div');
  layer.className = 'scene-ui';
  uiRoot().appendChild(layer);
  return layer;
}

export function ensureSoundToggle(): HTMLButtonElement {
  let button = document.querySelector<HTMLButtonElement>('.sound-toggle');
  if (!button) {
    button = document.createElement('button');
    button.className = 'sound-toggle';
    button.type = 'button';
    button.setAttribute('aria-label', 'Toggle sound');
    uiRoot().appendChild(button);
  }
  refreshSoundButton(button);
  button.onclick = () => {
    const muted = localStorage.getItem('turkeyBowlingMuted') === '1';
    localStorage.setItem('turkeyBowlingMuted', muted ? '0' : '1');
    refreshSoundButton(button!);
    window.dispatchEvent(new CustomEvent('turkey-bowling-sound-change', { detail: !muted }));
  };
  return button;
}

function refreshSoundButton(button: HTMLButtonElement): void {
  const muted = localStorage.getItem('turkeyBowlingMuted') === '1';
  button.textContent = muted ? '🔇' : '🔊';
  button.title = muted ? 'Sound off' : 'Sound on';
}

export function ensureRoomCodeBadge(roomCode?: string | null): void {
  let badge = document.querySelector<HTMLDivElement>('.global-room-code');
  if (!roomCode) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'global-room-code';
    uiRoot().appendChild(badge);
  }
  badge.textContent = `ROOM ${roomCode}`;
  badge.setAttribute('aria-label', `Room code ${roomCode}`);
}
