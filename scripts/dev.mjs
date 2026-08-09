import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';

const children = [];
let shuttingDown = false;

function getLanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

function start(label, workspace) {
  // Node 24 on Windows can throw EINVAL when npm.cmd is spawned directly.
  // Going through cmd.exe is the stable Windows path and keeps this launcher dependency-free.
  const isWindows = process.platform === 'win32';
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = isWindows
    ? ['/d', '/s', '/c', `npm run dev --workspace ${workspace}`]
    : ['run', 'dev', '--workspace', workspace];

  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: false
  });

  children.push(child);

  child.on('error', (error) => {
    if (shuttingDown) return;
    console.error(`\n[Turkey Bowling] Could not start ${label}: ${error.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`\n[Turkey Bowling] ${label} stopped (${detail}). Closing the other process...`);
    shutdown(code ?? 1);
  });
}

function stopChild(child) {
  if (!child.pid || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stopChild(child);
  setTimeout(() => process.exit(exitCode), 150);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('\n===============================================');
console.log('  TURKEY BOWLING - LOCAL DEVELOPMENT');
console.log('===============================================');
console.log('Starting WebSocket server + Vite client...');
console.log('Server:  ws://localhost:8080');
console.log('Browser: http://localhost:5173');
for (const address of getLanAddresses()) console.log(`LAN:     http://${address}:5173`);
console.log('Press Ctrl+C once to stop both.');
console.log('===============================================\n');

start('WebSocket server', 'server');
start('Vite client', 'client');
