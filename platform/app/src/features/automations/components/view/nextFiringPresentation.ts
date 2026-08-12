/**
 * The words the automation view puts on "what happens next".
 *
 * Pure, so the copy is pinned by a test rather than by a screenshot. Each
 * answer is the honest one for its kind: a schedule has a real instant, a
 * digest has the boundary its next batch is sent on, and an alert has a
 * cadence rather than an instant — saying otherwise would invent a promise
 * the platform does not make.
 */

import { CADENCE_LABELS } from "@langwatch/automations/cadences";
import { formatWindow } from "./evaluationPresentation";

/** The `automation.getNextFiring` result, as the drawer receives it. */
export type NextFiringResult =
  | { kind: "schedule"; nextRunAt: string | Date | null; paused: boolean }
  | { kind: "digest"; cadence: string; windowClosesAt: string | Date }
  | { kind: "immediate"; traceDebounceMs: number }
  | { kind: "alert"; sweepIntervalMs: number };

export interface NextFiringPresentation {
  /** The headline answer. */
  summary: string;
  /** The instant the summary refers to, when there is one to show as a
   *  timestamp. */
  at: Date | null;
  /** The qualification the reader needs to trust the headline. */
  caveat: string | null;
}

export function describeNextFiring(
  next: NextFiringResult,
): NextFiringPresentation {
  switch (next.kind) {
    case "schedule": {
      if (next.paused || !next.nextRunAt) {
        return {
          summary: "Nothing, while this schedule is paused",
          at: null,
          caveat: "Resume it to put it back on the calendar.",
        };
      }
      return {
        summary: "Sends next on",
        at: new Date(next.nextRunAt),
        caveat: null,
      };
    }
    case "digest":
      return {
        summary: "Sends the next batch at",
        at: new Date(next.windowClosesAt),
        caveat: `Matches are collected and sent together. ${
          CADENCE_LABELS[next.cadence as keyof typeof CADENCE_LABELS] ??
          "On a schedule"
        }, and a batch with nothing in it sends nothing.`,
      };
    case "immediate":
      return {
        summary: "Acts as soon as a matching trace arrives",
        at: null,
        caveat:
          next.traceDebounceMs > 0
            ? `A trace is acted on once it has been quiet for ${formatDebounce(next.traceDebounceMs)}, so its whole content is included.`
            : null,
      };
    case "alert":
      return {
        summary: "Checked as data arrives",
        at: null,
        caveat: `An alert waiting for data to stop arriving is also checked every ${formatDebounce(next.sweepIntervalMs)}.`,
      };
  }
}

/** Spelled out, never abbreviated: "30 seconds", not "30s". */
function formatDebounce(ms: number): string {
  if (ms < 60_000) {
    const seconds = Math.round(ms / 1000);
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }
  return formatWindow(Math.round(ms / 60_000));
}
