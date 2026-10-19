/**
 * Whether the authoring drawer's unmount is a hand-over to another drawer, and
 * whether the mount that follows is its return leg. A hand-over unmounts this
 * drawer the way closing it does, so it announces itself here.
 */

// Both reads are idempotent for the same ending, which is what StrictMode's
// replayed effects need: the departure flag is cleared by the mount that
// follows, never by the unmount that reads it.

/** Set by the hand-over, cleared by the next mount of the authoring drawer. */
let handingOverToSubFlow = false;

/** Set by the return leg only, so an abandoned sub-flow never seeds the next draft. */
let returningFromSubFlow = false;

/** Announce that this drawer is about to hand over rather than close. */
export function announceSubFlowDeparture(): void {
  handingOverToSubFlow = true;
}

/** Whether this unmount is that hand-over. Reading it decides nothing else. */
export function isHandingOverToSubFlow(): boolean {
  return handingOverToSubFlow;
}

/** Announce the return leg, so the drawer's next mount keeps the draft the
 *  departure left in the store. Call it before going back. */
export function keepDraftOnSubFlowReturn(): void {
  returningFromSubFlow = true;
}

/** Read and clear both intents. False means the drawer is opening fresh and
 *  must start from a blank draft. Consume it once per mount. */
export function consumeDraftKeptOnSubFlowReturn(): boolean {
  const wasReturning = returningFromSubFlow;
  handingOverToSubFlow = false;
  returningFromSubFlow = false;
  return wasReturning;
}
