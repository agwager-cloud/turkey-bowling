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
  ['host focus follows participation state', 'client/src/scenes/MatchupScene.ts', /preferredFocusKey[\s\S]*hostParticipating[\s\S]*championship/],
  ['stale matchup carousel callbacks ignored', 'client/src/scenes/MatchupScene.ts', /laneRenderGeneration[\s\S]*isCurrentTrack/],
  ['host participation resets matchup focus', 'client/src/scenes/MatchupScene.ts', /Host participation changes rebuild\/reassign lanes[\s\S]*laneDefaultApplied = false[\s\S]*laneScrollInitialized = false/],
  ['host OPT OUT button', 'client/src/scenes/MatchupScene.ts', /OPT OUT/],
  ['host participation network command', 'client/src/net/NetworkManager.ts', /setHostParticipation\(participating\).*set_host_participation/s],
  ['host active turn auto-returns from Matchups', 'client/src/scenes/MatchupScene.ts', /hostMustReturn[\s\S]*hostNeedsOwnLaneNow[\s\S]*scene\.start\('BowlingScene'\)/],
  ['host cannot open Matchups during active turn', 'client/src/scenes/BowlingScene.ts', /hostMatchupsLocked[\s\S]*Finish your active turn before opening Class Matchups/],
  ['Matchups errors are non-blocking', 'client/src/scenes/MatchupScene.ts', /network\.on\('error'[\s\S]*showToast\(message\)/],
  ['live scoreboard includes current score, frame, PB and wins', 'client/src/scenes/MatchupScene.ts', /Live Scoreboard[\s\S]*leaderboard-score[\s\S]*leaderboard-frame[\s\S]*leaderboard-pb[\s\S]*leaderboard-wins/],
  ['live scoreboard sortable headings', 'client/src/scenes/MatchupScene.ts', /data-leaderboard-sort="score"[\s\S]*data-leaderboard-sort="pb"[\s\S]*data-leaderboard-sort="wins"/],
  ['live scoreboard defaults to current score sort', 'client/src/scenes/MatchupScene.ts', /leaderboardSort = 'score'[\s\S]*buildLiveLeaderboard\(room, appState\.tournament, this\.leaderboardSort\)/],
  ['PB and wins sort descending', 'client/src/scenes/MatchupScene.ts', /sortKey === 'pb'[\s\S]*b\.pbScore[\s\S]*sortKey === 'wins'[\s\S]*b\.player\.wins - a\.player\.wins/],
  ['server exposes persistent personal best', 'server/src/index.ts', /personalBestScore[\s\S]*refreshPersonalBests[\s\S]*adjustedGameScore/],
  ['class reset clears personal best', 'server/src/index.ts', /returnToLobby[\s\S]*personalBestScore = null/],
  ['spectator shot playback defers state rerenders', 'client/src/scenes/LiveSpectatorScene.ts', /shotPlaybackActive[\s\S]*pendingRenderState/],
  ['spectator settled rack hold', 'client/src/scenes/LiveSpectatorScene.ts', /finishSpectatorPlayback[\s\S]*setTimeout\(resolve, 700\)/],
  ['spectator result overlay persists until navigation', 'client/src/scenes/LiveSpectatorScene.ts', /renderSpectatorMatchResult[\s\S]*RETURN TO MATCHUPS/],
  ['round complete preserves watched result', 'client/src/scenes/LiveSpectatorScene.ts', /roundComplete[\s\S]*result\.matches\.some[\s\S]*this\.render\(result\)/],
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
  ['turn-ready client command', 'client/src/net/NetworkManager.ts', /turnReady\(matchId\).*turn_ready/s],
  ['lane sends ready only after player controls render', 'client/src/scenes/BowlingScene.ts', /network\.turnReady\(match\.id\)[\s\S]*runShotClock/],
  ['visible player clock starts from rendered controls', 'client/src/scenes/BowlingScene.ts', /visibleTurnEndsAt = Math\.min\(turnEndsAt, Date\.now\(\) \+ 15000\)/],
  ['server turn-ready acknowledgement', 'server/src/index.ts', /function turnReady[\s\S]*turnReadyKey[\s\S]*Date\.now\(\) \+ SHOT_CLOCK_MS/],
  ['server hidden-turn fallback protection', 'server/src/index.ts', /TURN_READY_FALLBACK_MS = 30000[\s\S]*turnReadyKey = null[\s\S]*TURN_READY_FALLBACK_MS/],
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
console.log('\nCritical v0.7.37 rendered-turn handshake, host-turn safety, scoreboard layout, sortable PB scoreboard, uninterrupted spectator replay, host-focus, spectator-result, navigation and calculator keypad protections verified.');
