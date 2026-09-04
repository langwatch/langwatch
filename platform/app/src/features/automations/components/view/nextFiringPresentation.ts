/**
 * The words the automation view puts on "what happens next".
 *
 * Pure, so the copy is pinned by a test rather than by a screenshot. Each
 * answer is the honest one for its kind: a report has a real instant, a digest
 * has the boundary its next batch is sent on, and a graph-watching automation
 * has a cadence rather than an instant — saying otherwise would invent a
 * promise the platform does not make.
 *
 * `subject` and `kind` are the server's behaviour discriminators, and they keep
 * the names the dispatch layer uses. What the reader sees is the merged
 * vocabulary (ADR-093 §1) — one noun for both automation subjects, and "report"
 * for the third concept — which is what `SUBJECT_NOUN` translates them into, at
 * the one boundary where copy is chosen.
 */

import { CADENCE_LABELS } from "@langwatch/automations/cadences";
import {
  isAutomationPauseReason,
  RUNAWAY_PAUSE_EXPLANATION,
} from "~/features/automations/logic/pauseReasons";
import type { RouterOutputs } from "~/utils/api";
import { formatWindow } from "./evaluationPresentation";

/** The `automation.getNextFiring` result, derived from the router so the
 *  drawer can never drift from what the procedure actually answers. */
export type NextFiringResult = RouterOutputs["automation"]["getNextFiring"];

export interface NextFiringPresentation {
  /** The headline answer. */
  summary: string;
  /** The instant the summary refers to, when there is one to show as a
   *  timestamp. */
  at: Date | null;
  /** The qualification the reader needs to trust the headline. */
  caveat: string | null;
}

/** The customer's word for each of the server's behaviour subjects. */
const SUBJECT_NOUN: Record<
  "schedule" | "alert" | "automation",
  "report" | "automation"
> = {
  schedule: "report",
  alert: "automation",
  automation: "automation",
};

export function describeNextFiring(
  next: NextFiringResult,
): NextFiringPresentation {
  switch (next.kind) {
    case "paused":
      return {
        summary: `Nothing, while this ${SUBJECT_NOUN[next.subject]} is paused`,
        at: null,
        caveat: pausedCaveat(next),
      };
    case "schedule": {
      if (!next.nextRunAt) {
        return {
          summary: "Nothing is on the calendar for this report",
          at: null,
          caveat: "Edit it and pick a schedule to put it back on the calendar.",
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
          CADENCE_LABELS[next.cadence]
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
        caveat: `An automation waiting for data to stop arriving is also checked every ${formatDebounce(next.sweepIntervalMs)}.`,
      };
  }
}

/**
 * What to say about a pause. The platform pausing an automation for runaway
 * volume is not the same event as a person switching it off, and the reader
 * needs to know which one happened to them — the first has something to fix.
 */
function pausedCaveat(next: {
  subject: "schedule" | "alert" | "automation";
  pausedReason: string | null;
}): string {
  if (isAutomationPauseReason(next.pausedReason)) {
    return RUNAWAY_PAUSE_EXPLANATION;
  }
  if (next.subject === "schedule") {
    return "Resume it to put it back on the calendar.";
  }
  if (next.subject === "alert") {
    return "Resume it to start checking the metric again.";
  }
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
