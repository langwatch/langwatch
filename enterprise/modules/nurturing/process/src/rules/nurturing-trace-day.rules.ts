// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One project's traces on one UTC day of append time, as nurturing counts them from trace's facts:
 * a trace is its root span (span_received), a failed trace trace's own trace_failed fact. Each
 * source's fold keeps its own row of a day, and a read sums them.
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

/** What one counted trace adds to: its root span's day count, or its failure count. */
export type NurturingCountedTraceKind = "trace" | "failed";

/**
 * The fold, one per owner pipeline, whose row of a project's day it is: `spans` from
 * span_received, `failures` from trace_failed. A peer fold reads one owner's log (§9).
 */
export type NurturingTraceDaySource = "spans" | "failures";

/**
 * One trace as nurturing counts it: its project and the fact's day and time; never its body. A
 * redelivered batch folds once; a root span stored again under a new event id counts again
 * (accepted, issue 9378).
 */
export type NurturingCountedTrace = Readonly<{
  projectId: string;
  kind: NurturingCountedTraceKind;
  /** UTC `YYYY-MM-DD` of the fact's append time. */
  day: string;
  /** The fact's append time, epoch ms. */
  at: number;
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
 * Adds one counted trace to its project's day: a trace or a failure, and its newest time. Sums
 * and maxima only, so the order traces arrive in is moot.
 */
export function addCountedTrace(
  day: NurturingTraceDay,
  trace: NurturingCountedTrace,
): NurturingTraceDay {
  const at = { ...day, projectId: trace.projectId, day: trace.day };
  return trace.kind === "trace"
    ? { ...at, traceCount: day.traceCount + 1, lastTraceAt: latest(day.lastTraceAt, trace.at) }
    : {
        ...at,
        errorCount: day.errorCount + 1,
        lastFailedTraceAt: latest(day.lastFailedTraceAt, trace.at),
      };
}

/** The row key of a project's day, as the trace-day folds group and store it. */
export function traceDayKeyOf({
  projectId,
  day,
}: Readonly<{ projectId: string; day: string }>): string {
  return JSON.stringify([projectId, day]);
}

/** The project and day a trace-day row key names; refuses a key no fold wrote. */
export function traceDayOfKey(key: string): Readonly<{ projectId: string; day: string }> {
  const parsed: unknown = JSON.parse(key);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw new Error(`not a trace-day key: ${key}`);
  }
  return { projectId: parsed[0], day: parsed[1] };
}

/**
 * The days after `windowStartDay`, summed into the organization's trace counts: each source's row
 * of a day adds to the sums, and the day is active once.
 */
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
