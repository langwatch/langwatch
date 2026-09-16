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
