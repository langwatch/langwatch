import type { GovernanceOcsfExportRow } from "@langwatch/enterprise-governance-contract";

export abstract class GovernanceOcsfExportRepository {
  abstract tryResolveGovernanceTenantId(organizationId: string): Promise<string | null>;
}

export abstract class GovernanceOcsfEventsReaderPort {
  abstract findAll(input: {
    tenantId: string;
    sinceMs: number;
    sinceEventId: string;
    limit: number;
  }): Promise<GovernanceOcsfExportRow[]>;
}
