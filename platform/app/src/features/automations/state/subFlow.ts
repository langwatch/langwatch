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
