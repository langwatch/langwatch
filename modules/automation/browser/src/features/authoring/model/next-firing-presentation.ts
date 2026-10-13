/*
 * The words the automation view puts on "what happens next", pure so a test pins them. `subject`
 * keeps the dispatch names; the reader sees the merged vocabulary (ADR-093 §1) via SUBJECT_NOUN.
 */

import type { WireOf } from "@langwatch/api/web";
import {
  CADENCE_LABELS,
  isAutomationPauseReason,
  type NextFiring,
  RUNAWAY_PAUSE_EXPLANATION,
} from "@langwatch/automation-contract";
import { toEpochMs } from "@langwatch/time";

import { formatWindow } from "./evaluation-presentation.ts";

export interface NextFiringPresentation {
  /** The headline answer. */
  summary: string;
  /** The instant (epoch ms) the summary refers to, when there is one to show. */
  at: number | undefined;
  /** The qualification the reader needs to trust the headline. */
  caveat: string | undefined;
}

/** The `getNextFiring` answer as the drawer receives it (dates as ISO strings). */
type NextFiringWire = WireOf<NextFiring>;

/** The customer's word for each of the server's behaviour subjects. */
const SUBJECT_NOUN: Record<"schedule" | "alert" | "automation", "report" | "automation"> = {
  schedule: "report",
  alert: "automation",
  automation: "automation",
};

/** What the view drawer says about when an automation next acts. */
export function describeNextFiring(next: NextFiringWire): NextFiringPresentation {
  switch (next.kind) {
    case "paused":
      return {
        summary: `Nothing, while this ${SUBJECT_NOUN[next.subject]} is paused`,
        at: undefined,
        caveat: pausedCaveat(next),
      };
    case "schedule":
      if (!next.nextRunAt) {
        return {
          summary: "Nothing is on the calendar for this report",
          at: undefined,
          caveat: "Edit it and pick a schedule to put it back on the calendar.",
        };
      }
      return { summary: "Sends next on", at: toEpochMs(next.nextRunAt), caveat: undefined };
    case "digest":
      return {
        summary: "Sends the next batch at",
        at: toEpochMs(next.windowClosesAt),
        caveat: `Matches are collected and sent together. ${
          CADENCE_LABELS[next.cadence]
        }, and a batch with nothing in it sends nothing.`,
      };
    case "immediate":
      return {
        summary: "Acts as soon as a matching trace arrives",
        at: undefined,
        caveat:
          next.traceDebounceMs > 0
            ? `A trace is acted on once it has been quiet for ${formatDebounce(next.traceDebounceMs)}, so its whole content is included.`
            : undefined,
      };
    case "alert":
      return {
        summary: "Checked as data arrives",
        at: undefined,
        caveat: `An automation waiting for data to stop arriving is also checked every ${formatDebounce(next.sweepIntervalMs)}.`,
      };
    default: {
      const exhaustive: never = next;
      return exhaustive;
    }
  }
}

/** A platform pause has something to fix; a person's pause only needs resuming. */
function pausedCaveat(next: Extract<NextFiringWire, { kind: "paused" }>): string {
  if (isAutomationPauseReason(next.pausedReason)) return RUNAWAY_PAUSE_EXPLANATION;
  if (next.subject === "schedule") return "Resume it to put it back on the calendar.";
  if (next.subject === "alert") return "Resume it to start checking the metric again.";
  return "Resume it to act on matching traces again.";
}

/** Spelled out, never abbreviated: "30 seconds", not "30s". */
function formatDebounce(ms: number): string {
  if (ms < 60_000) {
    const seconds = Math.round(ms / 1000);
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }
  return formatWindow(Math.round(ms / 60_000));
}
