/**
 * The tour's timings, stacking order and the two shapes it paints.
 *
 * A module of its own because the engine and the overlay both need them: the
 * engine schedules against the timings, the overlay animates against the same
 * ones, and a cursor that travels for longer than the transition it is given
 * arrives before it looks as though it has.
 */

/** How long the cursor and the spotlight take to reach the next target. */
export const TOUR_TRAVEL_MS = 850;
/** Layout settles (a `before` may have navigated) before the target is measured. */
export const TOUR_SETTLE_MS = 350;
/**
 * How long a step waits for its target to appear before skipping it. A
 * target can be a page that is still loading its chunks or a menu group
 * that opens on arrival, so the wait is generous; a target that never
 * comes (hidden by a flag or a permission) still does not strand the tour.
 */
export const TOUR_MISSING_TARGET_MS = 4000;
export const TOUR_TARGET_POLL_MS = 100;
/**
 * A page action may hand back a promise for work that answers later (the
 * create request the gateway tour submits). The next step's wait for its
 * target does not count down while that promise is pending, so a manual
 * Next and the auto-advance give the target the same chance to mount. A
 * request that never answers ends the wait after this long instead.
 */
export const TOUR_ACTION_CEILING_MS = 60_000;
/** The panel stays lit this long before the dim fades. */
export const TOUR_HANDOFF_HOLD_MS = 4600;
/** The dim fades out over this long. */
export const TOUR_HANDOFF_FADE_MS = 1000;

/** Above Chakra's drawer positioner (1500) and the docked panel (1200), below menus and dialogs' overlay layer (2000+). */
export const TOUR_SPOTLIGHT_Z = 1550;
/** The handoff spotlight when the panel's own stacking order cannot be read. */
export const TOUR_HANDOFF_FALLBACK_Z = 1150;
export const TOUR_CHROME_Z = 1700;

export const PANEL_SELECTOR = '[data-tour="langy-panel"]';
export const EASING = "cubic-bezier(0.45, 0, 0.2, 1)";

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  w: number;
  h: number;
}
