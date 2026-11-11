// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One project's traces on one UTC day of append time, as nurturing counts them from trace's facts:
 * a trace is its root span (span_received), a failed trace trace's own trace_failed fact.
 */
export type NurturingTraceDay = Readonly<{
  projectId: string;
  /** UTC `YYYY-MM-DD` of the root spans' append time. */
  day: string;
  traceCount: number;
  /** Traces trace recorded failed (trace_failed). */
  errorCount: number;
  /** Append time of the newest root span, epoch ms. */
  lastTraceAt: number | null;
  /** Append time of the newest trace_failed, epoch ms. */
  lastFailedTraceAt: number | null;
}>;

/** A root span as nurturing counts it: its project and day; never its body. */
export type NurturingTraceSpan = Readonly<{
  projectId: string;
  day: string;
  appendedAt: number;
}>;

/** A trace trace recorded failed, as nurturing counts it: its project and the fact's day. */
export type NurturingFailedTrace = Readonly<{
  projectId: string;
  day: string;
  failedAt: number;
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

export function emptyTraceDay(): NurturingTraceDay {
  return {
    projectId: "",
    day: "",
    traceCount: 0,
    errorCount: 0,
    lastTraceAt: null,
    lastFailedTraceAt: null,
  };
}

const latest = (known: number | null, at: number) => Math.max(known ?? at, at);

/**
 * Adds one trace to its project's day: one more trace and the newest time. Sums and maxima only,
 * so the order traces arrive in is moot.
 */
export function addTrace(day: NurturingTraceDay, span: NurturingTraceSpan): NurturingTraceDay {
  return {
    ...day,
    projectId: span.projectId,
    day: span.day,
    traceCount: day.traceCount + 1,
    lastTraceAt: latest(day.lastTraceAt, span.appendedAt),
  };
}

/** Adds one failed trace to its project's day: one more failure and the newest failure time. */
export function addFailedTrace(
  day: NurturingTraceDay,
  failure: NurturingFailedTrace,
): NurturingTraceDay {
  return {
    ...day,
    projectId: failure.projectId,
    day: failure.day,
    errorCount: day.errorCount + 1,
    lastFailedTraceAt: latest(day.lastFailedTraceAt, failure.failedAt),
  };
}

/** Items folded into one increment per project and day, so each day is written once. */
function incrementsOf<Item extends Readonly<{ projectId: string; day: string }>>({
  items,
  add,
}: Readonly<{
  items: readonly Item[];
  add: (day: NurturingTraceDay, item: Item) => NurturingTraceDay;
}>): NurturingTraceDay[] {
  const days = new Map<string, NurturingTraceDay>();
  for (const item of items) {
    const key = JSON.stringify([item.projectId, item.day]);
    days.set(key, add(days.get(key) ?? emptyTraceDay(), item));
  }
  return [...days.values()];
}

/** A batch of root spans as the increments of their project's days. */
export function traceDayIncrementsOf(spans: readonly NurturingTraceSpan[]): NurturingTraceDay[] {
  return incrementsOf({ items: spans, add: addTrace });
}

/** A batch of failed traces as the increments of their project's days: failures only. */
export function failedTraceDayIncrementsOf(
  failures: readonly NurturingFailedTrace[],
): NurturingTraceDay[] {
  return incrementsOf({ items: failures, add: addFailedTrace });
}

/** The days after `windowStartDay`, summed into the organization's trace counts. */
export function traceCountsOf({
  days,
  windowStartDay,
}: Readonly<{
  days: readonly NurturingTraceDay[];
  windowStartDay: string;
}>): NurturingTraceCounts {
  // A failure can land on the day after its trace's root span: that day still counts.
  const inWindow = days.filter(
    (day) => day.day > windowStartDay && (day.traceCount > 0 || day.errorCount > 0),
  );
  const latestOf = (times: readonly number[]) => (times.length > 0 ? Math.max(...times) : null);
  return {
    traceCount: inWindow.reduce((sum, day) => sum + day.traceCount, 0),
    errorCount: inWindow.reduce((sum, day) => sum + day.errorCount, 0),
    lastTraceAt: latestOf(inWindow.flatMap((day) => day.lastTraceAt ?? [])),
    lastFailedTraceAt: latestOf(inWindow.flatMap((day) => day.lastFailedTraceAt ?? [])),
    activeDays: [...new Set(inWindow.map((day) => day.day))].toSorted(),
  };
}
