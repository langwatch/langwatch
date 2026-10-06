import {
  IDLE_STATUS,
  type AdminOperationInput,
  type Anomaly,
  type BugReport,
  type DetailSnapshot,
  type LiveSnapshot,
  type ProcessAuditEntryView,
  type ReplayHistoryEntry,
  type SchedulerAuditEntryView,
  type ReplayStatus,
} from "@langwatch/ops-contract";

import type { ImpersonationTarget } from "../impersonation.repository.ts";
import type { StorageStatsReading } from "../storage-stats-readings.repository.ts";

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
interface MemoryProcessInstanceRow {
  processName: string;
  projectId: string;
  processKey: string;
  tenantId: string;
  revision: number;
  nextWakeAt: number | null;
  updatedAt: number;
}

/**
 * The rows every memory repository in this module reads and writes. One
 * store per composed process, handed to each twin, so a report filed
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
  /** Per ClickHouse endpoint, the last storage reading and the last backup it saw. */
  readonly storageReadings = new Map<string, Omit<StorageStatsReading, "lastBackup">>();
  readonly storageLastBackups = new Map<string, NonNullable<StorageStatsReading["lastBackup"]>>();
  /** The operator trails, newest act last. */
  readonly processAudit: ProcessAuditEntryView[] = [];
  readonly schedulerAudit: SchedulerAuditEntryView[] = [];
  /** The published snapshots and the writer lease over them; a lease here never lapses. */
  readonly snapshots: {
    live?: LiveSnapshot;
    detail?: DetailSnapshot;
    leaseToken?: string;
    epoch: number;
  } = { epoch: 0 };
  /** The collector's persisted metrics window, and when each pipeline path was last seen. */
  metricsState: string | undefined = undefined;
  readonly knownPipelinePaths = new Map<string, number>();
  /** The instance admin's rows, per resource, keyed by id. */
  readonly adminRows = new Map<
    AdminOperationInput["resource"],
    Map<string, Record<string, unknown>>
  >();
  /** Who may be impersonated and who holds a second factor. */
  readonly impersonationTargets = new Map<string, ImpersonationTarget>();
  readonly secondFactorUserIds = new Set<string>();
  replayStatus: ReplayStatus = { ...IDLE_STATUS };
  replayLockHolder: string | null = null;
  replayCancelled = false;

  static create(): MemoryOpsStore {
    return new MemoryOpsStore();
  }

  private constructor() {}
}
