/**
 * What an organization stores today and how many days of data that is, read when the upgrade
 * dialog opens so it can price a retention longer than Growth includes.
 * Spec: specs/billing/retention-at-upgrade.feature
 */
import type { OrganizationStorageEstimate } from "@langwatch/data-retention-contract";
import { nowInstant } from "@langwatch/time";

import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { DataRetentionService } from "./data-retention.service.ts";
import type { StorageMeterService } from "./storage-meter.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

type OrganizationStorageEstimateServiceOptions = Readonly<{
  meter: Pick<StorageMeterService, "getTotalStorageBytesForTenants">;
  directory: Pick<DataRetentionDirectoryReader, "findScopeProjects" | "findOrganizationCreatedAt">;
  retention: Pick<
    DataRetentionService,
    "listOrganizationRules" | "getPlatformDefaultRetentionDays"
  >;
  now?: () => number;
}>;

export class OrganizationStorageEstimateService {
  static create(
    options: OrganizationStorageEstimateServiceOptions,
  ): OrganizationStorageEstimateService {
    return new OrganizationStorageEstimateService(options);
  }

  private constructor(private readonly options: OrganizationStorageEstimateServiceOptions) {}

  async getEstimate({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationStorageEstimate> {
    const { meter, directory, retention } = this.options;
    const [projects, rules, createdAt] = await Promise.all([
      directory.findScopeProjects({
        organizationId,
        scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
      }),
      retention.listOrganizationRules({ organizationId }),
      directory.findOrganizationCreatedAt({ organizationId }),
    ]);
    const totalBytes = await meter.getTotalStorageBytesForTenants({
      tenantIds: projects.map((project) => project.id),
    });

    const organizationTraces = rules.find(
      (rule) =>
        rule.scopeType === "ORGANIZATION" &&
        rule.scopeId === organizationId &&
        rule.category === "traces",
    );
    const retentionDays =
      organizationTraces && organizationTraces.retentionDays > 0
        ? organizationTraces.retentionDays
        : retention.getPlatformDefaultRetentionDays();
    const now = this.options.now?.() ?? nowInstant().epochMilliseconds;
    const ageDays = createdAt[0]
      ? Math.ceil((now - createdAt[0].epochMilliseconds) / DAY_MS)
      : retentionDays;

    return { totalBytes, coveredDays: Math.max(1, Math.min(retentionDays, ageDays)) };
  }
}
