import {
  growthRetentionDaysSchema,
  PLATFORM_DEFAULT_RETENTION_DAYS,
  retentionCategories,
} from "@langwatch/data-retention-contract";

import type { DataRetentionService } from "./data-retention.service.ts";

/**
 * A paid Growth Seat activation records retention as explicit organization policies: the
 * buyer's pick for every category, or, without one, the platform default where none is set.
 * Spec: specs/billing/seat-subscription-retention-policy.feature
 */
export class SeatRetentionPolicyService {
  static create({
    rules,
  }: {
    rules: Pick<DataRetentionService, "listOrganizationRules" | "setForScope">;
  }): SeatRetentionPolicyService {
    return new SeatRetentionPolicyService(rules);
  }

  private constructor(
    private readonly rules: Pick<DataRetentionService, "listOrganizationRules" | "setForScope">,
  ) {}

  /** The buyer's pick is written for every category; without one, create-if-absent. */
  async provisionMissing({
    organizationId,
    retentionDays,
  }: {
    organizationId: string;
    retentionDays?: number;
  }): Promise<void> {
    // A value that is not a Growth option would fail on every retry: it falls back to no pick.
    const pick = growthRetentionDaysSchema.validate(retentionDays) ? retentionDays : undefined;
    const existing = await this.rules.listOrganizationRules({ organizationId });
    const covered = new Map(
      existing
        .filter((row) => row.scopeType === "ORGANIZATION" && row.scopeId === organizationId)
        .map((row) => [row.category, row.retentionDays]),
    );

    for (const category of retentionCategories) {
      const current = covered.get(category);
      const settled = pick === undefined ? current !== undefined : current === pick;
      if (settled) continue;
      await this.rules.setForScope({
        organizationId,
        scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
        category,
        retentionDays: pick ?? PLATFORM_DEFAULT_RETENTION_DAYS,
      });
    }
  }
}
