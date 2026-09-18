/**
 * Organization's retention plan permissions; only the two booleans affecting
 * billing/licensing leave this package to avoid coupling to plan readers.
 */
export type DataRetentionPlan = Readonly<{
  /**
   * A free plan gets the platform-wide default and may configure nothing. Every
   * write gate starts here.
   */
  free: boolean;
  /**
   * Whether the plan may persist a whole-week value at or above the enterprise
   * custom floor. An unrecognised tier must resolve to `false` — fails CLOSED
   * to the restrictive menu, the data-loss-safe direction.
   */
  uncapped: boolean;
}>;

/** Resolves the plan one organization's retention writes are gated by. */
export interface DataRetentionPlanResolver {
  getPlan(input: {
    organizationId: string;
    userId: string | null;
  }): Promise<DataRetentionPlan>;
}
