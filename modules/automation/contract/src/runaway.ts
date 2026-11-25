/** Narrow, transport-neutral input for a persist-ceiling containment action. */
export type AutomationRunawayTrigger = {
  id: string;
  name: string;
  triggerKind: string;
  customGraphId: string | null;
  filterQuery: string | null;
  filters: Record<string, unknown>;
};

export type AutomationPersistCapBreach = {
  trigger: AutomationRunawayTrigger;
  projectId: string;
  count: number;
  cap: number;
  skipped: number;
};

/**
 * Where a project's organization can go for a higher automation ceiling
 * (matches `@langwatch/mail`'s template). Resolved only for
 * `ceiling_reached` -- a paused automation is a mistake, not a sales moment.
 */
export type AutomationLimitNextStep =
  | {
      kind: "self_serve";
      name: string;
      url: string;
      price: number;
      currency: string;
      billingPeriod: "monthly" | "annual";
      pricedPerSeat?: boolean;
      /** Confirmed matches a day one automation may act on, on that tier. */
      dailyCeiling: number;
    }
  | { kind: "account_team"; contactUrl: string };

/** Persisted reasons why the platform paused an automation. */
export const AUTOMATION_PAUSE_REASONS = ["runaway_volume"] as const;

export type AutomationPauseReason = (typeof AUTOMATION_PAUSE_REASONS)[number];

/** The automation matched essentially all of the project's traffic. */
export const RUNAWAY_PAUSE_REASON: AutomationPauseReason = "runaway_volume";

/** What we tell the customer about a runaway pause. One constant because the
 *  list's Paused badge, the view drawer's badge and its "what happens next"
 *  answer all say it; the mailer's wording is deliberately its own. */
export const RUNAWAY_PAUSE_EXPLANATION =
  "This automation matched almost every trace in the project, so we paused it. Narrow its condition, then switch it back on.";

export function isAutomationPauseReason(
  reason: string | null | undefined,
): reason is AutomationPauseReason {
  return reason != null && (AUTOMATION_PAUSE_REASONS as readonly string[]).includes(reason);
}
