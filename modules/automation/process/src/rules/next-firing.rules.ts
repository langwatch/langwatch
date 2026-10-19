import {
  computeScheduledFor,
  type NextFiring,
  type ReportSchedule,
  type Trigger,
} from "@langwatch/automation-contract";
import { toDate, type Instant } from "@langwatch/time";

/** The trigger fields "what happens next" reads, so any read path's row will do. */
export type NextFiringSubject = Pick<
  Trigger,
  | "triggerKind"
  | "action"
  | "customGraphId"
  | "notificationCadence"
  | "traceDebounceMs"
  | "active"
  | "pausedReason"
>;

/**
 * What happens next for one automation, from what the platform already knows:
 * a schedule's calendar entry, the instant the dispatcher would snap a match to,
 * or an alert's sweep cadence. Paused is answered first, for every kind.
 */
export function describeNextFiring({
  trigger,
  reportSchedule,
  now,
  sweepIntervalMs,
}: {
  trigger: NextFiringSubject;
  /** The scheduler's entry for this trigger, when it is a schedule. */
  reportSchedule: ReportSchedule | null;
  now: Instant;
  /** How often the absence sweep re-checks an alert. */
  sweepIntervalMs: number;
}): NextFiring {
  const isReport = trigger.triggerKind === "REPORT";
  if (!trigger.active || (isReport && reportSchedule?.active === false)) {
    return {
      kind: "paused",
      subject: pausedSubjectOf(trigger),
      pausedReason: trigger.pausedReason,
    };
  }
  if (isReport) {
    return { kind: "schedule", nextRunAt: reportSchedule?.nextRunAt ?? null };
  }
  if (trigger.customGraphId) {
    return { kind: "alert", sweepIntervalMs };
  }
  // The dispatcher's own answer, so a persist action (which ignores its cadence) reads immediate.
  const cadence = trigger.notificationCadence;
  const scheduledFor = computeScheduledFor({ action: trigger.action, cadence, now });
  if (scheduledFor.epochMilliseconds <= now.epochMilliseconds) {
    return { kind: "immediate", traceDebounceMs: trigger.traceDebounceMs };
  }
  return { kind: "digest", cadence, windowClosesAt: toDate(scheduledFor) };
}

/** The noun a paused automation is called by: the distinction the kind badge draws. */
function pausedSubjectOf(trigger: NextFiringSubject): "schedule" | "alert" | "automation" {
  if (trigger.triggerKind === "REPORT") return "schedule";
  return trigger.customGraphId ? "alert" : "automation";
}
