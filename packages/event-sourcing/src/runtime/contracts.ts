import type { z } from "zod";
import type { GroupKey, Lane, Scope } from "../dispatch/groupKey.types";
import type {
  BuiltPipeline,
  HandlerContext,
  WireEvent,
} from "../pipeline/pipeline.types";
import type { Metrics } from "../ports/metrics";
import type { DispatchError } from "./dispatchError";

export type LaneKind = Lane["kind"];

/** An event after the command boundary. `payload` is serialised exactly once
 * and this same string reaches the log, the job body and replay (ADR-108 §7). */
export interface CommittedEvent {
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly idempotencyKey: string;
  readonly occurredAt: number;
  readonly payload: string;
  readonly traceparent?: string;
}

export interface EventLogScan {
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId?: string;
  readonly occurredFrom?: number;
  readonly occurredTo?: number;
  /**
   * Widens the store's fallback lower bound for a scan with no
   * `occurredFrom`. The store bounds such a scan at the default retention
   * window; a tenant with a longer configured retention passes it here, or
   * a replay misses their oldest live events.
   */
  readonly retentionDays?: number;
}

export interface EventLog {
  append(events: readonly CommittedEvent[]): Promise<void>;
  scan(query: EventLogScan): AsyncIterable<CommittedEvent>;
}

/** Everything the scheduler, the metrics and the parked-lane report read. The
 * body is never decoded to answer any of them (ADR-108 §6). */
export interface JobHeader {
  readonly tenantId: string;
  readonly lane: Lane;
  readonly scopeParts: readonly string[];
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly attempt: number;
  readonly costBytes: number;
  readonly blobRef?: string;
}

export interface Job {
  readonly header: JobHeader;
  readonly body: string;
}

export interface StagedJob {
  readonly descriptor: GroupKey;
  readonly orderingKey: number;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly costBytes: number;
  readonly body: string;
}

export interface Lease {
  readonly groupKey: string;
  readonly token: string;
}

export interface ClaimRequest {
  readonly maxJobs: number;
  readonly maxBytes: number;
  readonly leaseMs: number;
}

export interface ClaimedBatch {
  readonly lease: Lease;
  readonly lane: Lane;
  readonly tenantId: string;
  readonly jobs: readonly Job[];
}

export interface LaneQueue {
  stage(jobs: readonly StagedJob[]): Promise<void>;
  claim(request: ClaimRequest): Promise<ClaimedBatch | null>;
  settle(lease: Lease): Promise<void>;
  retry(lease: Lease, afterMs: number): Promise<void>;
  park(lease: Lease, reason: string): Promise<void>;
  depth(groupKey: string): Promise<number>;
}

export interface BlobSpool {
  put(tenantId: string, body: string): Promise<string>;
  get(ref: string): Promise<string | null>;
  release(ref: string): Promise<void>;
}

export interface ProcessInstanceKey {
  readonly processName: string;
  readonly projectId: string;
  readonly processKey: string;
}

export interface StoredProcessState {
  readonly state: unknown;
  readonly revision: number;
  readonly stateVersion: string;
  /** A woken instance builds its own context from this, so the port must carry
   * it — the deployed row stores one and `save` already accepts one. */
  readonly tenantId: string;
}

export interface DueProcessInstance extends ProcessInstanceKey {
  readonly tenantId: string;
  readonly nextWakeAt: number;
}

export interface ProcessStore {
  load(key: ProcessInstanceKey): Promise<StoredProcessState | null>;
  save(args: {
    readonly key: ProcessInstanceKey;
    readonly tenantId: string;
    readonly state: unknown;
    readonly stateVersion: string;
    readonly expectedRevision: number;
    readonly nextWakeAt: number | null;
  }): Promise<void>;
  due(now: number, limit: number): Promise<readonly DueProcessInstance[]>;
}

export interface OutboxRow {
  readonly id: string;
  readonly intentType: string;
  readonly messageKey: string;
  readonly tenantId: string;
  readonly payload: string;
  readonly attempt: number;
}

export interface Outbox {
  stage(rows: readonly Omit<OutboxRow, "id" | "attempt">[]): Promise<void>;
  claim(limit: number, leaseMs: number): Promise<readonly OutboxRow[]>;
  settle(id: string): Promise<void>;
  fail(id: string, retryable: boolean, afterMs: number): Promise<void>;
  prune(processName: string, before: number): Promise<number>;
}

export interface Clock {
  now(): number;
}

export interface EnginePorts {
  readonly eventLog: EventLog;
  readonly queue: LaneQueue;
  readonly spool: BlobSpool;
  readonly processStore: ProcessStore;
  readonly outbox: Outbox;
  readonly clock: Clock;
  readonly metrics?: Metrics;
  /** One predicate, consulted before a claim. Replaces the kill-switch
   * subsystem (ADR-108 §13). */
  readonly enabled?: (lane: Lane) => boolean;
}

export interface RegisteredPipeline {
  readonly pipeline: BuiltPipeline;
  readonly aggregateType: string;
}

export interface Registry {
  register(pipeline: BuiltPipeline): void;
  /** Every registered pipeline, which is also the introspection surface — there
   * is no separate introspection module (ADR-108 §1). */
  all(): readonly RegisteredPipeline[];
  commandNames(): readonly string[];
  findCommand(
    name: string,
  ): { readonly pipeline: BuiltPipeline; readonly command: string } | null;
  subscribersFor(
    eventType: string,
  ): readonly { readonly pipeline: BuiltPipeline; readonly name: string }[];
  foldsFor(
    eventType: string,
  ): readonly { readonly pipeline: BuiltPipeline; readonly name: string }[];
  mapsFor(
    eventType: string,
  ): readonly { readonly pipeline: BuiltPipeline; readonly name: string }[];
  processManagersFor(
    eventType: string,
  ): readonly { readonly pipeline: BuiltPipeline; readonly name: string }[];
  assertResolvable(): void;
}

export interface DispatchResult {
  readonly events: readonly CommittedEvent[];
}

export interface CommandClient {
  send(
    name: string,
    input: unknown,
    ctx: { readonly tenantId: string },
  ): Promise<DispatchResult>;
}

export interface EventProducer {
  /** Appends to the log, then stages a job per subscribed member. Fan-out
   * failure never fails a committed write (ADR-107 §15). */
  publish(events: readonly CommittedEvent[]): Promise<void>;
}

export interface ConsumerBudget {
  readonly maxJobs: number;
  readonly maxBytes: number;
  readonly maxInFlight: number;
  readonly leaseMs: number;
  readonly parkAfterFailures: number;
  readonly tenantSoftCap: number;
}

export interface LaneConsumer {
  start(): void;
  stop(): Promise<void>;
}

export interface ReplayRequest {
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId?: string;
  readonly occurredFrom?: number;
  readonly occurredTo?: number;
  readonly projections?: readonly string[];
}

export interface ReplayReport {
  readonly events: number;
  readonly applied: number;
  readonly skippedByVersion: number;
}

export interface EventSourcingService {
  register(pipeline: BuiltPipeline): void;
  readonly commands: CommandClient;
  start(args: { readonly runsConsumers: boolean }): Promise<void>;
  stop(): Promise<void>;
  replay(request: ReplayRequest): Promise<ReplayReport>;
}

export type {
  BuiltPipeline,
  DispatchError,
  GroupKey,
  HandlerContext,
  Lane,
  Metrics,
  Scope,
  WireEvent,
  z,
};
