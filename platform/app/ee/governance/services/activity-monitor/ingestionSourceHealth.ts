// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Derived health for an ingestion source.
 *
 * `IngestionSource.status` has three values — `active`, `disabled`, and
 * `awaiting_first_event` — and the third one hides a real failure. A source
 * created five minutes ago and a source that has been configured for six
 * months without ever producing an event are both `awaiting_first_event`,
 * and nothing distinguishes them.
 *
 * That is precisely how the retired `copilot_studio` source stayed invisible:
 * it authenticated, it polled, it never returned a Copilot interaction, and
 * it sat in `awaiting_first_event` looking like it had merely been set up
 * recently. Fixing the endpoint without fixing this would leave the same
 * blind spot pointed at a different API.
 *
 * This is derived rather than stored: it is a function of fields the worker
 * already maintains, so there is nothing to keep in sync and no migration.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */

/**
 * How long a source may sit at `awaiting_first_event` before that stops
 * being "recently created" and starts being "does not work".
 *
 * A day rather than an hour: pull sources run on a 15-minute cron against
 * upstreams that can genuinely be quiet overnight, and a threshold that
 * fires on every quiet evening trains people to ignore it.
 */
export const NEVER_PRODUCED_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Consecutive failures before a source is called broken rather than unlucky.
 * `errorCount` resets to 0 on any successful run.
 */
export const ERRORING_AFTER_CONSECUTIVE_FAILURES = 3;

export type IngestionSourceHealth =
  /** Paused by an admin, or retired by a migration. */
  | "disabled"
  /** Failing repeatedly. Distinct from producing nothing. */
  | "erroring"
  /** Created recently, nothing yet. Normal, and expected to resolve. */
  | "awaiting_first_event"
  /**
   * Configured, not erroring, and has never produced an event for longer
   * than any reasonable setup delay. The state this module exists for.
   */
  | "never_produced"
  /** Producing events. */
  | "active";

export interface HealthInput {
  status: string;
  createdAt: Date;
  lastEventAt: Date | null;
  errorCount: number;
  /** Injectable for tests. Defaults to now. */
  nowMs?: number;
}

/**
 * Classify a source. Order matters: an explicit admin action outranks a
 * derived judgement, and "failing" outranks "silent" because a failing
 * source has a cause worth reading before its silence is interpreted.
 */
export function classifyIngestionSourceHealth({
  status,
  createdAt,
  lastEventAt,
  errorCount,
  nowMs = Date.now(),
}: HealthInput): IngestionSourceHealth {
  if (status === "disabled") return "disabled";

  if (errorCount >= ERRORING_AFTER_CONSECUTIVE_FAILURES) return "erroring";

  if (lastEventAt !== null) return "active";

  const age = nowMs - createdAt.getTime();
  return age >= NEVER_PRODUCED_AFTER_MS
    ? "never_produced"
    : "awaiting_first_event";
}

/**
 * Operator-facing copy per derived health. Kept beside the classifier so a
 * new state cannot be added without saying what it means to a human.
 */
export const HEALTH_COPY: Record<
  IngestionSourceHealth,
  { label: string; detail: string }
> = {
  disabled: {
    label: "Disabled",
    detail: "Paused. It will not poll or accept events until re-enabled.",
  },
  erroring: {
    label: "Failing",
    detail:
      "Recent runs failed. Check credentials and upstream permissions before reading anything into the event count.",
  },
  awaiting_first_event: {
    label: "Awaiting first event",
    detail:
      "Configured, nothing received yet. Pull sources only see activity from the moment they are connected — they do not import history.",
  },
  never_produced: {
    label: "Configured, never produced an event",
    detail:
      "This source has been connected for over a day without a single event, and is not reporting errors. Either the upstream genuinely has no activity, or it is not sending what we expect.",
  },
  active: {
    label: "Active",
    detail: "Receiving events.",
  },
};
