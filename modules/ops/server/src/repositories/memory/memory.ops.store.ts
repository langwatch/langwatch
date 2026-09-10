import {
  IDLE_STATUS,
  type Anomaly,
  type BugReport,
  type ProcessAuditEntryView,
  type ReplayHistoryEntry,
  type SchedulerAuditEntryView,
  type ReplayStatus,
} from "@langwatch/ops-contract";

/** One event as the in-memory event log keeps it, with the columns the explorer reads by. */
export interface MemoryEventRow {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  payload: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  occurredAtMs: number;
}

/** One outbox message as the in-memory process store keeps it. */
export interface MemoryOutboxRow {
  id: string;
  messageKey: string;
  intentType: string;
  status: "pending" | "dispatched" | "dead" | "discarded";
  attempts: number;
  nextAttemptAt: number;
  leasedUntil: number | null;
  createdAt: number;
  updatedAt: number;
  sourceEventId: string | null;
  traceId: string | null;
  payload: unknown;
  processName: string;
  projectId: string;
  processKey: string;
}

/** One process-manager instance as the in-memory process store keeps it. */
export interface MemoryProcessInstanceRow {
  processName: string;
  projectId: string;
  processKey: string;
  tenantId: string;
  revision: number;
  nextWakeAt: number | null;
  updatedAt: number;
}

/**
 * The rows every memory repository in this module reads and writes.
 *
 * One store per composed process, handed to each twin, so a report filed
 * through one repository is the report another one lists.
 */
export class MemoryOpsStore {
  readonly bugReports: BugReport[] = [];
  readonly events: MemoryEventRow[] = [];
  readonly processInstances: MemoryProcessInstanceRow[] = [];
  readonly outbox: MemoryOutboxRow[] = [];
  readonly replayHistory: ReplayHistoryEntry[] = [];
  /** Active anomalies, keyed `<kind>:<tenantId>` as the stored hash keys them. */
  readonly anomalies = new Map<string, Anomaly>();
  /** Per tenant, the ingest count for each epoch minute. */
  readonly tenantRateMinutes = new Map<string, Map<number, number>>();
  readonly rateBaselines = new Map<string, number>();
  /** The operator trails, newest act last. */
  readonly processAudit: ProcessAuditEntryView[] = [];
  readonly schedulerAudit: SchedulerAuditEntryView[] = [];
  replayStatus: ReplayStatus = { ...IDLE_STATUS };
  replayLockHolder: string | null = null;
  replayCancelled = false;

  static create(): MemoryOpsStore {
    return new MemoryOpsStore();
  }

  private constructor() {}
}
