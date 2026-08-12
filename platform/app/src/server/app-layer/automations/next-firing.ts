/**
 * "What happens next" for one automation, derived from what the platform
 * already knows — no new scheduler machinery, and nothing invented.
 *
 * Three honest answers, one per kind:
 *
 *   - A schedule has a real calendar entry the scheduler owns, so its next
 *     run is read from there (`TriggerService.getReportSchedules`). A paused
 *     schedule has no next run and says so rather than quoting a stale one.
 *   - A trace automation has no calendar at all: it acts when a matching
 *     trace settles. On a digest cadence the send still snaps to a wall-clock
 *     boundary, which IS a real instant — the same one
 *     `computeScheduledFor` hands the outbox — so it is reported, with the
 *     caveat that a window with no matches sends nothing.
 *   - An alert is checked as data arrives, plus a sweep for the cases no data
 *     can reach (an alert waiting for silence). There is no next instant to
 *     quote; the cadence is the answer.
 */

import {
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "@langwatch/automations/cadences";
import { type TriggerAction, TriggerKind } from "@prisma/client";
import { computeScheduledFor } from "./dispatch/triggerActionDispatch";
import { GRAPH_TRIGGER_HEARTBEAT_INTERVAL_MS } from "./graph-trigger-heartbeat";
import type { ReportSchedule } from "./trigger.service";

export type NextFiring =
  | {
      kind: "schedule";
      /** The scheduler's own next instant; null while the schedule is
       *  paused. */
      nextRunAt: Date | null;
      paused: boolean;
    }
  | {
      kind: "digest";
      cadence: NotificationCadence;
      /** When the open batching window closes. Anything that matches before
       *  then is sent together; a window that matched nothing sends nothing. */
      windowClosesAt: Date;
    }
  | {
      kind: "immediate";
      /** The quiet period a trace must go without new spans before the
       *  automation acts on it. */
      traceDebounceMs: number;
    }
  | {
      kind: "alert";
      /** How often the absence sweep re-checks an alert that is waiting for
       *  data to stop arriving. */
      sweepIntervalMs: number;
    };

/** The trigger fields this derivation reads. Deliberately narrow so the
 *  caller can pass a row from any read path. */
export interface NextFiringSubject {
  triggerKind: TriggerKind;
  action: TriggerAction;
  customGraphId: string | null;
  notificationCadence: string;
  traceDebounceMs: number;
  active: boolean;
}

export function describeNextFiring({
  trigger,
  reportSchedule,
  now,
}: {
  trigger: NextFiringSubject;
  /** The scheduler's entry for this trigger, when it is a schedule. */
  reportSchedule: ReportSchedule | null;
  now: Date;
}): NextFiring {
  if (trigger.triggerKind === TriggerKind.REPORT) {
    return {
      kind: "schedule",
      nextRunAt: reportSchedule?.nextRunAt ?? null,
      paused: !trigger.active || reportSchedule?.active === false,
    };
  }
  if (trigger.customGraphId) {
    return {
      kind: "alert",
      sweepIntervalMs: GRAPH_TRIGGER_HEARTBEAT_INTERVAL_MS,
    };
  }
  // Asked of the dispatcher itself rather than re-derived: this is exactly
  // the instant `computeScheduledFor` would give a match found right now, so
  // the view can never quote a boundary the dispatch layer disagrees with —
  // including the case where the action is a persist one, which ignores the
  // stored cadence and acts immediately.
  const cadence = asCadence(trigger.notificationCadence);
  const scheduledFor = computeScheduledFor({
    action: trigger.action,
    cadence,
    now,
  });
  if (scheduledFor.getTime() <= now.getTime()) {
    return { kind: "immediate", traceDebounceMs: trigger.traceDebounceMs };
  }
  return { kind: "digest", cadence, windowClosesAt: scheduledFor };
}

/** The column is a plain string, so an unrecognised value must degrade to the
 *  behaviour the dispatcher actually applies for it: immediate. */
function asCadence(value: string): NotificationCadence {
  return (NOTIFICATION_CADENCES as readonly string[]).includes(value)
    ? (value as NotificationCadence)
    : "immediate";
}
