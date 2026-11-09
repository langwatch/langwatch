/**
 * Measures what each organization stores past the 90 days Growth includes and hands it to
 * billing. Rows older than 90 days, not total x (R - 90) / R, so a young organization pays for
 * nothing. Spec: specs/billing/retention-storage-billing.feature
 */
import type { BillingApi, RetentionStorageOutcome } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";

import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { DataRetentionRepository } from "../repositories/data-retention.repository.ts";
import type { StorageMeterRepository } from "../repositories/storage-meter.repository.ts";
import {
  includedRetentionCutoffMs,
  longestRetentionDays,
} from "../rules/retention-storage.rules.ts";

const logger = createLogger("langwatch:data-retention:retention-storage");

/** What one daily pass did, organization by organization. */
export type RetentionStorageReportOutcome = Readonly<{
  measured: number;
  unbilled: number;
  failed: number;
}>;

type Options = Readonly<{
  policies: Pick<DataRetentionRepository, "findAllInOrganization" | "findOrganizationIdsWithRules">;
  directory: Pick<DataRetentionDirectoryReader, "findScopeProjects">;
  meter: Pick<StorageMeterRepository, "getTenantBytesBefore">;
  billing: Pick<BillingApi, "recordRetentionStorage">;
  now?: () => number;
}>;

export class RetentionStorageReportService {
  static create(options: Options): RetentionStorageReportService {
    return new RetentionStorageReportService(options);
  }

  private constructor(private readonly options: Options) {}

  /** Aligns the storage line with the organization's rules, without measuring. */
  async syncLine({ organizationId }: { organizationId: string }): Promise<RetentionStorageOutcome> {
    return this.options.billing.recordRetentionStorage({
      organizationId,
      longestRetentionDays: await this.longest(organizationId),
    });
  }

  /** Aligns the line, then measures and reports only when the organization pays for storage. */
  async reportOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<RetentionStorageOutcome> {
    const longest = await this.longest(organizationId);
    const aligned = await this.options.billing.recordRetentionStorage({
      organizationId,
      longestRetentionDays: longest,
    });
    if (aligned.line !== "added" && aligned.line !== "kept") return aligned;

    const measuredAt = (this.options.now ?? Date.now)();
    const bytes = await this.bytesPastIncluded({ organizationId, measuredAt });
    return this.options.billing.recordRetentionStorage({
      organizationId,
      longestRetentionDays: longest,
      bytesAboveIncluded: bytes,
      measuredAt,
    });
  }

  /** One pass over every organization with rules; a failure is counted and retried tomorrow. */
  async reportAll(): Promise<RetentionStorageReportOutcome> {
    const organizationIds = await this.options.policies.findOrganizationIdsWithRules();
    let measured = 0;
    let unbilled = 0;
    let failed = 0;
    for (const organizationId of organizationIds) {
      try {
        const outcome = await this.reportOrganization({ organizationId });
        if (outcome.reportedGbMonths === null) unbilled += 1;
        else measured += 1;
      } catch (error) {
        failed += 1;
        logger.error(
          { organizationId, error: error instanceof Error ? error.message : String(error) },
          "Retention storage report failed for an organization",
        );
      }
    }
    return { measured, unbilled, failed };
  }

  private async longest(organizationId: string): Promise<number> {
    return longestRetentionDays(
      await this.options.policies.findAllInOrganization({ organizationId }),
    );
  }

  private async bytesPastIncluded({
    organizationId,
    measuredAt,
  }: {
    organizationId: string;
    measuredAt: number;
  }): Promise<number> {
    const projects = await this.options.directory.findScopeProjects({
      organizationId,
      scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
    });
    const beforeMs = includedRetentionCutoffMs(measuredAt);
    let total = 0;
    // One project at a time: each read already spans every metered table.
    for (const project of projects) {
      total += await this.options.meter.getTenantBytesBefore({ tenantId: project.id, beforeMs });
    }
    return total;
  }
}
