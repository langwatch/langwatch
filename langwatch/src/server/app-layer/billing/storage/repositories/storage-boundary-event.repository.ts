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
export interface NonExitGroupSum {
  category: string;
  retentionDays: number;
  /** Net of all non-EXIT events (entries, seeds, corrections), signed. */
  totalBytes: bigint;
}

/**
 * The net of ALL recorded events (exits included) for one slice-group — the
 * bytes the gauge currently carries for it. A fully exited, fully reversed,
 * or fully deleted group nets to zero and needs no further action; a nonzero
 * net is exactly what a due exit mirrors (negated), what a deletion negates,
 * and what a retention change re-books.
 */
export interface LiveNetGroup {
  projectId: string;
  category: string;
  partitionKey: string;
  sliceDate: Date;
  retentionDays: number;
  netBytes: bigint;
}

export interface StorageBoundaryEventRepository {
  append(input: AppendBoundaryEventInput): Promise<{ applied: boolean }>;
  findAllByOrganization(params: {
    organizationId: string;
    /** Inclusive occurredAt upper bound — the fold-to-H replay cut. */
    upTo?: Date;
  }): Promise<StoredBoundaryEvent[]>;
  /**
   * Net recorded non-EXIT bytes per (category, retentionDays) for one
   * project-partition — the "prior" side of the entry edge's
   * cumulative-minus-prior delta.
   */
  sumNonExitByPartition(params: {
    organizationId: string;
    projectId: string;
    partitionKey: string;
  }): Promise<NonExitGroupSum[]>;
  /**
   * Event log + gauge row read in ONE transaction snapshot — the fold
   * audit's read. Two independent reads can be torn by a concurrent append
   * (event visible, increment not, or vice versa) into a phantom alarm.
   */
  snapshotFoldState(params: { organizationId: string }): Promise<{
    events: StoredBoundaryEvent[];
    gaugeBytes: bigint;
  }>;
  /** Events effective strictly after `after` — the steady-state sampling fast path's guard. */
  countEventsAfter(params: {
    organizationId: string;
    after: Date;
  }): Promise<number>;
  /** Live net per slice-group (see LiveNetGroup), optionally scoped to a project. */
  sumLiveNetGroups(params: {
    organizationId: string;
    projectId?: string;
  }): Promise<LiveNetGroup[]>;
}
