import type { DrawerType } from "~/components/drawerRegistry";
import { getDrawerStack } from "~/hooks/useDrawer";

/**
 * The drawer keys that mount the authoring drawer. `editAutomationFilter` is
 * an alias kept for links handed out before this drawer replaced the
 * filter-only one; it renders the same component over the same draft.
 */
const AUTOMATION_DRAWERS = new Set<DrawerType>(["automation", "editAutomationFilter"]);

/**
 * Whether the authoring drawer is still part of the open drawer flow.
 *
 * Drawers are URL-routed singletons, so going to another drawer unmounts this
 * one exactly the way closing it does. The navigation stack tells the two
 * apart: a sub-flow pushes on top of the authoring drawer and leaves it in the
 * stack, while `closeDrawer` empties the stack.
 *
 * Reading the stack changes nothing, so an unmount that runs more than once
 * for one drawer decides the same way every time. That matters because React
 * StrictMode replays effects in development: a check that consumed a one-shot
 * flag would answer "sub-flow" the first time and "close" on the replay, and
 * wipe the draft the reader is about to come back to.
 */
export function isInAutomationFlow(): boolean {
  return getDrawerStack().some((entry) => AUTOMATION_DRAWERS.has(entry.drawer));
}

/**
 * Whether the drawer that is about to mount is the return leg of a sub-flow.
 *
 * The departure keeps the draft in the singleton store, which is what the
 * return trip needs. A sub-flow the reader never returns from (they navigate
 * to another page while the dataset drawer is open) leaves that same draft
 * behind with nothing to collect it, and the next new automation would open
 * pre-filled with it.
 *
 * So a mount starts blank by default and only the return says otherwise. The
 * return leg is the one place that knows: it runs `goBack` itself.
 */
let returningFromSubFlow = false;

/** Announce the return leg of a sub-flow, so the drawer's next mount keeps
 *  the draft the departure left in the store. Call it before `goBack`. */
export function keepDraftOnSubFlowReturn(): void {
  returningFromSubFlow = true;
}

/** Read and clear the return intent. False means the drawer is opening fresh
 *  and must start from a blank draft. Consume it once per mount: the caller
 *  latches the answer so a StrictMode effect replay cannot read it twice. */
export function consumeDraftKeptOnSubFlowReturn(): boolean {
  const wasReturning = returningFromSubFlow;
  returningFromSubFlow = false;
  return wasReturning;
}
