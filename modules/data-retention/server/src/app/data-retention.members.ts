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
   * Whether the plan may persist any whole-week value at or above the
   * enterprise custom floor, rather than only the fixed paid presets.
   *
   * Enterprise tiers and self-hosted installs are uncapped; every other
   * non-free plan is not. An unrecognised tier must resolve to `false`, which
   * fails CLOSED to the restrictive menu — the data-loss-safe direction.
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
