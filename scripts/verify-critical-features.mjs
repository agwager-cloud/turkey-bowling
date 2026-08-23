import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const checks = [
  ['host OPT OUT button', 'client/src/scenes/MatchupScene.ts', /OPT OUT/],
  ['host participation network command', 'client/src/net/NetworkManager.ts', /setHostParticipation\(participating\).*set_host_participation/s],
  ['active-shot render protection', 'client/src/scenes/BowlingScene.ts', /localShotInFlight/],
  ['shot ID tracking', 'client/src/scenes/BowlingScene.ts', /activeShotId/],
  ['match + shot ID result send', 'client/src/scenes/BowlingScene.ts', /rollBall\(matchId, shotId,/],
  ['spare SFX trigger', 'client/src/scenes/BowlingScene.ts', /playSpare\(\)/],
  ['zero-pin SFX trigger', 'client/src/scenes/BowlingScene.ts', /playZeroPins\(\)/],
  ['solid adjacent-pin gap bridge', 'client/src/game/BowlingSimulator.ts', /applyAdjacentGapContact/],
  ['server shot ID guard', 'server/src/index.ts', /activeShotId.*rawShotId/s],
  ['server host participation handler', 'server/src/index.ts', /setHostParticipation/]
];
let failed = false;
for (const [label, rel, pattern] of checks) {
  const ok = pattern.test(read(rel));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  failed ||= !ok;
}
for (const rel of ['client/public/audio/awww.mp3', 'client/public/audio/nice_spare.mp3']) {
  let ok = false;
  try { ok = statSync(resolve(root, rel)).size > 1000; } catch {}
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${rel}`);
  failed ||= !ok;
}
if (failed) {
  console.error('\nCritical Turkey Bowling regression detected. Build stopped.');
  process.exit(1);
}
console.log('\nCritical v0.7.25 recovery features verified.');
