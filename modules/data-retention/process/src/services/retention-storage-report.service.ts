/**
 * Measures what each organization stores past the 90 days Growth includes and hands it to
 * billing. Rows older than 90 days, not total x (R - 90) / R, so a young organization pays for
 * nothing. Spec: specs/billing/retention-storage-billing.feature
 */
import type { BillingApi, RetentionStorageOutcome } from "@langwatch/enterprise-billing-contract";

import { type RetentionStorageMeasuredEventData } from "../eventing/retention-storage-report.events.ts";
import type { DataRetentionRepository } from "../repositories/data-retention.repository.ts";
import type { StorageMeterRepository } from "../repositories/storage-meter.repository.ts";
import {
  includedRetentionCutoffMs,
  longestRetentionDays,
  retentionStorageDayOf,
  retentionStorageMeasurement,
} from "../rules/retention-storage.rules.ts";
import type { DataRetentionService } from "./data-retention.service.ts";

type Options = Readonly<{
  policies: Pick<DataRetentionRepository, "findAllInOrganization" | "findOrganizationIdsWithRules">;
  /** Archived projects included: their stored rows are still kept, so they are still billed. */
  projects: Pick<DataRetentionService, "findScopeProjectIds">;
  meter: Pick<StorageMeterRepository, "getTenantBytesBefore">;
  billing: Pick<BillingApi, "recordRetentionStorage">;
}>;

export class RetentionStorageReportService {
  static create(options: Options): RetentionStorageReportService {
    return new RetentionStorageReportService(options);
  }

  private constructor(private readonly options: Options) {}

  /** Every organization with a retention rule: the ones the daily report asks about. */
  findOrganizationIds(): Promise<readonly string[]> {
    return this.options.policies.findOrganizationIdsWithRules();
  }

  /** Aligns the storage line with the organization's rules, without measuring. */
  async syncLine({ organizationId }: { organizationId: string }): Promise<RetentionStorageOutcome> {
    return this.options.billing.recordRetentionStorage({
      organizationId,
      longestRetentionDays: await this.longest(organizationId),
    });
  }

  /**
   * Aligns the line, then measures only when the organization pays for storage: one
   * measurement for the day, or none when billing has no storage line for it.
   */
  async measure({
    organizationId,
    day,
    measuredAt,
  }: {
    organizationId: string;
    day: string;
    measuredAt: number;
  }): Promise<readonly RetentionStorageMeasuredEventData[]> {
    const measuredDay = retentionStorageDayOf(measuredAt).day;
    if (measuredDay !== day) {
      throw new Error(`A measurement taken on ${measuredDay} cannot stand for ${day}`);
    }
    const longest = await this.longest(organizationId);
    const aligned = await this.options.billing.recordRetentionStorage({
      organizationId,
      longestRetentionDays: longest,
    });
    if (aligned.line !== "added" && aligned.line !== "kept") return [];

    const bytesAboveIncluded = await this.bytesPastIncluded({ organizationId, measuredAt });
    const measurement = retentionStorageMeasurement({
      organizationId,
      bytesAboveIncluded,
      measuredAt,
    });
    return [
      {
        organizationId,
        day: measurement.day,
        longestRetentionDays: longest,
        bytesAboveIncluded,
        gbBeyondIncluded: measurement.gbBeyondIncluded,
        dailyShareGb: measurement.dailyShareGb,
        identifier: measurement.identifier,
        measuredAt,
      },
    ];
  }

  /** Sends a recorded measurement to billing's meter; the day's identifier makes it once. */
  bill(measured: RetentionStorageMeasuredEventData): Promise<RetentionStorageOutcome> {
    return this.options.billing.recordRetentionStorage({
      organizationId: measured.organizationId,
      longestRetentionDays: measured.longestRetentionDays,
      bytesAboveIncluded: measured.bytesAboveIncluded,
      measuredAt: measured.measuredAt,
    });
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
    const projectIds = await this.options.projects.findScopeProjectIds({
      organizationId,
      scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
    });
    const beforeMs = includedRetentionCutoffMs(measuredAt);
    let total = 0;
    // One project at a time: each read already spans every metered table.
    for (const tenantId of projectIds) {
      total += await this.options.meter.getTenantBytesBefore({ tenantId, beforeMs });
    }
    return total;
  }
}
