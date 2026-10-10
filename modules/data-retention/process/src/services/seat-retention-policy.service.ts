import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  retentionCategories,
} from "@langwatch/data-retention-contract";

import type { DataRetentionService } from "./data-retention.service.ts";

/**
 * A paid Growth Seat activation records the retention entitlement as explicit organization
 * policies at the platform default, filling only the categories that have none (round 37 D4).
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

  /** Create-if-absent, never an upsert: an override is never shortened. Throws to be retried. */
  async provisionMissing({ organizationId }: { organizationId: string }): Promise<void> {
    const existing = await this.rules.listOrganizationRules({ organizationId });
    const covered = new Set(
      existing
        .filter((row) => row.scopeType === "ORGANIZATION" && row.scopeId === organizationId)
        .map((row) => row.category),
    );

    for (const category of retentionCategories) {
      if (covered.has(category)) continue;
      await this.rules.setForScope({
        organizationId,
        scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
        category,
        retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      });
    }
  }
}
