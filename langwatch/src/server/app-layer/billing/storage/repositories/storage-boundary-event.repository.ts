import type { RetentionCategory } from "~/server/data-retention/retentionPolicy.schema";
import type { BoundaryEdge } from "../boundaryEventIdentity";

export interface AppendBoundaryEventInput {
  organizationId: string;
  projectId: string;
  category: RetentionCategory;
  partitionKey: string;
  /** UTC midnight of the day-slice. */
  sliceDate: Date;
  retentionDays: number;
  edge: BoundaryEdge;
  /** Signed: entries/seeds positive, exits/corrections negative. */
  deltaBytes: bigint;
  /** The boundary instant this delta takes effect. */
  occurredAt: Date;
  /** Mandatory for DELETION/REVERSAL; set on correction re-emits. */
  causeId?: string;
}

export interface StoredBoundaryEvent {
  id: string;
  organizationId: string;
  projectId: string;
  category: string;
  partitionKey: string;
  sliceDate: Date;
  retentionDays: number;
  edge: string;
  deltaBytes: bigint;
  dedupKey: string;
  occurredAt: Date;
}

/**
 * Append-only store for boundary events (ADR-039). `append` is the fold
 * projector's write path: the event insert and the gauge increment happen in
 * ONE transaction — an event without its fold (or a fold without its event)
 * is exactly the drift class the audit exists to catch, so the repository
 * makes it unrepresentable. A replayed event (same dedup identity) applies
 * nothing and reports `applied: false`.
 */
export interface StorageBoundaryEventRepository {
  append(input: AppendBoundaryEventInput): Promise<{ applied: boolean }>;
  findAllByOrganization(params: {
    organizationId: string;
    /** Inclusive occurredAt upper bound — the fold-to-H replay cut. */
    upTo?: Date;
  }): Promise<StoredBoundaryEvent[]>;
}
