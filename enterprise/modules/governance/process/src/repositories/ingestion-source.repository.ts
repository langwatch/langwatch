import type {
  GovernanceIngestionSource,
  GovernanceIngestionSourceType,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

export type CreateIngestionSourceRecord = {
  organizationId: string;
  teamId: string | null;
  traceProjectId: string | null;
  sourceType: GovernanceIngestionSourceType;
  name: string;
  description: string | null;
  ingestSecretHash: string;
  parserConfig: Record<string, unknown>;
  pullSchedule: string | null;
  status: "awaiting_first_event";
  createdById: string;
  providerAccountId: string | null;
};

export type UpdateIngestionSourceRecord = {
  name?: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  status?: "active" | "disabled" | "awaiting_first_event";
  teamId?: string | null;
  traceProjectId?: string | null;
  pullSchedule?: string | null;
  ingestSecretHash?: string;
  providerAccountId?: string;
  archivedAt?: Instant;
  lastEventAt?: Instant;
};

/** A live source as the ownership guards read it: what it claims, and whether it is off. */
export type IngestionSourceClaim = {
  id: string;
  name: string;
  status: string;
  providerAccountId: string | null;
  parserConfig: Record<string, unknown>;
};

export type CursorPinnedUpdate =
  | { outcome: "updated"; source: GovernanceIngestionSource }
  | { outcome: "cursor_moved" };

export abstract class IngestionSourceRepository {
  abstract findAll(organizationId: string): Promise<GovernanceIngestionSource[]>;
  abstract findById(id: string): Promise<GovernanceIngestionSource | null>;
  abstract findByCurrentSecretHash(hash: string): Promise<GovernanceIngestionSource | null>;
  abstract findByPriorSecretHash(hash: string): Promise<GovernanceIngestionSource[]>;
  abstract countLive(organizationId: string): Promise<number>;
  /** Every source in the organisation that is not archived, as the ownership guards see them. */
  abstract findClaims(organizationId: string): Promise<IngestionSourceClaim[]>;
  /** Every Copilot Studio source in the organisation, archived included: Azure bill history. */
  abstract findAzureBillHistory(
    organizationId: string,
  ): Promise<{ id: string; parserConfig: unknown }[]>;
  abstract create(input: CreateIngestionSourceRecord): Promise<GovernanceIngestionSource>;
  abstract update(
    id: string,
    input: UpdateIngestionSourceRecord,
  ): Promise<GovernanceIngestionSource>;
  abstract updateIfCursorUnchanged(input: {
    id: string;
    cursor: unknown;
    update: UpdateIngestionSourceRecord;
  }): Promise<CursorPinnedUpdate>;
}
