// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One project's traces on one UTC day of append time, as nurturing counts them from trace's
 * span_received facts: a trace is its root span, as trace's own rollup counts it.
 */
export type NurturingTraceDay = Readonly<{
  projectId: string;
  /** UTC `YYYY-MM-DD` of the root spans' append time. */
  day: string;
  traceCount: number;
  /** Root spans with an error status. */
  errorCount: number;
  /** Append time of the newest root span, epoch ms. */
  lastTraceAt: number | null;
  /** Append time of the newest erroring root span, epoch ms. */
  lastFailedTraceAt: number | null;
}>;

/** A root span as nurturing counts it: its project, day and status; never its body. */
export type NurturingTraceSpan = Readonly<{
  projectId: string;
  day: string;
  isError: boolean;
  appendedAt: number;
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
 * Adds one trace to its project's day: one more trace, one more failed trace when it errored,
 * and the newest times. Sums and maxima only, so the order traces arrive in is moot.
 */
export function addTrace(day: NurturingTraceDay, span: NurturingTraceSpan): NurturingTraceDay {
  return {
    projectId: span.projectId,
    day: span.day,
    traceCount: day.traceCount + 1,
    lastTraceAt: latest(day.lastTraceAt, span.appendedAt),
    errorCount: day.errorCount + (span.isError ? 1 : 0),
    lastFailedTraceAt: span.isError
      ? latest(day.lastFailedTraceAt, span.appendedAt)
      : day.lastFailedTraceAt,
  };
}

/**
 * A batch of root spans as the increments of their project's days: one per project and day, so
 * the repository writes each day once with its counts added.
 */
export function traceDayIncrementsOf(spans: readonly NurturingTraceSpan[]): NurturingTraceDay[] {
  const days = new Map<string, NurturingTraceDay>();
  for (const span of spans) {
    const key = JSON.stringify([span.projectId, span.day]);
    days.set(key, addTrace(days.get(key) ?? emptyTraceDay(), span));
  }
  return [...days.values()];
}

/** The days after `windowStartDay`, summed into the organization's trace counts. */
export function traceCountsOf({
  days,
  windowStartDay,
}: Readonly<{
  days: readonly NurturingTraceDay[];
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
