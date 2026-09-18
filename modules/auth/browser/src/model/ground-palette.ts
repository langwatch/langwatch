/** Ground shifts: nudges applied to colour field as user progresses through doors. */

/** Which door somebody is standing at. */
export type FrontDoorDoor = "signin" | "signup";

/**
 * How far into a door they are. Named for what the person is doing, not for
 * the component drawing it, so both doors share the vocabulary.
 */
export type FrontDoorDepth =
  /** Being asked for an address. */
  | "entry"
  /** Being asked for a secret, or offered the ways to give one. */
  | "credential"
  /** Told to go and open an email. */
  | "sent"
  /** Through: the account exists and the app is next. */
  | "settled";

export interface FrontDoorStage {
  door: FrontDoorDoor;
  depth: FrontDoorDepth;
}

/** What a stage does to whichever field is up. Added, never assigned. */
export interface GroundShift {
  rotation: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  swirl: number;
  /**
   * How far the colour dissolves, as a fraction of the field's width — solid
   * to `1 - fade`, gone by the far edge, so a larger number softens the
   * dissolve. At rest it's most of the field, reading as light, not a shape.
   */
  fade: number;
  /**
   * How much of the viewport the colour reaches, as a multiplier on its
   * resting width. Sign-up (longer journey) gets more page; either door
   * pulls back at the far end, since by then the person is reading, not being greeted.
   */
  reach: number;
}

export const GROUND_AT_REST: GroundShift = {
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  scale: 0,
  swirl: 0,
  fade: 0.7,
  reach: 1,
};

/**
 * Deliberately small: the ground acknowledges a move, doesn't narrate one.
 * The largest turn is a twelfth of a turn across most of a second — drift,
 * not a transition somebody has to sit through before they can type.
 */
const DEPTH_SHIFT: Record<FrontDoorDepth, GroundShift> = {
  entry: GROUND_AT_REST,
  credential: {
    rotation: 10,
    offsetX: 0,
    offsetY: 0.05,
    scale: 0.05,
    swirl: 0.03,
    // Softer and slightly narrower than the greeting: there is a field to
    // type into now, and the ground's job changes from saying hello to
    // staying out of the way.
    fade: 0.78,
    reach: 0.94,
  },
  sent: {
    rotation: 20,
    offsetX: 0,
    offsetY: 0.09,
    scale: 0.08,
    swirl: 0.05,
    // Nothing to do here but go and read an inbox, so the field opens back
    // out and dissolves over almost the whole width.
    fade: 0.86,
    reach: 1.06,
  },
  settled: {
    rotation: 30,
    offsetX: 0,
    offsetY: 0.03,
    scale: 0.12,
    swirl: 0.02,
    // Through the door: the widest and softest it gets, on the way to a
    // product that has its own ground.
    fade: 0.9,
    reach: 1.12,
  },
};

/**
 * Crossing between the doors slides the field, giving each a different
 * amount of page: sign-up is the longer journey making a case, so its colour
 * reaches further; log-in is somebody who's already decided.
 */
const DOOR_SHIFT: Record<
  FrontDoorDoor,
  Pick<GroundShift, "rotation" | "offsetX" | "fade" | "reach">
> = {
  signin: { rotation: 0, offsetX: 0, fade: 0, reach: 1 },
  signup: { rotation: -10, offsetX: -0.09, fade: 0.04, reach: 1.08 },
};

/** Never let the dissolve collapse to an edge, or overrun the mask entirely. */
const clampFade = (value: number) => Math.min(0.95, Math.max(0.35, value));

/** Where the field should be, for one point in one door. */
export function resolveGroundShift(stage: FrontDoorStage): GroundShift {
  const depth = DEPTH_SHIFT[stage.depth];
  const door = DOOR_SHIFT[stage.door];

  return {
    rotation: depth.rotation + door.rotation,
    offsetX: depth.offsetX + door.offsetX,
    offsetY: depth.offsetY,
    scale: depth.scale,
    swirl: depth.swirl,
    // The door ADDS to the depth's dissolve and MULTIPLIES its reach: one is
    // a distance along the same fade, the other is a size.
    fade: clampFade(depth.fade + door.fade),
    reach: depth.reach * door.reach,
  };
}

function mixNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Part-way between two turns. */
export function mixGroundShift(from: GroundShift, to: GroundShift, t: number): GroundShift {
  return {
    rotation: mixNumber(from.rotation, to.rotation, t),
    offsetX: mixNumber(from.offsetX, to.offsetX, t),
    offsetY: mixNumber(from.offsetY, to.offsetY, t),
    scale: mixNumber(from.scale, to.scale, t),
    swirl: mixNumber(from.swirl, to.swirl, t),
    fade: mixNumber(from.fade, to.fade, t),
    reach: mixNumber(from.reach, to.reach, t),
  };
}

/** Whether the field is already where it is being asked to go. */
export function groundShiftsMatch(a: GroundShift, b: GroundShift): boolean {
  return (
    a.rotation === b.rotation &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.scale === b.scale &&
    a.swirl === b.swirl &&
    a.fade === b.fade &&
    a.reach === b.reach
  );
}

/** Slow at both ends: the field leaves and arrives without a visible start. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** How long the field takes to settle after a step changes. Long enough to
 *  read as weather rather than as a cut, over before anybody has finished
 *  reading the step they just landed on. */
export const GROUND_TWEEN_MS = 900;
