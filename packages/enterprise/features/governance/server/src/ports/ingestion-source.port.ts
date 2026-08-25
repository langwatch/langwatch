import type {
  GovernanceIngestionSource,
  GovernanceIngestionSourceType,
} from "@langwatch/enterprise-governance-contract";

export type CreateIngestionSourceRecord = {
  organizationId: string;
  teamId: string | null;
  sourceType: GovernanceIngestionSourceType;
  name: string;
  description: string | null;
  ingestSecretHash: string;
  parserConfig: Record<string, unknown>;
  pullSchedule: string | null;
  status: "awaiting_first_event";
  createdById: string;
};

export type UpdateIngestionSourceRecord = {
  name?: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  status?: "active" | "disabled" | "awaiting_first_event";
  teamId?: string | null;
  pullSchedule?: string | null;
  ingestSecretHash?: string;
  archivedAt?: Date;
  lastEventAt?: Date;
};

export abstract class IngestionSourceRepository {
  abstract list(organizationId: string): Promise<GovernanceIngestionSource[]>;
  abstract tryFindById(id: string): Promise<GovernanceIngestionSource | null>;
  abstract tryFindByCurrentSecretHash(
    hash: string,
  ): Promise<GovernanceIngestionSource | null>;
  abstract findByPriorSecretHash(hash: string): Promise<GovernanceIngestionSource[]>;
  abstract countLive(organizationId: string): Promise<number>;
  abstract create(input: CreateIngestionSourceRecord): Promise<GovernanceIngestionSource>;
  abstract update(
    id: string,
    input: UpdateIngestionSourceRecord,
  ): Promise<GovernanceIngestionSource>;
}

export abstract class IngestionSourceEntitlementsPort {
  abstract hasEnterprisePlan(organizationId: string): Promise<boolean>;
}

export abstract class IngestionSourceLifecyclePort {
  abstract sync(source: GovernanceIngestionSource): Promise<void>;
}
