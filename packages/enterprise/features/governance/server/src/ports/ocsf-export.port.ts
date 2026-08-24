import type { GovernanceOcsfExportRow } from "@langwatch/enterprise-governance-contract";

export abstract class GovernanceOcsfExportRepository {
  abstract resolveGovernanceTenantId(
    organizationId: string,
  ): Promise<string | null>;
}

export abstract class GovernanceOcsfEventsReaderPort {
  abstract findAll(input: {
    tenantId: string;
    sinceMs: number;
    sinceEventId: string;
    limit: number;
  }): Promise<GovernanceOcsfExportRow[]>;
}
