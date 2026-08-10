/**
 * PlanInfo type definition - isolated to avoid circular dependencies.
 *
 * This type is used by both ee/licensing and src/server code.
 * Keeping it in a separate file prevents webpack from bundling
 * server-side code when client components import from ee/licensing.
 */
export type PlanInfo = {
  planSource: "license" | "subscription" | "free";
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
  maxMessagesPerMonth: number;
  canPublish: boolean;
  /**
   * Webhook endpoints platform (signed outbound event delivery). Enterprise
   * feature: absent/false on free, PRO, and GROWTH plans; enterprise
   * licenses and subscriptions carry true.
   */
  webhookEndpointsEnabled?: boolean;
  /**
   * Per-contract override of the daily ceiling on confirmed persist dispatches
   * an automation may make (dataset rows, annotation-queue items). Absent means
   * the plan tier's default applies. This is the escape hatch for a customer
   * whose legitimate volume is above their tier, so raising one account's
   * ceiling never means loosening it for everyone.
   */
  maxTriggerPersistDispatchesPerDay?: number;
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
