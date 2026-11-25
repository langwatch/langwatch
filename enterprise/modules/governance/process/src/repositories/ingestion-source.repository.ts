import type {
  GovernanceIngestionSource,
  GovernanceIngestionSourceType,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

export interface IngestionPullSourceReader {
  findById(id: string): Promise<GovernanceIngestionSource | null>;
}

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
  createdById: string | null;
  providerAccountId: string | null;
};

/** A source as the batch that reached it read it: its status may already be stale. */
export type ReceivingIngestionSource = Pick<GovernanceIngestionSource, "id" | "status">;

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

/** ADR-088: the span a source's pulled spend was read without being priced; never on the wire. */
export type UnpricedUsageWindow = {
  since: Instant | null;
  through: Instant | null;
};

/** One unarchived source's window pulled while cost recording was off (ADR-088). */
export type UnpricedUsageSourceWindow = {
  name: string;
  since: Instant;
  through: Instant | null;
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
  /**
   * Stamps a batch: last event time, and active. Never touches a source that is off.
   * `wentLive` is true for the one stamp that moved it off awaiting, however many race.
   * Only a source read as awaiting tries the conditional write; a stale read is safe.
   */
  abstract recordEventReceived(
    source: ReceivingIngestionSource,
    at: Instant,
  ): Promise<{ wentLive: boolean }>;
  abstract getUnpricedUsageWindow(id: string): Promise<UnpricedUsageWindow>;
  abstract updateUnpricedUsageWindow(id: string, window: UnpricedUsageWindow): Promise<void>;
  /** The organisation's unarchived sources that read a window they could not price. */
  abstract findUnpricedUsageWindows(organizationId: string): Promise<UnpricedUsageSourceWindow[]>;
  abstract updateIfCursorUnchanged(input: {
    id: string;
    cursor: unknown;
    update: UpdateIngestionSourceRecord;
  }): Promise<CursorPinnedUpdate>;
}
