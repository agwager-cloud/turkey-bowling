export interface BowlingShotConfig {
  startPosition: number; // -1 left .. +1 right across the approach
  aim: number;          // -1 left .. +1 right target on the pin deck
  hook: number;         // -1 left .. +1 right
  power: number;        // 0 .. 1
  releaseTiming: number; // -1 early .. 0 perfect .. +1 late
  releaseInGreen: boolean; // only green-zone releases are strike eligible on a full rack
  seed: number;            // deterministic seed so the opponent can replay the exact same bowl
  // Local-only callbacks used to synchronise audio/celebrations with the visible
  // pin physics. Functions are never sent over the network.
  onLoudPinImpact?: () => void;
  onRackCleared?: () => void;
  onZeroPinMissAtDeck?: () => void;
}

export interface BowlingShotResult {
  knockedPins: number[];
  speedKmh: number;
  gutter: boolean;
  headPinHit: boolean;
}

interface SimPin {
  id: number;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  knocked: boolean;
}

interface SimBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  gutter: boolean;
  visible: boolean;
}

// Pin spacing adjusted to match a more realistic ten-pin rack.
// In particular, the 7 and 10 pins now sit much closer to the outer lane
// edges/gutters, and the full rack spreads across the deck more like a real
// bowling lane reference photo.
const PIN_LAYOUT: ReadonlyArray<readonly [number, number]> = [
  [0, 0.814],
  [-0.16, 0.85], [0.16, 0.85],
  [-0.32, 0.886], [0, 0.886], [0.32, 0.886],
  [-0.48, 0.922], [-0.16, 0.922], [0.16, 0.922], [0.48, 0.922]
];

const LANE_HALF_WIDTH = 0.72;
const BALL_RADIUS = 0.064;
// A regulation ten-pin is about 4.766 in wide versus an 8.5-8.6 in bowling
// ball, so its maximum radius is only ~55% of the ball radius. The previous
// 0.05 value made every pin collision body far too fat and caused chunky,
// domino-like rack reactions. This footprint is much closer to real geometry.
const PIN_RADIUS = BALL_RADIUS * 0.555;
const BALL_PIN_RADIUS = BALL_RADIUS + PIN_RADIUS;
// The 2.5D top-down collision circle represents the pin's maximum belly and
// vertical body envelope, not just its narrow base. Keeping this ball-contact
// envelope slightly wider than the pin-to-pin footprint prevents a bowling ball
// from visually squeezing through two adjacent standing pins.
const STANDING_PIN_BALL_CONTACT_RADIUS = 0.048;
const BALL_STANDING_PIN_RADIUS = BALL_RADIUS + STANDING_PIN_BALL_CONTACT_RADIUS;
// The head pin needs a stricter contact envelope than the rest of the rack.
// This is close to the true ball + maximum-pin-belly geometry, with only a
// tiny tolerance for the 2.5D projection. It prevents a clear miss from being
// scored as a head-pin hit while still allowing a visible edge clip to count.
const HEAD_PIN_TRUE_CONTACT_RADIUS = BALL_PIN_RADIUS + 0.004;
// Keep a very small visual-graze allowance on the 7/10 pins so an apparent
// edge shave still registers without effectively widening the whole rack.
const CORNER_PIN_GRAZE_MARGIN = 0.008;
const PIN_PIN_RADIUS = PIN_RADIUS * 2;

// The rack artwork uses perspective spacing that is wider than real-world pin
// spacing relative to the ball. A real bowling ball cannot pass cleanly through
// the gap between two adjacent standing pins. Bridge those exact gap corridors
// with a paired contact so the ball catches both inside faces instead of
// magically threading between them. This is deterministic and applies to every
// adjacent row pair, including exposed spare leaves.
const ADJACENT_GAP_HALF_WIDTH = 0.066;
const ADJACENT_GAP_Y_TOLERANCE = 0.080;
const ADJACENT_PIN_GAPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 2, 0.00, 0.850],
  [3, 4, -0.16, 0.886], [4, 5, 0.16, 0.886],
  [6, 7, -0.32, 0.922], [7, 8, 0.00, 0.922], [8, 9, 0.32, 0.922]
];

// Once the ball reaches this point it has visibly cleared the rack. If no pin
// has fallen, play the zero-pin reaction. This deliberately also applies to a
// gutter ball, matching the known-good v0.7.20 behaviour.
const ZERO_PIN_REACTION_Y = 1.045;

// Real-world mass ratio: a typical 15 lb bowling ball is ~6.8 kg and a
// regulation pin is ~1.59 kg. The simulator previously used hand-tuned velocity
// additions that made the rack feel unusually light. Explicit masses plus low
// restitution make impacts look denser: the ball drives through the pocket but
// visibly gives up speed, while pins move with less explosive acceleration.
const BALL_MASS_KG = 6.80;
const PIN_MASS_KG = 1.59;
const BALL_PIN_RESTITUTION = 0.22;
const PIN_PIN_RESTITUTION = 0.28;
const PIN_KICK_TRANSLATION_SCALE = 0.86;
const PIN_KICK_SPIN_SCALE = 0.78;

// Once a pin is substantially on its side, its full 15-inch body becomes a
// moving contact shape rather than just the small circular belly footprint.
// This lets a horizontal messenger pin sweep through pins behind it, which is
// a major part of real ten-pin carry. The values are deliberately conservative
// so one fallen pin can skittle a cluster without behaving like a giant bat.
const FALLEN_PIN_SWEEP_HALF_LENGTH = 0.124;
const FALLEN_PIN_SWEEP_RADIUS = 0.047;
const FALLEN_PIN_SWEEP_MIN_SPEED = 0.027;
const FALLEN_PIN_SWEEP_MIN_FALL = 0.44;

const START_POSITION_WORLD_X = 0.54;
const SHOT_START_Y = 0.025;
const SHOT_TARGET_Y = 0.822;
const MAX_HOOK_OFFSET = 0.60;
const LANE_TOP_HALF_RATIO = 0.158;
const LANE_BOTTOM_HALF_RATIO = 0.335;
// Give the far end of the lane more vertical breathing room. This effectively
// tilts the camera upward and lowers the rack on screen so the taller pin heads
// remain fully visible instead of clipping against the top of the canvas.
const LANE_TOP_Y_RATIO = 0.145;
const LANE_BOTTOM_Y_RATIO = 0.98;

export class BowlingSimulator {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private pins: SimPin[] = [];
  private initialStanding = new Set<number>();
  private ball: SimBall | null = null;
  private startPosition = 0;
  private aim = 0;
  private hook = 0;
  private animationFrame = 0;
  private lastTime = 0;
  private shotElapsed = 0;
  private simulationAccumulator = 0;
  private shotActive = false;
  private settleElapsed = 0;
  private resizeObserver?: ResizeObserver;
  private shotResolver?: (result: BowlingShotResult) => void;
  private speedKmh = 0;
  private headPinHit = false;
  private shotStartX = 0;
  private shotTargetX = 0;
  private shotPower = 0.68;
  private shotReleaseTiming = 0;
  private rackCarryApplied = false;
  private pocketQuality = 0;
  private straightHeadBall = false;
  private strikeEligible = true;
  private protectedLeavePins = new Set<number>();
  private lowPowerDrift = 0;
  private releaseMissSeverity = 0;
  private releaseMissDrift = 0;
  private neutralAimAndHook = false;
  private extremeOppositionSeverity = 0;
  private randomState = 0x6d2b79f5;
  private setupVisible = true;
  private loudPinImpactCallback?: () => void;
  private loudPinImpactNotified = false;
  private rackClearedCallback?: () => void;
  private rackClearedNotified = false;
  private zeroPinMissCallback?: () => void;
  private zeroPinMissNotified = false;

  constructor(canvas: HTMLCanvasElement, standingPins: number[]) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Turkey Bowling could not create the bowling canvas.');
    this.ctx = context;
    this.setStandingPins(standingPins);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.shotResolver = undefined;
    this.loudPinImpactCallback = undefined;
    this.rackClearedCallback = undefined;
    this.zeroPinMissCallback = undefined;
  }

  setStandingPins(standingPins: number[]): void {
    const standing = new Set(standingPins);
    this.initialStanding = standing;
    this.pins = PIN_LAYOUT.map(([x, y], id) => ({
      id,
      homeX: x,
      homeY: y,
      x,
      y,
      vx: 0,
      vy: 0,
      angle: 0,
      angularVelocity: 0,
      knocked: !standing.has(id)
    }));
    this.ball = null;
    this.shotActive = false;
    this.draw();
  }

  setSetupVisible(visible: boolean): void {
    this.setupVisible = visible;
    if (!this.shotActive) this.draw();
  }

  setStartPosition(value: number): void {
    this.startPosition = clamp(value, -1, 1);
    this.refreshExtremeOppositionSeverity();
    if (!this.shotActive) this.draw();
  }

  isPointerOnStartBall(clientX: number, clientY: number): boolean {
    if (this.shotActive) return false;
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const point = this.project(this.startPosition * START_POSITION_WORLD_X, SHOT_START_Y, rect.width, rect.height);
    const radius = Math.max(18, rect.width * 0.044);
    const hitRadius = Math.max(34, radius * 1.65);
    return Math.hypot(localX - point.x, localY - point.y) <= hitRadius;
  }

  startPositionFromClientX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clamp(clientX - rect.left, 0, rect.width);
    const half = this.halfWidthAt(SHOT_START_Y, rect.width);
    const worldX = ((localX - rect.width / 2) * LANE_HALF_WIDTH) / Math.max(1, half);
    return clamp(worldX / START_POSITION_WORLD_X, -1, 1);
  }

  setAim(value: number): void {
    this.aim = clamp(value, -1, 1);
    this.refreshExtremeOppositionSeverity();
    if (!this.shotActive) this.draw();
  }

  setHook(value: number): void {
    this.hook = clamp(value, -1, 1);
    this.refreshExtremeOppositionSeverity();
    if (!this.shotActive) this.draw();
  }

  async bowl(config: BowlingShotConfig): Promise<BowlingShotResult> {
    if (this.shotActive) throw new Error('A bowling shot is already in progress.');
    this.startPosition = clamp(config.startPosition, -1, 1);
    this.aim = clamp(config.aim, -1, 1);
    this.hook = clamp(config.hook, -1, 1);
    const suppliedSeed = Number(config.seed);
    this.randomState = Number.isFinite(suppliedSeed) ? (Math.trunc(suppliedSeed) >>> 0) || 0x6d2b79f5 : ((Math.random() * 0xffffffff) >>> 0) || 0x6d2b79f5;
    const power = clamp(config.power, 0, 1);
    const releaseTiming = clamp(config.releaseTiming, -1, 1);

    const speedKmh = (10.5 + power * 10.5) * 1.60934;
    this.speedKmh = speedKmh;
    this.headPinHit = false;
    this.shotPower = power;
    this.shotReleaseTiming = releaseTiming;
    this.rackCarryApplied = false;
    this.pocketQuality = 0;
    this.straightHeadBall = false;
    this.releaseMissSeverity = clamp(Math.abs(releaseTiming), 0, 1);
    this.neutralAimAndHook = Math.abs(this.aim) < 0.035 && Math.abs(this.hook) < 0.035;

    // Maximum aim in one direction plus maximum hook in the opposite direction
    // used to cancel into an unrealistically perfect pocket line. Treat that
    // combination as over-steering instead: moderate opposing settings remain
    // useful, but the last part of both sliders becomes increasingly difficult
    // to control. Starting near the centre makes the exploit slightly worse.
    this.refreshExtremeOppositionSeverity();

    this.strikeEligible = Boolean(config.releaseInGreen);
    this.protectedLeavePins.clear();
    this.loudPinImpactCallback = config.onLoudPinImpact;
    this.loudPinImpactNotified = false;
    this.rackClearedCallback = config.onRackCleared;
    this.rackClearedNotified = false;
    this.zeroPinMissCallback = config.onZeroPinMissAtDeck;
    this.zeroPinMissNotified = false;

    // The farther the release is from the green zone, the less faithfully the
    // ball follows the line the player set. Small misses are recoverable; large
    // misses get a strong push/pull plus some unpredictable lateral drift.
    const missDirection = releaseTiming === 0 ? (this.random() < 0.5 ? -1 : 1) : Math.sign(releaseTiming);
    const severeMiss = clamp((this.releaseMissSeverity - 0.28) / 0.72, 0, 1);
    this.releaseMissDrift = severeMiss > 0
      ? missDirection * (0.08 + 0.34 * Math.pow(severeMiss, 1.25))
        + (this.random() * 2 - 1) * 0.12 * severeMiss
      : 0;

    // Very weak deliveries are deliberately unstable. At minimum power the
    // ball often drifts into a gutter, which makes an expired shot clock a poor
    // but still visible/physical delivery instead of an invisible zero-pin roll.
    this.lowPowerDrift = power <= 0.16 && this.random() < 0.82
      ? (this.random() < 0.5 ? -1 : 1) * (0.58 + this.random() * 0.26)
      : 0;

    // Starting position, straight aim and hook are deliberately separate:
    // - startPosition chooses where the ball begins on the approach,
    // - aim chooses the straight target line,
    // - hook curves the ball away from that line later in the shot.
    // Release timing changes both accuracy and power. The accuracy penalty is
    // intentionally non-linear: a release far from green should no longer travel
    // neatly down the intended guide line.
    const startX = this.startPosition * START_POSITION_WORLD_X;
    const releaseError = releaseTiming * (0.11 + 0.26 * Math.pow(this.releaseMissSeverity, 1.35));
    const targetX = clamp(this.aim * 0.76 + releaseError, -0.94, 0.94);
    const worldSpeed = 0.58 + power * 0.46;
    const travelY = SHOT_TARGET_Y - SHOT_START_Y;
    this.shotStartX = startX;
    this.shotTargetX = targetX;

    this.ball = {
      x: startX,
      y: SHOT_START_Y,
      vx: ((targetX - startX) / travelY) * worldSpeed,
      vy: worldSpeed,
      radius: BALL_RADIUS,
      gutter: false,
      visible: true
    };

    this.pins.forEach((pin) => {
      pin.x = pin.homeX;
      pin.y = pin.homeY;
      pin.vx = 0;
      pin.vy = 0;
      pin.angle = 0;
      pin.angularVelocity = 0;
    });

    this.shotActive = true;
    this.shotElapsed = 0;
    this.simulationAccumulator = 0;
    this.settleElapsed = 0;
    this.lastTime = performance.now();

    return new Promise<BowlingShotResult>((resolve) => {
      this.shotResolver = resolve;
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = requestAnimationFrame((time) => this.tick(time));
    });
  }

  private tick(time: number): void {
    if (!this.shotActive || !this.ball) return;
    const elapsed = Math.min(0.05, Math.max(0.001, (time - this.lastTime) / 1000));
    this.lastTime = time;

    // A true fixed 120 Hz physics step makes a seeded shot deterministic across
    // a 30 Hz phone, 60 Hz laptop and 120 Hz iPad. That lets the opponent replay
    // the exact same trajectory and pin collisions instead of an approximation.
    const fixedDt = 1 / 120;
    this.simulationAccumulator = Math.min(0.1, this.simulationAccumulator + elapsed);
    let steps = 0;
    while (this.simulationAccumulator >= fixedDt && steps < 12) {
      this.step(fixedDt);
      this.shotElapsed += fixedDt;
      if (this.ball.y > 1.08) this.settleElapsed += fixedDt;
      this.simulationAccumulator -= fixedDt;
      steps++;
    }

    this.draw();

    const movingPins = this.pins.some((pin) => pin.knocked && (
      Math.hypot(pin.vx, pin.vy) > 0.012 || Math.abs(pin.angularVelocity) > 0.18
    ));
    const ballPastDeck = this.ball.y > 1.08;
    if (ballPastDeck) this.ball.visible = false;

    // Give pin action enough time for messenger pins/secondary collisions, but
    // cap the total animation so a weak device never stalls the match.
    if ((ballPastDeck && this.settleElapsed > 0.85 && !movingPins) || this.shotElapsed > 4.0) {
      return this.finishShot();
    }
    this.animationFrame = requestAnimationFrame((next) => this.tick(next));
  }

  private step(dt: number): void {
    const ball = this.ball!;

    if (ball.visible) {
      const previousX = ball.x;
      const previousY = ball.y;
      if (!ball.gutter) {
        const nextY = ball.y + ball.vy * dt;

        // Before the pin deck, follow one continuous shot path: a straight
        // line from the chosen start position to the aim target, plus a hook
        // displacement that grows monotonically in the chosen direction.
        // This prevents an extreme hook from visually curling back/straightening.
        if (nextY <= SHOT_TARGET_Y) {
          const progress = clamp((nextY - SHOT_START_Y) / (SHOT_TARGET_Y - SHOT_START_Y), 0, 1);
          ball.x = this.shotPathX(progress, this.shotStartX, this.shotTargetX, this.hook);
          ball.vx = (ball.x - previousX) / dt;
        } else {
          // Carry the tangent of the hook into the pin deck so the ball keeps
          // moving in the same curved direction through impact.
          ball.x += ball.vx * dt;
        }
        ball.y = nextY;
      } else {
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
      }

      if (!ball.gutter && Math.abs(ball.x) > LANE_HALF_WIDTH && ball.y < 0.94) {
        ball.gutter = true;
        ball.x = Math.sign(ball.x) * (LANE_HALF_WIDTH + 0.11);
        ball.vx *= 0.12;
      }

      if (!ball.gutter) this.collideBallWithPins(ball, previousX, previousY);
    }

    this.collidePins();
    this.collideFallenPinSweeps();
    this.movePins(dt);
    this.maybeNotifyLoudPinImpact(ball);
    this.maybeNotifyRackCleared(ball);
    this.maybeNotifyZeroPinMiss(ball);
  }

  private maybeNotifyLoudPinImpact(ball: SimBall): void {
    if (this.loudPinImpactNotified || ball.gutter || !this.loudPinImpactCallback) return;
    const knockedCount = this.pins.reduce((count, pin) => count + (this.initialStanding.has(pin.id) && pin.knocked ? 1 : 0), 0);
    // The supplied impact clip sounds like a substantial rack crash, so fire it
    // exactly when the third pin is visibly committed to falling. This keeps the
    // audio aligned with the animation while still suppressing it for 0–2 pin hits.
    if (knockedCount < 3) return;
    this.loudPinImpactNotified = true;
    this.loudPinImpactCallback();
  }

  private maybeNotifyRackCleared(ball: SimBall): void {
    if (this.rackClearedNotified || ball.gutter || !this.rackClearedCallback || this.initialStanding.size === 0) return;
    const knockedCount = this.pins.reduce((count, pin) => count + (this.initialStanding.has(pin.id) && pin.knocked ? 1 : 0), 0);
    // Fire the celebration at the visual scoring moment: the instant the final
    // standing pin is committed to falling, not after the rack has settled.
    if (knockedCount !== this.initialStanding.size) return;
    this.rackClearedNotified = true;
    this.rackClearedCallback();
  }

  private maybeNotifyZeroPinMiss(ball: SimBall): void {
    if (this.zeroPinMissNotified || !this.zeroPinMissCallback || this.initialStanding.size === 0) return;
    if (ball.y < ZERO_PIN_REACTION_Y) return;
    const knockedCount = this.pins.reduce((count, pin) => count + (this.initialStanding.has(pin.id) && pin.knocked ? 1 : 0), 0);
    if (knockedCount !== 0) return;
    this.zeroPinMissNotified = true;
    this.zeroPinMissCallback();
  }

  private collideBallWithPins(ball: SimBall, previousBallX: number, previousBallY: number): void {
    // Resolve genuine ball-to-pin contacts FIRST. The v0.7.26 gap bridge ran
    // before this loop, so a ball heading between the head pin and the 2/3 pin
    // could provisionally protect pin 1 before its real edge clip was tested.
    // That made visible grazes leave the head pin standing. Direct geometry now
    // always wins; the impossible-gap bridge is only a fallback afterwards.
    const directlyContacted = new Set<number>();

    for (const pin of this.pins) {
      if (!this.initialStanding.has(pin.id)) continue;
      let protectedStanding = this.rackCarryApplied && this.protectedLeavePins.has(pin.id) && !pin.knocked;
      if (pin.knocked && Math.hypot(pin.vx, pin.vy) < 0.005) continue;

      // Swept closest-point contact prevents a fast ball tunnelling through a
      // pin between two 120 Hz fixed steps.
      const segmentX = ball.x - previousBallX;
      const segmentY = ball.y - previousBallY;
      const segmentLengthSq = segmentX * segmentX + segmentY * segmentY;
      const toPinX = pin.x - previousBallX;
      const toPinY = pin.y - previousBallY;
      const segmentT = segmentLengthSq > 0.0000001
        ? clamp((toPinX * segmentX + toPinY * segmentY) / segmentLengthSq, 0, 1)
        : 1;
      const closestX = previousBallX + segmentX * segmentT;
      const closestY = previousBallY + segmentY * segmentT;
      const closestDx = pin.x - closestX;
      const closestDy = pin.y - closestY;
      const closestDistance = Math.hypot(closestDx, closestDy);
      const cornerPin = pin.id === 6 || pin.id === 9;

      // Pin 1 uses the stricter true-contact radius. The rest of the standing
      // rack keeps the slightly larger gameplay envelope that stops the ball
      // slipping through visually impossible gaps.
      const baseContactRadius = pin.knocked
        ? BALL_PIN_RADIUS
        : pin.id === 0
          ? HEAD_PIN_TRUE_CONTACT_RADIUS
          : BALL_STANDING_PIN_RADIUS;
      const effectiveRadius = baseContactRadius + (cornerPin ? CORNER_PIN_GRAZE_MARGIN : 0);
      if (closestDistance >= effectiveRadius) continue;

      // Use the FIRST point where the swept ball enters the contact circle for
      // the collision normal. Using the closest point (the old method) makes a
      // thin vertical clip produce an almost horizontal normal and virtually no
      // approach speed, which is why glancing head-pin hits felt dead.
      let contactX = closestX;
      let contactY = closestY;
      if (segmentLengthSq > 0.0000001) {
        const fx = previousBallX - pin.x;
        const fy = previousBallY - pin.y;
        const qa = segmentLengthSq;
        const qb = 2 * (fx * segmentX + fy * segmentY);
        const qc = fx * fx + fy * fy - effectiveRadius * effectiveRadius;
        const discriminant = qb * qb - 4 * qa * qc;
        if (discriminant >= 0) {
          const enterT = (-qb - Math.sqrt(discriminant)) / (2 * qa);
          if (enterT >= 0 && enterT <= 1) {
            contactX = previousBallX + segmentX * enterT;
            contactY = previousBallY + segmentY * enterT;
          }
        }
      }
      let dx = pin.x - contactX;
      let dy = pin.y - contactY;
      let distance = Math.hypot(dx, dy);

      // If pin 1 had been provisionally protected because the ball appeared to
      // miss it, a REAL later ball contact overrides that protection. A clean
      // miss never reaches this branch, while an actual visible graze now falls
      // and carries correctly.
      if (pin.id === 0 && protectedStanding && !pin.knocked) {
        this.protectedLeavePins.delete(0);
        protectedStanding = false;
      }

      directlyContacted.add(pin.id);

      if (distance <= 0.0001) {
        dx = pin.x - ball.x;
        dy = pin.y - ball.y;
        distance = Math.hypot(dx, dy);
      }
      if (distance <= 0.0001) {
        dx = 0;
        dy = 1;
        distance = 1;
      }

      const nx = dx / distance;
      const ny = dy / distance;
      const relativeVx = ball.vx - pin.vx;
      const relativeVy = ball.vy - pin.vy;
      const incomingBallVy = ball.vy;
      const approach = Math.max(0.10, relativeVx * nx + relativeVy * ny);

      // Classify the contact continuously. A centre hit has glanceAmount ~= 0;
      // a shave around the outside edge tends toward 1. Thin hits transfer less
      // normal energy, but MORE lateral/tumbling energy, which makes the pin
      // skittle across the rack instead of simply falling backwards.
      const radialRatio = clamp(closestDistance / Math.max(0.0001, effectiveRadius), 0, 1);
      const glanceAmount = clamp((radialRatio - 0.42) / 0.56, 0, 1);
      const baseGrazeStrength = lerp(1.0, 0.76, glanceAmount);
      const cornerAllowance = cornerPin ? 0.92 + 0.08 * Math.sqrt(1 - radialRatio) : 1;
      const grazeStrength = baseGrazeStrength * cornerAllowance;

      const normalImpulse = ((1 + BALL_PIN_RESTITUTION) * approach * grazeStrength)
        / (1 / BALL_MASS_KG + 1 / PIN_MASS_KG);
      const pinNormalDelta = normalImpulse / PIN_MASS_KG;
      const ballNormalDelta = normalImpulse / BALL_MASS_KG;

      const overlap = Math.max(0, effectiveRadius - closestDistance);
      const tx = -ny;
      const ty = nx;
      const tangentialSpeed = relativeVx * tx + relativeVy * ty;
      const tangentialTransfer = tangentialSpeed * lerp(0.10, 0.18, glanceAmount) * grazeStrength;
      const ballTangentialReaction = tangentialTransfer * (PIN_MASS_KG / BALL_MASS_KG);

      if (protectedStanding) {
        // Scoring-protected leaves are still physically solid. Pin 1 is handled
        // above, so only genuine leave pins reach this branch.
        ball.x -= nx * overlap * 0.96;
        ball.y -= ny * overlap * 0.96;
        ball.vx -= nx * ballNormalDelta * 0.92 + tx * ballTangentialReaction * 0.55;
        ball.vy = Math.max(incomingBallVy * 0.70, 0.22,
          ball.vy - ny * ballNormalDelta * 0.92 - ty * ballTangentialReaction * 0.55);
        continue;
      }

      pin.x += nx * overlap * 0.7;
      pin.y += ny * overlap * 0.7;
      ball.x -= nx * overlap * 0.3;
      ball.y -= ny * overlap * 0.3;

      pin.vx += nx * pinNormalDelta;
      pin.vy += ny * pinNormalDelta;
      ball.vx -= nx * ballNormalDelta;
      ball.vy = Math.max(0.24, ball.vy - ny * ballNormalDelta);

      pin.vx += tx * tangentialTransfer;
      pin.vy += ty * tangentialTransfer;
      ball.vx -= tx * ballTangentialReaction;
      ball.vy = Math.max(0.24, ball.vy - ty * ballTangentialReaction);

      // Glancing shots are where real racks become lively. Add deterministic
      // lateral skittle energy to the clipped pin, rather than extra backwards
      // speed, so it becomes a messenger across/behind the pocket.
      if (glanceAmount > 0.18) {
        const skittleBoost = (0.020 + 0.070 * glanceAmount) * (0.82 + this.shotPower * 0.30);
        pin.vx += nx * skittleBoost + tx * Math.sign(tangentialSpeed || nx || 1) * skittleBoost * 0.30;
        pin.vy += Math.max(0, incomingBallVy) * 0.045 * glanceAmount;
      }

      const sideTumble = -nx * approach * lerp(3.6, 6.7, glanceAmount);
      const tangentTumble = tangentialSpeed * lerp(4.8, 7.8, glanceAmount);
      pin.angularVelocity += (sideTumble + tangentTumble + this.hook * 0.65)
        * (0.92 + this.random() * 0.16);
      if (glanceAmount > 0.25) {
        pin.angularVelocity += -nx * (0.9 + 2.5 * glanceAmount) * (0.90 + this.random() * 0.20);
      }

      pin.knocked = true;
      if (pin.id === 0) this.headPinHit = true;

      if (!this.rackCarryApplied && this.initialStanding.size === 10) {
        this.applyRackEntryDynamics(ball, pin.id);
      }

      // A heavy bowling ball should continue through the pocket. Preserve more
      // forward speed on a thin clip than on a square hit so it cannot appear to
      // stick behind pin 1 while scripted/messenger pins fall farther back.
      const minimumForwardRetention = incomingBallVy * lerp(0.72, 0.88, glanceAmount);
      ball.vy = Math.max(0.26, ball.vy, minimumForwardRetention);
    }

    // Only after all genuine contacts have been tested do we bridge a visually
    // impossible gap between two untouched adjacent standing pins.
    this.applyAdjacentGapContact(ball, previousBallX, previousBallY, directlyContacted);
  }

  private applyAdjacentGapContact(
    ball: SimBall,
    previousBallX: number,
    previousBallY: number,
    directlyContacted: ReadonlySet<number> = new Set<number>()
  ): Set<number> {
    const contacted = new Set<number>();
    if (ball.gutter || ball.vy <= 0) return contacted;

    for (const [leftId, rightId, midpoint, rowY] of ADJACENT_PIN_GAPS) {
      const leftPin = this.pins[leftId];
      const rightPin = this.pins[rightId];
      if (!leftPin || !rightPin) continue;
      if (!this.initialStanding.has(leftId) || !this.initialStanding.has(rightId)) continue;
      if (leftPin.knocked || rightPin.knocked) continue;
      // If the ball really clipped either member of this pair during this step,
      // never replace that physical contact with the artificial gap bridge.
      if (directlyContacted.has(leftId) || directlyContacted.has(rightId)) continue;

      const zoneStart = rowY - ADJACENT_GAP_Y_TOLERANCE;
      if (ball.y < zoneStart || previousBallY > rowY + 0.025) continue;

      const timeToRow = (rowY - ball.y) / Math.max(0.15, ball.vy);
      const projectedX = ball.x + ball.vx * timeToRow;
      if (Math.abs(projectedX - midpoint) > ADJACENT_GAP_HALF_WIDTH) continue;

      // By the time the ball has genuinely reached the 2/3-pin corridor without
      // a direct pin-1 contact, the head pin was clearly missed. Protect it from
      // later scripted carry/messengers; a true graze would already have been
      // detected by the direct-contact loop above.
      if (this.initialStanding.size === 10 && !this.headPinHit && this.initialStanding.has(0)) {
        this.protectedLeavePins.add(0);
      }

      const incomingBallVy = ball.vy;
      const forward = Math.max(0.18, ball.vy * 0.29);
      const sharedLateral = ball.vx * 0.14;
      const spread = 0.122 + Math.min(0.040, Math.abs(ball.vx) * 0.05);

      const leftProtected = this.rackCarryApplied && this.protectedLeavePins.has(leftId);
      const rightProtected = this.rackCarryApplied && this.protectedLeavePins.has(rightId);
      if (!leftProtected) this.kickPin(leftId, sharedLateral - spread, forward, -4.7);
      if (!rightProtected) this.kickPin(rightId, sharedLateral + spread, forward, 4.7);

      // The ball cannot fit through the gap, but it should not stop dead either.
      // It gives up a believable chunk of speed and is deflected through the rack.
      ball.vy = Math.max(0.30, incomingBallVy * 0.82);
      ball.vx *= 0.80;
      if (leftProtected !== rightProtected) {
        ball.vx += leftProtected ? 0.060 : -0.060;
      } else {
        ball.vx += (projectedX - midpoint) * 0.18;
      }

      contacted.add(leftId);
      contacted.add(rightId);
      break;
    }
    return contacted;
  }

  private collidePins(): void {
    for (let i = 0; i < this.pins.length; i++) {
      const a = this.pins[i];
      if (!this.initialStanding.has(a.id)) continue;
      for (let j = i + 1; j < this.pins.length; j++) {
        const b = this.pins[j];
        if (!this.initialStanding.has(b.id)) continue;
        if ((!a.knocked && !b.knocked) || (a.knocked && b.knocked && Math.hypot(a.vx - b.vx, a.vy - b.vy) < 0.01)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.0001 || distance >= PIN_PIN_RADIUS) continue;
        const nx = dx / distance;
        const ny = dy / distance;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const overlap = PIN_PIN_RADIUS - distance;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;

        // Only apply collision impulse while the pins are actually closing.
        // The old minimum impulse injected fresh energy into already-separating
        // overlaps, which could make rack action look springy or explosive.
        const impactSpeed = Math.max(0, rel);
        if (impactSpeed <= 0.002) continue;
        // Equal-mass pin collision with deliberately modest restitution. Real
        // pins thud and tumble; they do not rebound like billiard balls.
        const impulseJ = ((1 + PIN_PIN_RESTITUTION) * impactSpeed)
          / (1 / PIN_MASS_KG + 1 / PIN_MASS_KG);
        const impulse = impulseJ / PIN_MASS_KG;

        a.vx -= nx * impulse;
        a.vy -= ny * impulse;
        b.vx += nx * impulse;
        b.vy += ny * impulse;

        // Keep tangential rotation restrained so messenger pins sweep across the
        // deck rather than cartwheeling unrealistically after every side hit.
        const tx = -ny;
        const ty = nx;
        const relativeTangentialSpeed = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty;
        const spinTransfer = relativeTangentialSpeed * 3.4;

        // A moving fallen pin can take out a standing neighbour just like a
        // messenger pin in real ten-pin bowling. Straight head-ball shots make
        // the 7/10 pins deliberately harder to carry; strong pocket shots lower
        // that resistance because energy is travelling across the deck.
        if (a.knocked && !this.protectedLeavePins.has(b.id) && impulse > this.pinCarryThreshold(b.id)) b.knocked = true;
        if (b.knocked && !this.protectedLeavePins.has(a.id) && impulse > this.pinCarryThreshold(a.id)) a.knocked = true;
        if (a.knocked) {
          a.angularVelocity += (-spinTransfer - nx * impulse * 4.0) * (0.88 + this.random() * 0.24);
        }
        if (b.knocked) {
          b.angularVelocity += (spinTransfer + nx * impulse * 4.0) * (0.88 + this.random() * 0.24);
        }
      }
    }
  }

  private collideFallenPinSweeps(): void {
    // A real pin lying across the deck is much longer than its circular belly.
    // Model that fallen body as a short moving capsule. When its swept body
    // reaches a standing pin, transfer messenger momentum and let that target
    // skittle naturally into the next row.
    for (const mover of this.pins) {
      if (!this.initialStanding.has(mover.id) || !mover.knocked) continue;
      const fallAmount = clamp(Math.abs(mover.angle) / 1.46, 0, 1);
      const speed = Math.hypot(mover.vx, mover.vy);
      if (fallAmount < FALLEN_PIN_SWEEP_MIN_FALL || speed < FALLEN_PIN_SWEEP_MIN_SPEED) continue;

      // A sliding pin tends to lie broadly along its direction of travel. Add a
      // small angular component so spinning messengers can sweep sideways too.
      let axisX = mover.vx / Math.max(speed, 0.0001);
      let axisY = mover.vy / Math.max(speed, 0.0001);
      const spinSide = Math.sign(mover.angularVelocity || mover.angle || 1);
      axisX += spinSide * 0.24 * fallAmount;
      const axisLength = Math.hypot(axisX, axisY) || 1;
      axisX /= axisLength;
      axisY /= axisLength;

      const halfLength = FALLEN_PIN_SWEEP_HALF_LENGTH * lerp(0.72, 1, fallAmount);
      const ax = mover.x - axisX * halfLength;
      const ay = mover.y - axisY * halfLength;
      const bx = mover.x + axisX * halfLength;
      const by = mover.y + axisY * halfLength;

      for (const target of this.pins) {
        if (target.id === mover.id || !this.initialStanding.has(target.id) || target.knocked) continue;
        if (this.protectedLeavePins.has(target.id)) continue;

        const abx = bx - ax;
        const aby = by - ay;
        const abLenSq = abx * abx + aby * aby;
        const t = abLenSq > 0.0000001
          ? clamp(((target.x - ax) * abx + (target.y - ay) * aby) / abLenSq, 0, 1)
          : 0.5;
        const closestX = ax + abx * t;
        const closestY = ay + aby * t;
        const dx = target.x - closestX;
        const dy = target.y - closestY;
        const distance = Math.hypot(dx, dy);
        const effectiveRadius = FALLEN_PIN_SWEEP_RADIUS + STANDING_PIN_BALL_CONTACT_RADIUS * 0.72;
        if (distance >= effectiveRadius) continue;

        let nx = distance > 0.0001 ? dx / distance : -axisY;
        let ny = distance > 0.0001 ? dy / distance : axisX;
        const sweepEnergy = clamp(speed * (0.84 + 0.38 * fallAmount) + Math.abs(mover.angularVelocity) * 0.016, 0.05, 0.48);
        const randomness = 0.82 + this.random() * 0.38;

        target.knocked = true;
        target.vx += (mover.vx * 0.54 + nx * sweepEnergy * 0.84) * randomness;
        target.vy += (mover.vy * 0.54 + ny * sweepEnergy * 0.38) * (0.86 + this.random() * 0.30);
        target.angularVelocity += (spinSide * 3.8 + nx * 3.0) * (0.82 + this.random() * 0.40);

        // The messenger gives up some momentum, but keeps enough to continue
        // through a small cluster just like a pin sliding horizontally through
        // the back row in real bowling.
        mover.vx *= 0.85;
        mover.vy *= 0.86;
        mover.angularVelocity *= 0.91;
      }
    }
  }

  private applyRackEntryDynamics(ball: SimBall, struckPinId: number): void {
    this.rackCarryApplied = true;

    const hookAmount = Math.abs(this.hook);
    const entryX = ball.x;
    const entrySlope = ball.vx / Math.max(0.15, ball.vy);
    const pocketSide = entryX === 0 ? (this.hook >= 0 ? 1 : -1) : Math.sign(entryX);

    // If the ball gets past the head pin and first contacts the 2/3 pin or a
    // deeper pin, the head pin must remain standing. Earlier scripted carry
    // could magically knock over pin 1 even though neither the ball nor a real
    // collision chain touched it. Protect it for the whole shot once the first
    // rack contact proves the ball missed it.
    if (struckPinId !== 0 && this.initialStanding.has(0)) {
      this.protectedLeavePins.add(0);
    }

    // A release outside the green zone must not strike, but do not immediately
    // protect a second corner pin here. Doing so before the carry branch was a
    // major source of artificial 7-10 splits. High-quality non-strikes will use
    // this single preferred leave later.
    const forcedNonStrikeLeave = !this.strikeEligible ? (pocketSide > 0 ? 6 : 9) : null;

    // A badly mistimed release should look and score badly even if it happens to
    // clip the rack. Most severe misses only take 1-3 pins and suppress secondary
    // carry, matching the large accuracy error already applied to the ball path.
    if (this.releaseMissSeverity > 0.68) {
      const allowedCount = 1 + Math.floor(this.random() * 3);
      const candidates = [struckPinId, 0, 1, 2, 3, 5, 4, 7, 8, 6, 9]
        .filter((id, index, arr) => this.initialStanding.has(id) && arr.indexOf(id) === index);
      const allowed = new Set(candidates.slice(0, allowedCount));
      for (const id of this.initialStanding) {
        if (!allowed.has(id)) this.protectedLeavePins.add(id);
      }
      for (const id of allowed) {
        const side = PIN_LAYOUT[id][0] === 0 ? (this.random() < 0.5 ? -1 : 1) : Math.sign(PIN_LAYOUT[id][0]);
        this.kickPin(id, side * (0.08 + this.random() * 0.05), 0.17 + this.random() * 0.07, side * (2.8 + this.random() * 2.2));
      }
      return;
    }

    // Anti-exploit: very large aim and hook values pulling in opposite
    // directions should over-cross the pocket, not magically cancel into a
    // perfect strike line. On a full rack, a strongly over-steered shot is
    // intentionally a messy 4-7 pin result even with a perfect release.
    // The exact pins vary so the outcome does not become another memorised
    // pattern. Moderate opposing settings are unaffected.
    if (this.extremeOppositionSeverity > 0.52) {
      const severity = this.extremeOppositionSeverity;
      const minDown = severity > 0.86 ? 4 : 5;
      const maxDown = severity > 0.86 ? 6 : 7;
      const allowedCount = minDown + Math.floor(this.random() * (maxDown - minDown + 1));

      const baseOrder = [struckPinId, 0, 1, 2, 4, 3, 5, 7, 8, 6, 9]
        .filter((id, index, arr) => this.initialStanding.has(id) && arr.indexOf(id) === index);
      const first = baseOrder.shift();
      // Deterministically shuffle the remaining rack so repeated extreme shots
      // leave different spare shapes while preserving the struck pin.
      for (let i = baseOrder.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [baseOrder[i], baseOrder[j]] = [baseOrder[j], baseOrder[i]];
      }
      const candidates = first === undefined ? baseOrder : [first, ...baseOrder];
      const allowed = new Set(candidates.slice(0, allowedCount));

      for (const id of this.initialStanding) {
        if (!allowed.has(id)) this.protectedLeavePins.add(id);
      }
      for (const id of allowed) {
        if (id === struckPinId) continue;
        const x = PIN_LAYOUT[id][0];
        const side = x === 0 ? (this.random() < 0.5 ? -1 : 1) : Math.sign(x);
        this.kickPin(
          id,
          side * (0.10 + this.random() * 0.08),
          0.20 + this.random() * 0.09,
          side * (3.0 + this.random() * 3.2)
        );
      }
      return;
    }

    // Straight head balls can still produce difficult leaves, but a 7-10
    // should be an exceptional punishment for a genuinely poor delivery rather
    // than a routine outcome. Better straight shots now favour a single-pin or
    // simple two-pin leave.
    const headAreaHit = struckPinId === 0 || (Math.abs(entryX) < 0.22 && struckPinId <= 2);
    this.straightHeadBall = hookAmount < 0.12 && headAreaHit;
    if (this.straightHeadBall) {
      const releaseQuality = clamp(1 - Math.abs(this.shotReleaseTiming) / 0.72, 0, 1);
      const powerQuality = clamp((this.shotPower - 0.28) / 0.72, 0, 1);
      const quality = 0.55 * releaseQuality + 0.45 * powerQuality;

      const strongLeaves: number[][] = [
        [6], [9], [7], [8], [5], [3], [4],
        [6, 7], [8, 9], [7, 8]
      ];
      const mediumLeaves: number[][] = [
        [6], [9], [7], [8],
        [6, 7], [8, 9], [3, 6], [5, 9], [6, 8], [7, 9],
        [6, 7, 8], [7, 8, 9]
      ];

      // The 7-10 split is now restricted to a distinctly poor straight head
      // ball and is still rare inside that group. A close-to-strike delivery
      // cannot randomly turn into a 7-10 split.
      const genuinelyBadStraight = quality < 0.46
        && (this.releaseMissSeverity > 0.30 || this.shotPower < 0.52);
      const sevenTenChance = genuinelyBadStraight ? 0.006 : 0;
      const rareStraightStrikeChance = this.strikeEligible && quality > 0.82
        ? (this.neutralAimAndHook ? 0.012 : 0.035)
        : 0;

      let leavePattern: number[];
      if (this.random() < rareStraightStrikeChance) leavePattern = [];
      else if (this.random() < sevenTenChance) leavePattern = [6, 9];
      else if (quality > 0.72) {
        // Close straight shots should most commonly score nine, not produce an
        // impossible split. Choose from the single-pin part of the strong pool.
        const singleLeaves = [[6], [9], [7], [8], [5], [3], [4]];
        leavePattern = singleLeaves[Math.floor(this.random() * singleLeaves.length)];
      } else if (quality > 0.58) {
        leavePattern = strongLeaves[Math.floor(this.random() * strongLeaves.length)];
      } else {
        leavePattern = mediumLeaves[Math.floor(this.random() * mediumLeaves.length)];
      }

      // A non-green release must leave something standing. If the random branch
      // happened to choose a strike, convert it into one simple corner leave.
      if (leavePattern.length === 0 && forcedNonStrikeLeave !== null) {
        leavePattern = [forcedNonStrikeLeave];
      }

      leavePattern.forEach((id) => this.protectedLeavePins.add(id));
      const kickStrength = 0.14 + 0.082 * powerQuality;
      for (let id = 0; id < this.pins.length; id++) {
        if (this.protectedLeavePins.has(id)) continue;
        const x = PIN_LAYOUT[id][0];
        const side = x === 0 ? (this.random() < 0.5 ? -1 : 1) : Math.sign(x);
        this.kickPin(
          id,
          side * kickStrength * (0.72 + this.random() * 0.62),
          (0.25 + 0.12 * powerQuality) * (0.78 + this.random() * 0.48),
          side * (3.2 + this.random() * 3.8)
        );
      }
      return;
    }

    // A good strike line enters just off the head pin while still moving
    // inward: right-side pocket with leftward motion, or left-side pocket with
    // rightward motion. That is the 2.5D equivalent of the classic inside / 
    // track / outside strike angles in the supplied lane diagram.
    const pocketOffsetQuality = clamp(1 - Math.abs(Math.abs(entryX) - 0.095) / 0.20, 0, 1);
    const inwardSlope = -pocketSide * entrySlope;
    const angleQuality = clamp(1 - Math.abs(inwardSlope - 0.25) / 0.42, 0, 1);

    // Hook quality now has a broad useful middle range rather than a tiny sweet
    // spot. Roughly 20-55% hook can all produce quality pocket carry when the
    // aim/start position agree with it; maximum hook remains an over-steer risk.
    const hookQuality = clamp(1 - Math.abs(hookAmount - 0.38) / 0.42, 0, 1);
    const releaseQuality = clamp(1 - Math.abs(this.shotReleaseTiming) / 0.48, 0, 1);
    const powerQuality = clamp(1 - Math.abs(this.shotPower - 0.82) / 0.48, 0, 1);
    const startOutside = Math.sign(this.shotStartX || pocketSide) === pocketSide ? 1 : 0.80;

    // Entry angle matters independently of final pocket position, but the viable
    // window is intentionally generous enough for classroom play. Moderate
    // pocket lines are rewarded; only genuinely steep over-crossing shots get
    // heavily gated. This keeps the max-slider exploit closed without making
    // strikes feel impossibly precise.
    const steepEntryPenalty = clamp((inwardSlope - 0.62) / 0.34, 0, 1);
    const entryAngleGate = 1 - 0.82 * steepEntryPenalty;
    const oppositionGate = 1 - 0.84 * this.extremeOppositionSeverity;

    this.pocketQuality = clamp(
      (0.30 * pocketOffsetQuality + 0.25 * angleQuality + 0.18 * hookQuality + 0.15 * releaseQuality + 0.12 * powerQuality)
        * startOutside * entryAngleGate * oppositionGate,
      0,
      1
    );

    // The better the pocket entry, the more the rack fans sideways instead of
    // simply being pushed backward. This creates visible pin-to-pin carry.
    const carry = this.pocketQuality;
    if (carry < 0.18) return;

    const fanStrength = 0.11 + carry * 0.18;
    const forwardStrength = 0.20 + carry * 0.16;
    const rackOrder = [0, 1, 2, 4, 3, 5, 7, 8, 6, 9];

    // Good pocket shots reliably clear the middle; excellent shots also send
    // messenger pins toward the corners. Natural variation remains, so a
    // perfect-looking line is strongly rewarded but never an automatic strike.
    const guaranteedMiddle = carry > 0.66 ? 8 : carry > 0.46 ? 7 : carry > 0.28 ? 6 : 4;
    for (let i = 0; i < guaranteedMiddle; i++) {
      const id = rackOrder[i];
      const x = PIN_LAYOUT[id][0];
      const side = x === 0 ? (i % 2 ? -pocketSide : pocketSide) : Math.sign(x);
      this.kickPin(id, side * fanStrength * (0.75 + this.random() * 0.45), forwardStrength * (0.82 + this.random() * 0.35), side * (3.2 + carry * 3.5));
    }

    const strikeChance = this.strikeEligible
      ? clamp((carry - 0.38) * 1.55, 0, 0.72) * (0.80 + 0.20 * releaseQuality) * (0.84 + 0.16 * powerQuality)
      : 0;
    if (this.random() < strikeChance) {
      for (let id = 0; id < this.pins.length; id++) {
        const x = PIN_LAYOUT[id][0];
        const side = x === 0 ? (id % 2 ? -pocketSide : pocketSide) : Math.sign(x);
        this.kickPin(id, side * (fanStrength + 0.05) * (0.82 + this.random() * 0.42), (forwardStrength + 0.04) * (0.82 + this.random() * 0.38), side * (4.0 + carry * 3.9));
      }
    } else if (carry > 0.58) {
      // A genuinely close pocket shot should overwhelmingly be a nine-count.
      // Explicitly choose ONE believable leave and send the rest of the rack.
      // This removes the accidental high-frequency 7-10 outcome from the old
      // branch where both corners could simply survive independently.
      const farCorner = pocketSide > 0 ? 6 : 9;
      const nearCorner = pocketSide > 0 ? 9 : 6;
      const nineCountLeaves = [farCorner, nearCorner, 7, 8, 5];
      const leaveId = forcedNonStrikeLeave !== null
        ? forcedNonStrikeLeave
        : nineCountLeaves[Math.floor(this.random() * nineCountLeaves.length)];
      this.protectedLeavePins.add(leaveId);

      for (let id = 0; id < this.pins.length; id++) {
        if (!this.initialStanding.has(id) || this.protectedLeavePins.has(id)) continue;
        const x = PIN_LAYOUT[id][0];
        const side = x === 0 ? (this.random() < 0.5 ? -pocketSide : pocketSide) : Math.sign(x);
        this.kickPin(
          id,
          side * (fanStrength + 0.025) * (0.78 + this.random() * 0.48),
          (forwardStrength + 0.018) * (0.80 + this.random() * 0.40),
          side * (3.8 + carry * 3.8)
        );
      }
    } else if (carry > 0.42) {
      // Decent but not near-strike pocket entries generally leave one or two
      // pins. Never manufacture a 7-10 here.
      const farCorner = pocketSide > 0 ? 6 : 9;
      const nearCorner = pocketSide > 0 ? 9 : 6;
      const leavePatterns: number[][] = forcedNonStrikeLeave !== null
        ? [[forcedNonStrikeLeave], [forcedNonStrikeLeave, 7], [forcedNonStrikeLeave, 8]]
        : [[farCorner], [nearCorner], [7], [8], [farCorner, 7], [nearCorner, 8], [7, 8]];
      const leavePattern = leavePatterns[Math.floor(this.random() * leavePatterns.length)];
      leavePattern.forEach((id) => this.protectedLeavePins.add(id));
      for (let id = 0; id < this.pins.length; id++) {
        if (!this.initialStanding.has(id) || this.protectedLeavePins.has(id)) continue;
        if (this.pins[id].knocked) continue;
        const x = PIN_LAYOUT[id][0];
        const side = x === 0 ? (this.random() < 0.5 ? -pocketSide : pocketSide) : Math.sign(x);
        this.kickPin(id, side * fanStrength * (0.72 + this.random() * 0.54), forwardStrength * (0.76 + this.random() * 0.46), side * (3.0 + carry * 3.4));
      }
    } else if (forcedNonStrikeLeave !== null) {
      this.protectedLeavePins.add(forcedNonStrikeLeave);
    }
  }

  private kickPin(id: number, vx: number, vy: number, spin: number): void {
    const pin = this.pins[id];
    if (!pin || !this.initialStanding.has(id)) return;
    if (this.protectedLeavePins.has(id)) return;
    pin.knocked = true;
    const energyJitter = 0.88 + this.random() * 0.28;
    // Small deterministic deck scatter keeps repeated-looking racks from
    // collapsing in exactly the same visual pattern while remaining perfectly
    // reproducible from the shared shot seed on both players' devices.
    const lateralScatter = (this.random() * 2 - 1) * (0.014 + Math.abs(vy) * 0.035);
    pin.vx += vx * PIN_KICK_TRANSLATION_SCALE * energyJitter + lateralScatter;
    pin.vy += vy * PIN_KICK_TRANSLATION_SCALE * (0.88 + this.random() * 0.26);
    pin.angularVelocity += spin * PIN_KICK_SPIN_SCALE * (0.82 + this.random() * 0.36);
  }

  private pinCarryThreshold(pinId: number): number {
    if (this.protectedLeavePins.has(pinId)) return 0.30;
    const isCorner = pinId === 6 || pinId === 9; // 7-pin / 10-pin
    if (!isCorner) return 0.036;
    if (this.straightHeadBall) return 0.16;
    return lerp(0.105, 0.035, this.pocketQuality);
  }

  private movePins(dt: number): void {
    for (const pin of this.pins) {
      if (!this.initialStanding.has(pin.id) || !pin.knocked) continue;
      pin.x += pin.vx * dt;
      pin.y += pin.vy * dt;

      // Once a real pin has passed its balance point, gravity finishes the fall.
      // Our previous 2.5D pin could lose angular velocity and freeze at a shallow
      // lean. Add a small deterministic toppling torque so a committed pin falls
      // through to an almost-horizontal resting pose.
      const currentTilt = Math.abs(pin.angle);
      if (currentTilt < 1.46) {
        const fallbackDirection = pin.id % 2 === 0 ? 1 : -1;
        const tumbleDirection = Math.sign(pin.angularVelocity || pin.angle || pin.vx || fallbackDirection);
        const gravityTumble = 1.7 + 2.35 * Math.sin(Math.min(1.46, currentTilt + 0.10));
        pin.angularVelocity += tumbleDirection * gravityTumble * dt;
      }
      pin.angularVelocity = clamp(pin.angularVelocity, -5.4, 5.4);
      pin.angle += pin.angularVelocity * dt;

      // Upright/tipping pins retain motion slightly better; once nearly flat,
      // the larger deck contact patch adds more translational and rotational
      // friction, like a real fallen pin sliding on the pin deck.
      const fallAmount = clamp(Math.abs(pin.angle) / 1.46, 0, 1);
      const linearDragPerFrame = lerp(0.978, 0.962, fallAmount);
      const angularDragPerFrame = lerp(0.971, 0.950, fallAmount);
      const drag = Math.pow(linearDragPerFrame, dt * 60);
      pin.vx *= drag;
      pin.vy *= drag;
      pin.angularVelocity *= Math.pow(angularDragPerFrame, dt * 60);

      // Kickback/side-wall reaction. Keep it damped: real kickbacks can return a
      // messenger pin, but should never behave like a pinball bumper.
      if (Math.abs(pin.x) > 0.61) {
        pin.x = Math.sign(pin.x) * 0.61;
        pin.vx *= -0.24;
      }
    }
  }

  private finishShot(): void {
    cancelAnimationFrame(this.animationFrame);
    this.shotActive = false;
    let knockedPins = this.pins.filter((pin) => this.initialStanding.has(pin.id) && pin.knocked).map((pin) => pin.id).sort((a, b) => a - b);
    // Safety fallback only: protected leaves should already remain standing
    // throughout the visible animation. This guard prevents a scoring mismatch
    // if a future physics change somehow bypasses that protection.
    if (this.initialStanding.size === 10 && !this.strikeEligible && knockedPins.length === 10) {
      const leaveId = this.hook >= 0 ? 6 : 9;
      const leavePin = this.pins[leaveId];
      if (leavePin) {
        leavePin.knocked = false;
        leavePin.vx = leavePin.vy = leavePin.angularVelocity = 0;
        leavePin.angle = 0;
        leavePin.x = leavePin.homeX;
        leavePin.y = leavePin.homeY;
      }
      knockedPins = knockedPins.filter((id) => id !== leaveId);
    }
    const result: BowlingShotResult = {
      knockedPins,
      speedKmh: Math.round(this.speedKmh * 10) / 10,
      gutter: Boolean(this.ball?.gutter),
      headPinHit: this.headPinHit
    };
    const resolve = this.shotResolver;
    this.shotResolver = undefined;
    this.loudPinImpactCallback = undefined;
    this.rackClearedCallback = undefined;
    this.zeroPinMissCallback = undefined;
    this.draw();
    resolve?.(result);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    ctx.clearRect(0, 0, w, h);

    this.drawEnvironment(w, h);
    if (!this.shotActive && this.setupVisible) this.drawAimGuide(w, h);

    const orderedPins = [...this.pins].sort((a, b) => b.y - a.y);
    for (const pin of orderedPins) {
      if (!pin.knocked || Math.abs(pin.x - pin.homeX) + Math.abs(pin.y - pin.homeY) > 0.002) {
        this.drawPin(pin, w, h);
      }
    }
    if (this.ball?.visible !== false && (this.shotActive || this.setupVisible)) this.drawBall(this.ball ?? { x: this.startPosition * START_POSITION_WORLD_X, y: SHOT_START_Y, vx: 0, vy: 0, radius: BALL_RADIUS, gutter: false, visible: true }, w, h);
  }

  private drawEnvironment(w: number, h: number): void {
    const ctx = this.ctx;
    const topY = h * LANE_TOP_Y_RATIO;
    const bottomY = h * LANE_BOTTOM_Y_RATIO;
    const topHalf = w * LANE_TOP_HALF_RATIO;
    const bottomHalf = w * LANE_BOTTOM_HALF_RATIO;
    const center = w / 2;

    // Back wall / pin deck machinery.
    const wall = ctx.createLinearGradient(0, 0, 0, h * 0.25);
    wall.addColorStop(0, '#1f0e35');
    wall.addColorStop(1, '#422052');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h * 0.18);
    ctx.fillStyle = '#12091f';
    ctx.fillRect(center - topHalf * 1.25, topY - 5, topHalf * 2.5, h * 0.09);

    // Gutters first, then the lane trapezoid over them.
    ctx.fillStyle = '#38243f';
    ctx.beginPath();
    ctx.moveTo(center - topHalf * 1.42, topY);
    ctx.lineTo(center - topHalf, topY);
    ctx.lineTo(center - bottomHalf, bottomY);
    ctx.lineTo(center - bottomHalf * 1.30, bottomY);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(center + topHalf, topY);
    ctx.lineTo(center + topHalf * 1.42, topY);
    ctx.lineTo(center + bottomHalf * 1.30, bottomY);
    ctx.lineTo(center + bottomHalf, bottomY);
    ctx.closePath();
    ctx.fill();

    const laneGradient = ctx.createLinearGradient(0, topY, 0, bottomY);
    laneGradient.addColorStop(0, '#e8b86f');
    laneGradient.addColorStop(0.45, '#efc77e');
    laneGradient.addColorStop(1, '#d9a45e');
    ctx.fillStyle = laneGradient;
    ctx.beginPath();
    ctx.moveTo(center - topHalf, topY);
    ctx.lineTo(center + topHalf, topY);
    ctx.lineTo(center + bottomHalf, bottomY);
    ctx.lineTo(center - bottomHalf, bottomY);
    ctx.closePath();
    ctx.fill();

    // 39-board impression with perspective board lines.
    ctx.save();
    ctx.strokeStyle = 'rgba(112,66,42,.18)';
    ctx.lineWidth = 1;
    for (let i = -6; i <= 6; i++) {
      const t = i / 6;
      ctx.beginPath();
      ctx.moveTo(center + t * topHalf, topY);
      ctx.lineTo(center + t * bottomHalf, bottomY);
      ctx.stroke();
    }
    ctx.restore();

    // Foul line and target arrows.
    const foulY = this.project(0, 0.13, w, h).y;
    const foulHalf = this.halfWidthAt(0.13, w);
    ctx.strokeStyle = '#5b3d31';
    ctx.lineWidth = Math.max(2, w * 0.005);
    ctx.beginPath();
    ctx.moveTo(center - foulHalf, foulY);
    ctx.lineTo(center + foulHalf, foulY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(76,45,73,.65)';
    [-0.48, -0.32, -0.16, 0, 0.16, 0.32, 0.48].forEach((x) => {
      const point = this.project(x, 0.44, w, h);
      const size = Math.max(3, w * 0.009);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - size);
      ctx.lineTo(point.x - size * 0.65, point.y + size);
      ctx.lineTo(point.x + size * 0.65, point.y + size);
      ctx.closePath();
      ctx.fill();
    });

    // Pin-deck dots make the formation read like a real bowling lane.
    ctx.fillStyle = 'rgba(93,54,43,.20)';
    PIN_LAYOUT.forEach(([x, y]) => {
      const point = this.project(x, y, w, h);
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(1.5, w * 0.003), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawAimGuide(w: number, h: number): void {
    const ctx = this.ctx;
    const startX = this.startPosition * START_POSITION_WORLD_X;
    const targetX = this.aim * 0.76;
    const startY = SHOT_START_Y;
    const targetY = SHOT_TARGET_Y;
    const start = this.project(startX, startY, w, h);
    const target = this.project(targetX, targetY, w, h);

    ctx.save();

    // AIM is always a genuinely straight line from the selected starting
    // position to the selected target. Hook never bends this yellow guide.
    ctx.strokeStyle = 'rgba(255,241,151,.96)';
    ctx.lineWidth = Math.max(2, w * 0.003);
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Preview exactly the same monotonic hook model used by the live ball.
    // Extreme hook settings are intentionally obvious rather than flattening
    // back toward the centre because of perspective convergence.
    if (Math.abs(this.hook) >= 0.04) {
      ctx.strokeStyle = 'rgba(167,111,199,.92)';
      ctx.lineWidth = Math.max(2.5, w * 0.0035);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        const y = startY + (targetY - startY) * t;
        const x = this.shotPathX(t, startX, targetX, this.hook);
        const point = this.project(x, y, w, h);
        if (i === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    }

    // The ball itself is now the starting-position control. Draw strong arrows
    // beside it so touch and mouse users know they can drag it left/right.
    this.drawStartPositionArrows(start, w);

    ctx.strokeStyle = '#ffe768';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(target.x, target.y, Math.max(7, w * 0.016), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }


  private refreshExtremeOppositionSeverity(): void {
    const aimAmount = Math.abs(this.aim);
    const hookAmount = Math.abs(this.hook);
    const opposingAimAndHook = this.aim * this.hook < -0.02;
    const oppositionProduct = opposingAimAndHook ? aimAmount * hookAmount : 0;
    const centreStartFactor = 1 - clamp(Math.abs(this.startPosition) / 0.9, 0, 1);
    this.extremeOppositionSeverity = opposingAimAndHook
      ? clamp((oppositionProduct - 0.42) / 0.50, 0, 1) * (0.82 + 0.18 * centreStartFactor)
      : 0;
  }

  private shotPathX(progress: number, startX: number, targetX: number, hook: number): number {
    const t = clamp(progress, 0, 1);
    const straightX = lerp(startX, targetX, t);
    const hookT = clamp((t - 0.32) / 0.68, 0, 1);
    // Hook is deliberately nonlinear near the slider extremes. Around 50-75%
    // it remains controllable; the final 15-20% adds much more late movement.
    // This makes max-opposite aim/hook combinations visibly over-cross instead
    // of cancelling into an easy pocket line.
    const hookAmount = Math.abs(hook);
    const extremeRamp = Math.pow(hookAmount, 3.4);
    const hookStrength = hook * (0.72 + 0.28 * hookAmount + 0.58 * extremeRamp);
    const hookOffset = hookStrength * MAX_HOOK_OFFSET * Math.pow(hookT, 2.2);
    const overCrossOffset = hook * this.extremeOppositionSeverity * 0.12 * Math.pow(hookT, 2.8);
    const weakBallDrift = this.lowPowerDrift * Math.pow(t, 1.75);
    const releaseDrift = this.releaseMissDrift * Math.pow(t, 1.45);
    return straightX + hookOffset + overCrossOffset + weakBallDrift + releaseDrift;
  }

  private drawStartPositionArrows(start: { x: number; y: number }, w: number): void {
    const ctx = this.ctx;
    const ballRadius = Math.max(18, w * 0.044);
    const gap = ballRadius * 1.75;
    const arrowLength = Math.max(12, ballRadius * 0.75);
    const arrowHalfHeight = Math.max(6, ballRadius * 0.34);

    ctx.save();
    ctx.fillStyle = 'rgba(255,231,104,.96)';
    ctx.shadowColor = 'rgba(47,19,60,.55)';
    ctx.shadowBlur = 5;

    // Left arrow.
    ctx.beginPath();
    ctx.moveTo(start.x - gap - arrowLength, start.y);
    ctx.lineTo(start.x - gap, start.y - arrowHalfHeight);
    ctx.lineTo(start.x - gap, start.y + arrowHalfHeight);
    ctx.closePath();
    ctx.fill();

    // Right arrow.
    ctx.beginPath();
    ctx.moveTo(start.x + gap + arrowLength, start.y);
    ctx.lineTo(start.x + gap, start.y - arrowHalfHeight);
    ctx.lineTo(start.x + gap, start.y + arrowHalfHeight);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawBall(ball: SimBall, w: number, h: number): void {
    const ctx = this.ctx;
    const point = this.project(ball.x, Math.min(1.02, ball.y), w, h);
    const radius = lerp(Math.max(19, w * 0.046), Math.max(9, w * 0.02), clamp(ball.y, 0, 1));
    const gradient = ctx.createRadialGradient(point.x - radius * 0.35, point.y - radius * 0.4, radius * 0.15, point.x, point.y, radius);
    gradient.addColorStop(0, '#8f72bb');
    gradient.addColorStop(0.45, '#563278');
    gradient.addColorStop(1, '#251638');
    ctx.fillStyle = 'rgba(0,0,0,.20)';
    ctx.beginPath();
    ctx.ellipse(point.x + radius * 0.12, point.y + radius * 0.72, radius * 0.95, radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();

    const holeR = Math.max(1, radius * 0.10);
    ctx.fillStyle = '#160d20';
    [[-0.22, -0.18], [0.06, -0.28], [0.18, -0.04]].forEach(([ox, oy]) => {
      ctx.beginPath();
      ctx.arc(point.x + ox * radius, point.y + oy * radius, holeR, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawPin(pin: SimPin, w: number, h: number): void {
    const ctx = this.ctx;
    const point = this.project(pin.x, pin.y, w, h);

    // Regulation ten-pin proportions are about 15 in tall by 4.766 in wide
    // (width/height ~= 0.318). The old drawing was ~0.46 and looked squat/fat.
    // Keep the back row a little smaller for lane perspective while preserving
    // that real silhouette ratio on every device.
    const nearHeight = Math.max(54, w * 0.115);
    const farHeight = Math.max(46, w * 0.096);
    const height = lerp(nearHeight, farHeight, clamp(pin.y, 0, 1));
    const diameter = height * 0.318;
    const half = diameter * 0.5;
    const tilt = pin.knocked ? clamp(pin.angle, -1.48, 1.48) : 0;
    const fallAmount = clamp(Math.abs(tilt) / 1.48, 0, 1);

    // The shadow belongs to the deck, not to the rotating pin. Widen it as the
    // pin falls so the near-horizontal pose has convincing contact with the lane.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.20)';
    ctx.beginPath();
    ctx.ellipse(
      point.x + 2,
      point.y + 1,
      lerp(diameter * 0.31, height * 0.34, fallAmount),
      lerp(height * 0.025, height * 0.055, fallAmount),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    ctx.save();
    // Rotate around the base contact point. This makes the pin topple from the
    // deck instead of spinning around its waist as the previous artwork did.
    ctx.translate(point.x, point.y);
    ctx.rotate(tilt);
    ctx.translate(0, -height * 0.50);

    const bodyPath = new Path2D();
    bodyPath.moveTo(0, -height * 0.555);
    // Head / crown.
    bodyPath.bezierCurveTo(
      half * 0.56, -height * 0.555,
      half * 0.70, -height * 0.485,
      half * 0.54, -height * 0.410
    );
    // Neck narrows above the stripes.
    bodyPath.bezierCurveTo(
      half * 0.38, -height * 0.340,
      half * 0.34, -height * 0.275,
      half * 0.43, -height * 0.220
    );
    // Shoulder flows into the wide belly.
    bodyPath.bezierCurveTo(
      half * 0.61, -height * 0.125,
      half * 0.98, -height * 0.030,
      half, height * 0.155
    );
    // Lower belly tapers to the base.
    bodyPath.bezierCurveTo(
      half * 0.98, height * 0.310,
      half * 0.63, height * 0.455,
      half * 0.30, height * 0.492
    );
    bodyPath.quadraticCurveTo(0, height * 0.525, -half * 0.30, height * 0.492);
    bodyPath.bezierCurveTo(
      -half * 0.63, height * 0.455,
      -half * 0.98, height * 0.310,
      -half, height * 0.155
    );
    bodyPath.bezierCurveTo(
      -half * 0.98, -height * 0.030,
      -half * 0.61, -height * 0.125,
      -half * 0.43, -height * 0.220
    );
    bodyPath.bezierCurveTo(
      -half * 0.34, -height * 0.275,
      -half * 0.38, -height * 0.340,
      -half * 0.54, -height * 0.410
    );
    bodyPath.bezierCurveTo(
      -half * 0.70, -height * 0.485,
      -half * 0.56, -height * 0.555,
      0, -height * 0.555
    );
    bodyPath.closePath();

    const body = ctx.createLinearGradient(-half, 0, half, 0);
    body.addColorStop(0, '#cfd2d9');
    body.addColorStop(0.20, '#eef1f5');
    body.addColorStop(0.48, '#ffffff');
    body.addColorStop(0.72, '#f5f6f8');
    body.addColorStop(1, '#c8cbd1');
    ctx.fillStyle = body;
    ctx.fill(bodyPath);

    // Clip all decoration to the true pin silhouette so the red neck bands wrap
    // cleanly and never extend beyond the body as the old rectangles could.
    ctx.save();
    ctx.clip(bodyPath);

    const stripeGradient = ctx.createLinearGradient(-half, 0, half, 0);
    stripeGradient.addColorStop(0, '#b91f31');
    stripeGradient.addColorStop(0.45, '#e33748');
    stripeGradient.addColorStop(0.75, '#d7283a');
    stripeGradient.addColorStop(1, '#a91b2c');
    ctx.fillStyle = stripeGradient;
    ctx.fillRect(-half, -height * 0.300, diameter, height * 0.040);
    ctx.fillRect(-half, -height * 0.236, diameter, height * 0.033);

    // Gloss highlight gives the white pin a polished urethane look without
    // requiring raster art, so it stays sharp on phones, iPads and high-DPI PCs.
    const gloss = ctx.createLinearGradient(-half * 0.75, 0, half * 0.10, 0);
    gloss.addColorStop(0, 'rgba(255,255,255,0)');
    gloss.addColorStop(0.48, 'rgba(255,255,255,.58)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.beginPath();
    ctx.ellipse(-half * 0.30, height * 0.04, diameter * 0.11, height * 0.33, -0.05, 0, Math.PI * 2);
    ctx.fill();

    // Soft lower-body shading makes the belly/base shape much easier to read.
    const lowerShade = ctx.createLinearGradient(0, height * 0.14, 0, height * 0.50);
    lowerShade.addColorStop(0, 'rgba(115,120,132,0)');
    lowerShade.addColorStop(1, 'rgba(95,99,112,.14)');
    ctx.fillStyle = lowerShade;
    ctx.fillRect(-half, height * 0.12, diameter, height * 0.40);
    ctx.restore();

    ctx.strokeStyle = 'rgba(68,65,76,.28)';
    ctx.lineWidth = Math.max(0.7, w * 0.0008);
    ctx.stroke(bodyPath);

    // Small base ring helps the standing pin sit convincingly on the deck.
    ctx.fillStyle = 'rgba(170,173,182,.58)';
    ctx.beginPath();
    ctx.ellipse(0, height * 0.493, half * 0.34, height * 0.014, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private random(): number {
    // xorshift32: tiny deterministic PRNG. A shared shot seed makes the physics
    // replay identically on the opponent's device without exposing setup UI.
    let x = this.randomState >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x >>> 0;
    return (this.randomState >>> 0) / 4294967296;
  }

  private project(x: number, y: number, w: number, h: number): { x: number; y: number } {
    const topY = h * LANE_TOP_Y_RATIO;
    const bottomY = h * LANE_BOTTOM_Y_RATIO;
    const yy = clamp(y, 0, 1.05);
    const half = this.halfWidthAt(yy, w);
    return {
      x: w / 2 + x * half / LANE_HALF_WIDTH,
      y: bottomY - yy * (bottomY - topY)
    };
  }

  private halfWidthAt(y: number, w: number): number {
    const topHalf = w * LANE_TOP_HALF_RATIO;
    const bottomHalf = w * LANE_BOTTOM_HALF_RATIO;
    return lerp(bottomHalf, topHalf, clamp(y, 0, 1));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
