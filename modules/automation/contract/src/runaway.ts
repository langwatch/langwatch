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
 * Where a project's organization can go for a higher automation ceiling,
 * matching the shape `@langwatch/mail`'s automation-limit template asks for.
 *
 * Resolved only for a `ceiling_reached` notice — a paused automation is a
 * mistake in the customer's own condition, not a sales moment.
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
