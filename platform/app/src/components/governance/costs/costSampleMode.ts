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
import type { GovernanceCostSummaryDto } from "@ee/governance/services/governanceCost.service";
import { useRef } from "react";

/**
 * What the sample decision reads off the headline summary — derived from the
 * DTO rather than transcribed, so a renamed field or a restructured seats
 * union breaks this file at compile time instead of silently never counting.
 */
export type SummaryForSampleDecision = Pick<
  GovernanceCostSummaryDto,
  "unavailableReason" | "billed" | "gateway" | "seats"
>;

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
 * Hold the last real answer across a gap in the reads.
 *
 * Changing a filter chip re-keys every activity query, and until the new
 * window lands they all read as unanswered again. Recomputing the default from
 * that gap would take an organization that we already know is empty, decide we
 * no longer know, and pull the sample panels off the screen until the new
 * reads arrive — a flicker on every filter change. An answer we have already
 * had stands until a later one replaces it.
 */
export function settleRealDataState(
  previous: RealDataState,
  current: RealDataState,
): RealDataState {
  return current === "unknown" ? previous : current;
}

/**
 * `settleRealDataState` applied across renders. Writing the ref during render
 * is safe because the result depends only on the arguments, so a repeated
 * render reaches the same answer.
 */
export function useSettledRealDataState(
  reads: ReadonlyArray<{ length: number } | null>,
): RealDataState {
  const settled = useRef<RealDataState>("unknown");
  settled.current = settleRealDataState(
    settled.current,
    resolveRealDataState(reads),
  );
  return settled.current;
}

/**
 * The lanes' headline summary, translated into the pseudo-read shape the
 * resolver takes. The lanes are real data too: an organization whose bill has
 * been pulled but whose gateway has served nothing would otherwise count as
 * empty, and the invented panels would render beside a real headline figure —
 * the exact confusion the sample rule exists to prevent.
 *
 * A lane counts when it holds a figure OR reported cells it could not price:
 * a withheld total is still a real bill. `unavailable` is a structural empty,
 * so it answers as such rather than staying unknown forever.
 */
export function summaryAsRead(
  data: SummaryForSampleDecision | undefined,
): { length: number } | null {
  if (data === undefined) return null;
  if (data.unavailableReason !== null) return { length: 0 };
  const laneReported = (lane: {
    amountUsd: number | null;
    cellsWithoutAmount: number;
  }) => lane.amountUsd !== null || lane.cellsWithoutAmount > 0;
  const reported =
    (laneReported(data.billed) ? 1 : 0) +
    (laneReported(data.gateway) ? 1 : 0) +
    (data.seats.status === "reported" && data.seats.pools.length > 0 ? 1 : 0);
  return { length: reported };
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
