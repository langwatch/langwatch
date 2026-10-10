/**
 * The tour's timings, stacking order and the two shapes it paints. Shared by
 * the engine (schedules against them) and the overlay (animates against the
 * same ones), so a cursor never arrives before it looks like it has.
 */

/** How long the cursor and the spotlight take to reach the next target. */
export const TOUR_TRAVEL_MS = 850;
/** Layout settles (a `before` may have navigated) before the target is measured. */
export const TOUR_SETTLE_MS = 350;
/**
 * How long a step waits for its target before skipping it: generous, since a
 * target can be a page still loading its chunks or a menu that opens on
 * arrival, and a target hidden by a flag or a permission must not strand it.
 */
export const TOUR_MISSING_TARGET_MS = 4000;
export const TOUR_TARGET_POLL_MS = 100;
/**
 * A page action may hand back a promise answered later; the next step's
 * wait does not count down while it is pending. A request that never
 * answers ends the wait after this long instead.
 */
export const TOUR_ACTION_CEILING_MS = 60_000;
/** The panel stays lit this long before the dim fades. */
export const TOUR_HANDOFF_HOLD_MS = 4600;
/** The dim fades out over this long. */
export const TOUR_HANDOFF_FADE_MS = 1000;

/** Above Chakra's drawer positioner (1500) and the docked panel (1200), below
 * menus/dialogs (2000+). */
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
