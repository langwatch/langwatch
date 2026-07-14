/**
 * PlanInfo type definition - isolated to avoid circular dependencies.
 *
 * This type is used by both ee/licensing and src/server code.
 * Keeping it in a separate file prevents webpack from bundling
 * server-side code when client components import from ee/licensing.
 */
/**
 * How an organization expands full members once its cap is reached (ADR-039
 * Decision 4). Doubles as the `resolution` carried on member-limit denials.
 */
export type MemberPolicy = "purchase_seat" | "upgrade" | "hard_cap";

/** Usage metering basis (ADR-039 Decision 2). */
export type MeterUnit = "events" | "traces";

/**
 * Billing mechanics derived from the winning plan source. Never stored —
 * `Organization.pricingModel` is a display cache, not an input (ADR-039).
 */
export type BillingProfile = {
  meterUnit: MeterUnit;
  memberPolicy: MemberPolicy;
  showUsageLimits: boolean;
  isLegacyTiered: boolean;
};

/**
 * Feature capabilities derived from the winning plan (ADR-039 Decision 6).
 * Replaces scattered `plan.type === "ENTERPRISE"` string checks.
 */
export type PlanCapabilities = {
  rbac: boolean;
  scim: boolean;
  sso: boolean;
  groups: boolean;
  customRoles: boolean;
};

export type PlanInfo = {
  planSource: "license" | "subscription" | "free";
  /**
   * Billing mechanics + capabilities, stamped by the composite plan provider
   * (ADR-039). Optional because raw plan literals (PLAN_LIMITS, templates)
   * don't carry them — the resolver is the only writer.
   */
  billing?: BillingProfile;
  capabilities?: PlanCapabilities;
  type: string;
  name: string;
  free: boolean;
  /**
   * Read-path visibility window in days. Trace content older than this is
   * teaser-redacted server-side. `null`/`undefined` = no blur — all paid,
   * enterprise, and licensed plans. Only free plans carry a number.
   */
  visibilityDays?: number | null;
  trialDays?: number;
  daysSinceCreation?: number;
  overrideAddingLimitations?: boolean;
  maxMembers: number;
  maxMembersLite: number;
  maxTeams: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  maxWorkflows: number;
  maxPrompts: number;
  maxEvaluators: number;
  maxScenarios: number;
  maxAgents: number;
  maxExperiments: number;
  maxOnlineEvaluations: number;
  maxDatasets: number;
  maxDashboards: number;
  maxCustomGraphs: number;
  maxAutomations: number;
  canPublish: boolean;
  usageUnit?: string;
  userPrice?: {
    USD: number;
    EUR: number;
  };
  tracesPrice?: {
    USD: number;
    EUR: number;
  };
  prices: {
    USD: number;
    EUR: number;
  };
};
