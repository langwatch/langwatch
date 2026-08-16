/**
 * Whether the automation drawer is away in a sub-flow (creating a dataset,
 * for example) and expects to come back through `goBack`.
 *
 * Only one drawer mounts at a time, so a sub-flow unmounts the drawer the
 * same way closing it does. The draft itself survives either way, because
 * the store is a singleton; what separates the two cases is the unmount
 * reset. This flag carries that intent across the unmount, which no React
 * state can do.
 *
 * It lives apart from the store on purpose: the provider clients that start
 * a sub-flow are imported BY the store's reducer, so importing the store
 * back from them would close an import cycle.
 */
let awayInSubFlow = false;

/** Announce a sub-flow the drawer will return from, so the next unmount
 *  keeps the draft. */
export function keepDraftForSubFlow(): void {
  awayInSubFlow = true;
}

/** Read and clear the sub-flow intent. Returns true when the unmount is a
 *  departure into a sub-flow rather than a close. */
export function consumeDraftKeptForSubFlow(): boolean {
  const wasAway = awayInSubFlow;
  awayInSubFlow = false;
  return wasAway;
}

/**
 * Whether the drawer that is about to mount is the return leg of a sub-flow.
 *
 * The departure skips the unmount reset, which leaves the draft in the
 * singleton store. That is what the return trip needs, but a sub-flow the
 * user never returns from (they navigate to another page while the dataset
 * drawer is open) leaves the same draft behind with nothing to collect it,
 * and the next new automation opens pre-filled with it.
 *
 * So the mount starts blank by default and only the return says otherwise.
 * The return leg is the one place that knows: it runs `goBack` itself. An
 * abandoned sub-flow never announces a return, so the stale draft is
 * discarded the next time the drawer opens.
 */
let returningFromSubFlow = false;

/** Announce the return leg of a sub-flow, so the drawer's next mount keeps
 *  the draft the departure left in the store. Call it before `goBack`. */
export function keepDraftOnSubFlowReturn(): void {
  returningFromSubFlow = true;
}

/** Read and clear the return intent. False means the drawer is opening
 *  fresh and must start from a blank draft. */
export function consumeDraftKeptOnSubFlowReturn(): boolean {
  const wasReturning = returningFromSubFlow;
  returningFromSubFlow = false;
  return wasReturning;
}
