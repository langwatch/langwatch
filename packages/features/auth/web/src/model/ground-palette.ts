/**
 * How far the ground has turned, and how it gets there.
 *
 * The two colour modes keep their own fields — the site's light mesh and its
 * dark warp are different objects, and each is the right answer for the ground
 * it sits on. What they share is a NUDGE: a small offset applied on top of
 * whichever field is up, so that moving through a door moves the thing behind
 * it.
 *
 * That is all this module holds. Not a palette and not a second look: five
 * numbers describing a turn, a slide and a breath of scale, small enough that
 * nobody watching could tell you what changed, large enough that the screen
 * does not feel frozen when the step underneath it changes. The shader's own
 * settings — its colours, its shape, its speed — stay where each field
 * declares them.
 */

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
   * How far across the field the colour dissolves, as a fraction of its own
   * width. The mask holds solid to `1 - fade` and is gone by the far edge, so
   * a larger number is a longer, softer dissolve rather than a smaller cloud.
   *
   * At rest it is most of the field: a short fade reads as a shape with an
   * edge, and this is meant to read as light.
   */
  fade: number;
  /**
   * How much of the viewport the colour reaches across, as a multiplier on
   * its resting width. Sign-up is a longer journey with more to say, so it
   * gets more of the page; the far end of either door pulls back, because by
   * then the person is reading rather than being greeted.
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
 * Deliberately small. This is the ground acknowledging a move, not narrating
 * one: the largest of these turns the field by a twelfth of a turn across most
 * of a second, which reads as drift rather than as a transition somebody has
 * to sit through before they can type.
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
 * Crossing between the doors slides the field, so the two are not the same
 * picture with different words over it — and gives each one a different amount
 * of the page. Sign-up is the longer journey and the one making a case, so its
 * colour reaches further; log-in is somebody who has already decided.
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
