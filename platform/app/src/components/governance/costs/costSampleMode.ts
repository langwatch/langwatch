/**
 * Whether the Costs page is currently showing its sample panels.
 *
 * The rule is the one the trace explorer already uses for sample traces
 * (`usePreviewTracesActive`): sample data fills an empty screen, and gets out
 * of the way once the screen has something real on it. An explicit choice by
 * the reader always wins over both.
 *
 * The difference from traces is what "off" means. A sample trace stands in for
 * a real trace that has not arrived yet, so traces swap one for the other. Half
 * the Costs panels have no backing read at all — nothing measures agents, seats
 * or forecasts today — so there is nothing to swap in. Turning samples off
 * removes those panels rather than emptying them: a permanently blank panel
 * would imply we looked and found nothing.
 */

/**
 * What the real reads have told us so far. `unknown` is a distinct answer
 * rather than a pessimistic `absent`, because defaulting to sample-on while a
 * read is still in flight would flash the sample panels up and then pull them
 * away the moment the data landed.
 */
export type RealDataState = "unknown" | "present" | "absent";

/**
 * Resolve the three states from the real reads. A read that has not answered
 * is `null`; one that answered with no rows is an empty array.
 *
 * Any read holding a row means the organization has real cost data, so the
 * page has something to show and samples stay out of the way. Only once
 * *every* read has answered, and all of them are empty, is the screen known to
 * be empty — a single unanswered read is enough to keep the answer `unknown`,
 * since it might be the one holding the data.
 */
export function resolveRealDataState(
  reads: ReadonlyArray<{ length: number } | null>,
): RealDataState {
  if (reads.some((read) => read !== null && read.length > 0)) return "present";
  if (reads.some((read) => read === null)) return "unknown";
  return "absent";
}

/**
 * Whether the sample panels render.
 *
 * `optIn` is the reader's own choice — `null` until they touch the toggle,
 * which is what lets the default follow the data underneath them. Once they
 * have chosen, the data no longer overrides it: a reader who turned samples
 * off does not want them back when a read comes back empty.
 */
export function sampleModeActive({
  optIn,
  realData,
}: {
  optIn: boolean | null;
  realData: RealDataState;
}): boolean {
  if (optIn !== null) return optIn;
  return realData === "absent";
}

