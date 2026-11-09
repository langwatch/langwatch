import {
  growthRetentionDaysSchema,
  PLATFORM_DEFAULT_RETENTION_DAYS,
  retentionCategories,
} from "@langwatch/data-retention-contract";

import type { DataRetentionService } from "./data-retention.service.ts";

/**
 * A paid Growth Seat activation records retention as explicit organization policies: the
 * buyer's pick where it keeps data longer, or, without one, the platform default where none is set.
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

  /** The buyer's pick fills every category and lengthens shorter rules; never shortens one. */
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
      if (current !== undefined && !lengthens({ current, pick })) continue;
      await this.rules.setForScope({
        organizationId,
        scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
        category,
        retentionDays: pick ?? PLATFORM_DEFAULT_RETENTION_DAYS,
      });
    }
  }
}

/** A pick replaces an existing rule only when it keeps data longer; 0 already keeps forever. */
function lengthens({ current, pick }: { current: number; pick: number | undefined }): boolean {
  return pick !== undefined && current !== 0 && pick > current;
}
