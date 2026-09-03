/**
 * What an organization's plan permits of its retention, in the two facts the
 * retention tiering actually turns on.
 *
 * Deliberately NOT a `PlanProvider` and deliberately not `PlanInfo`. Retention
 * packaging owns its own tiering — which values a tier may persist, the
 * enterprise custom floor, the paid presets that are the sole exceptions below
 * it — and that rule stays in this package. What leaves is only the billing and
 * licensing plumbing behind these two booleans: which plan types count as
 * enterprise, and whether this install is SaaS at all. Neither is retention's
 * to know, and dragging them in is what would couple this feature to the
 * licence reader.
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
export abstract class DataRetentionPlanPort {
  abstract getPlan(input: {
    organizationId: string;
    userId: string | null;
  }): Promise<DataRetentionPlan>;
}
