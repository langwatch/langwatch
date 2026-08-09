import { createLogger } from "@langwatch/observability";

import { RUNAWAY_PAUSE_REASON } from "~/features/automations/logic/pauseReasons";
import {
  incrementAutomationAutoPausedTotal,
  incrementAutomationCeilingBreachTotal,
} from "~/server/metrics";
import { isMatchEverythingTrigger } from "./matchEverything";
import type { TriggerSummary } from "./repositories/trigger.repository";

const logger = createLogger("langwatch:automations:runaway-containment");

export { RUNAWAY_PAUSE_REASON };

/**
 * How long a failed pause waits before another breach retries it. Short,
 * because the whole point of the pause is to stop a runaway quickly.
 */
export const PAUSE_ATTEMPT_CLAIM_SECONDS = 60;

/**
 * Share of a project's 24h traces a single automation's CONFIRMED matches have
 * to cover before we call it misconfigured rather than busy. At 90% the
 * automation is not selecting traces, it is selecting the project.
 */
export const RUNAWAY_TRAFFIC_SHARE = 0.9;

/**
 * How much traffic a project needs before the share above means anything. Two
 * confirmed matches out of two traces is 100% and says nothing; without this
 * floor a quiet project would auto-pause on its first busy minute.
 */
export const RUNAWAY_MIN_PROJECT_TRACES = 100;

export interface RunawayContainmentDeps {
  /** Distinct traces the project ingested in the last 24h. */
  countProjectTraces24h: (projectId: string) => Promise<number>;
  pauseTrigger: (params: {
    triggerId: string;
    projectId: string;
    reason: string;
    at: Date;
  }) => Promise<void>;
  /** Org admins who should hear about this project's automations. */
  notificationRecipients: (projectId: string) => Promise<string[]>;
  sendLimitEmail: (params: {
    to: string[];
    kind: "ceiling_reached" | "paused";
    automationName: string;
    projectName: string;
    dailyCeiling: number;
    skippedToday: number;
    actionUrl: string;
  }) => Promise<void>;
  /**
   * Once-only gate, SET-NX backed. Returns true only for the caller that newly
   * claimed the key, which is what keeps a breach that repeats on every trace
   * from mailing the customer on every trace. `ttlSeconds` defaults to the
   * day-long window the mail claims use; the pause attempt passes a short one
   * so a failed write is retried in a minute rather than tomorrow.
   */
  claimOnce: (key: string, ttlSeconds?: number) => Promise<boolean>;
  projectName: (projectId: string) => Promise<string>;
  automationUrl: (params: {
    projectId: string;
    triggerId: string;
  }) => Promise<string>;
  now?: () => Date;
}

export interface PersistCapBreach {
  trigger: TriggerSummary;
  projectId: string;
  /** Confirmed matches counted today, including the ones over the ceiling. */
  count: number;
  cap: number;
  skipped: number;
}

/**
 * Handles one confirmed match that the daily ceiling refused.
 *
 * THE BLAME SPLIT IS THE POINT. Reaching the ceiling means the automation is
 * doing real work faster than a person can consume it, which is a throttle, not
 * a fault: the trigger stays active, the customer is told once, and it starts
 * again tomorrow. Pausing is reserved for the narrow shape where the automation
 * is genuinely misconfigured, which is either a grandfathered condition-less
 * automation or one whose confirmed matches cover almost the whole project's
 * traffic. An automation that is merely popular is never paused.
 *
 * NOTHING HERE MAY THROW. It runs inside a dispatch the outbox will retry on
 * failure, so an error escaping this would replay a side effect that already
 * landed in order to redo bookkeeping that did not matter.
 */
export async function handlePersistCapBreach(
  deps: RunawayContainmentDeps,
  breach: PersistCapBreach,
): Promise<void> {
  const { trigger, projectId, cap, skipped } = breach;
  const now = (deps.now ?? (() => new Date()))();
  const dayBucket = Math.floor(now.getTime() / 86_400_000);

  try {
    incrementAutomationCeilingBreachTotal();

    // A team-facing record with the numbers on it. This is the alerting hook:
    // there is no internal Slack notifier to call, so the alert rule watches
    // the counters and this line carries the detail for whoever follows it up.
    logger.error(
      {
        projectId,
        triggerId: trigger.id,
        cap,
        count: breach.count,
        skipped,
      },
      "Automation passed its daily ceiling on confirmed matches; further " +
        "matches are being skipped for the rest of the UTC day",
    );

    const shouldPause = await isMisconfigured(deps, breach);
    if (shouldPause) {
      await pauseAndNotify({ deps, breach, now, dayBucket });
      return;
    }

    // Throttled, not broken: tell them once today and leave it running.
    if (
      !(await deps.claimOnce(`automation-cap-mail:${trigger.id}:${dayBucket}`))
    ) {
      return;
    }
    await notify(deps, breach, "ceiling_reached");
  } catch (error) {
    logger.warn(
      {
        projectId,
        triggerId: trigger.id,
        error: error instanceof Error ? error.message : String(error),
      },
      "Runaway containment failed; the dispatch it was watching is unaffected",
    );
  }
}

/**
 * Is this automation misconfigured rather than merely busy?
 *
 * Two shapes qualify. A grandfathered automation with no condition at all
 * matches the project by definition. Otherwise the confirmed matches have to
 * cover almost all of the project's traffic, measured over enough traces for
 * the ratio to mean something.
 */
async function isMisconfigured(
  deps: RunawayContainmentDeps,
  breach: PersistCapBreach,
): Promise<boolean> {
  if (isMatchEverythingTrigger(breach.trigger)) return true;

  const projectTraces = await deps.countProjectTraces24h(breach.projectId);
  if (projectTraces < RUNAWAY_MIN_PROJECT_TRACES) return false;
  return breach.count >= projectTraces * RUNAWAY_TRAFFIC_SHARE;
}

async function pauseAndNotify({
  deps,
  breach,
  now,
  dayBucket,
}: {
  deps: RunawayContainmentDeps;
  breach: PersistCapBreach;
  now: Date;
  dayBucket: number;
}): Promise<void> {
  const { trigger, projectId } = breach;

  // TWO CLAIMS, WITH DIFFERENT LIFETIMES, AND THE ORDER MATTERS.
  //
  // The pause claim is short and is taken BEFORE the write only to absorb the
  // storm: thousands of dispatches can already be in flight when the ceiling
  // breaks, and each would otherwise issue its own update. It deliberately does
  // NOT carry the day. A day-long claim held before a write that can fail
  // (Prisma timeout, connection loss) means one lost write leaves the runaway
  // automation active until the UTC day rolls over, with a single warn line as
  // the only trace. Pausing is an idempotent write to active/pausedReason/
  // pausedAt, so doing it twice costs an update; doing it zero times is the
  // failure this whole file exists to prevent.
  if (
    !(await deps.claimOnce(
      `automation-pause:${trigger.id}`,
      PAUSE_ATTEMPT_CLAIM_SECONDS,
    ))
  ) {
    return;
  }

  await deps.pauseTrigger({
    triggerId: trigger.id,
    projectId,
    reason: RUNAWAY_PAUSE_REASON,
    at: now,
  });
  incrementAutomationAutoPausedTotal(RUNAWAY_PAUSE_REASON);
  logger.error(
    {
      projectId,
      triggerId: trigger.id,
      cap: breach.cap,
      count: breach.count,
    },
    "Automation paused for runaway volume: its confirmed matches cover " +
      "essentially all of the project's traffic",
  );

  // The mail is claimed for the day, and only after the pause has actually
  // landed. A customer who switches it back on and runs it away again the same
  // day is paused again, quietly, rather than mailed twice.
  if (
    !(await deps.claimOnce(`automation-pause-mail:${trigger.id}:${dayBucket}`))
  ) {
    return;
  }
  await notify(deps, breach, "paused");
}

async function notify(
  deps: RunawayContainmentDeps,
  breach: PersistCapBreach,
  kind: "ceiling_reached" | "paused",
): Promise<void> {
  const { trigger, projectId } = breach;
  const to = await deps.notificationRecipients(projectId);
  if (to.length === 0) {
    logger.info(
      { projectId, triggerId: trigger.id, kind },
      "No recipients to notify about an automation limit",
    );
    return;
  }
  await deps.sendLimitEmail({
    to,
    kind,
    automationName: trigger.name,
    projectName: await deps.projectName(projectId),
    dailyCeiling: breach.cap,
    skippedToday: breach.skipped,
    actionUrl: await deps.automationUrl({ projectId, triggerId: trigger.id }),
  });
}
