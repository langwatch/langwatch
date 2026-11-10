// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/**
 * One project's traces on one UTC day of append time, as nurturing counts them from trace's
 * span_received facts: a trace is its root span, as trace's own rollup counts it.
 */
export const nurturingTraceDayStateSchema = z.object({
  projectId: z.string(),
  /** UTC `YYYY-MM-DD` of the spans' append time. */
  day: z.string(),
  traceCount: z.number(),
  /** Root spans with an error status. */
  errorCount: z.number(),
  /** Append time of the newest root span, epoch ms. */
  lastTraceAt: z.number().nullable(),
  /** Append time of the newest erroring root span, epoch ms. */
  lastFailedTraceAt: z.number().nullable(),
  LastEventOccurredAt: z.number(),
});
export type NurturingTraceDayState = z.infer<typeof nurturingTraceDayStateSchema>;

/** A span as the fold counts it: never its body, only whether it is a root and failed. */
export type NurturingTraceSpan = Readonly<{
  projectId: string;
  day: string;
  isRoot: boolean;
  isError: boolean;
  appendedAt: number;
  occurredAt: number;
}>;

/** An organization's traces within the window, summed over its projects' days. */
export type NurturingTraceCounts = Readonly<{
  traceCount: number;
  errorCount: number;
  lastTraceAt: number | null;
  lastFailedTraceAt: number | null;
  /** UTC days with a trace, ascending. */
  activeDays: readonly string[];
}>;

export function emptyTraceDay(): NurturingTraceDayState {
  return {
    projectId: "",
    day: "",
    traceCount: 0,
    errorCount: 0,
    lastTraceAt: null,
    lastFailedTraceAt: null,
    LastEventOccurredAt: 0,
  };
}

const latest = (known: number | null, at: number) => Math.max(known ?? at, at);

/**
 * Adds one span to its project's day: a root span is one trace, a failed root one failed trace;
 * any other span changes no count. Sums and maxima only, so the order spans arrive in is moot.
 */
export function foldTraceDay(
  state: NurturingTraceDayState,
  span: NurturingTraceSpan,
): NurturingTraceDayState {
  const base = {
    ...state,
    projectId: span.projectId,
    day: span.day,
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, span.occurredAt),
  };
  if (!span.isRoot) return base;
  return {
    ...base,
    traceCount: state.traceCount + 1,
    lastTraceAt: latest(state.lastTraceAt, span.appendedAt),
    ...(span.isError && {
      errorCount: state.errorCount + 1,
      lastFailedTraceAt: latest(state.lastFailedTraceAt, span.appendedAt),
    }),
  };
}

/** The days after `windowStartDay`, summed into the organization's trace counts. */
export function traceCountsOf({
  days,
  windowStartDay,
}: Readonly<{
  days: readonly NurturingTraceDayState[];
  windowStartDay: string;
}>): NurturingTraceCounts {
  const inWindow = days.filter((day) => day.day > windowStartDay && day.traceCount > 0);
  const latestOf = (times: readonly number[]) => (times.length > 0 ? Math.max(...times) : null);
  return {
    traceCount: inWindow.reduce((sum, day) => sum + day.traceCount, 0),
    errorCount: inWindow.reduce((sum, day) => sum + day.errorCount, 0),
    lastTraceAt: latestOf(inWindow.flatMap((day) => day.lastTraceAt ?? [])),
    lastFailedTraceAt: latestOf(inWindow.flatMap((day) => day.lastFailedTraceAt ?? [])),
    activeDays: [...new Set(inWindow.map((day) => day.day))].toSorted(),
  };
}
