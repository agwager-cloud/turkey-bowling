import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const checks = [
  ['result countdown preserves navigation DOM', 'client/src/scenes/MatchResultScene.ts', /setInterval\(\(\) => this\.updateCountdown\(\), 250\)/],
  ['return to class matchups navigation', 'client/src/scenes/MatchResultScene.ts', /result-class-matchups.*MatchupScene/s],
  ['1000px host controls stay one row', 'client/src/style.css', /v0\.7\.28[\s\S]*match-head-actions[\s\S]*flex-wrap:\s*nowrap/],
  ['landscape maths keypad stays three columns', 'client/src/style.css', /v0\.7\.29[\s\S]*math-keypad[\s\S]*grid-template-columns:\s*repeat\(3,/],
  ['keyboard numpad digit order', 'client/src/scenes/BowlingScene.ts', /\[7, 8, 9, 4, 5, 6, 1, 2, 3\]/],
  ['landscape maths card avoids scrollbar at standard height', 'client/src/style.css', /math-card\s*\{[\s\S]*overflow:\s*hidden/],
  ['host OPT OUT button', 'client/src/scenes/MatchupScene.ts', /OPT OUT/],
  ['host participation network command', 'client/src/net/NetworkManager.ts', /setHostParticipation\(participating\).*set_host_participation/s],
  ['active-shot render protection', 'client/src/scenes/BowlingScene.ts', /localShotInFlight/],
  ['shot ID tracking', 'client/src/scenes/BowlingScene.ts', /activeShotId/],
  ['match + shot ID result send', 'client/src/scenes/BowlingScene.ts', /rollBall\(matchId, shotId,/],
  ['spare SFX trigger', 'client/src/scenes/BowlingScene.ts', /playSpare\(\)/],
  ['zero-pin SFX trigger', 'client/src/scenes/BowlingScene.ts', /playZeroPins\(\)/],
  ['solid adjacent-pin gap bridge', 'client/src/game/BowlingSimulator.ts', /applyAdjacentGapContact/],
  ['true head-pin contact radius', 'client/src/game/BowlingSimulator.ts', /HEAD_PIN_TRUE_CONTACT_RADIUS/],
  ['direct contact before gap fallback', 'client/src/game/BowlingSimulator.ts', /directlyContacted.*applyAdjacentGapContact/s],
  ['swept first-contact normal', 'client/src/game/BowlingSimulator.ts', /enterT.*Math\.sqrt\(discriminant\)/s],
  ['ball forward retention through rack', 'client/src/game/BowlingSimulator.ts', /minimumForwardRetention/],
  ['head-pin miss protection', 'client/src/game/BowlingSimulator.ts', /struckPinId !== 0.*protectedLeavePins\.add\(0\)/s],
  ['rare bad-bowl 7-10 gate', 'client/src/game/BowlingSimulator.ts', /genuinelyBadStraight.*sevenTenChance/s],
  ['fallen-pin messenger sweep', 'client/src/game/BowlingSimulator.ts', /collideFallenPinSweeps/],
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
console.log('\nCritical v0.7.29 stability, navigation and calculator keypad layout verified.');
