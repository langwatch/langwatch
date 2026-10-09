/**
 * Eventing's tables as LWQL entries, plain data (Q205, 2026-10-06): analytics composes them into
 * its catalogue and decides who reads each view, so no access gate is declared here and eventing
 * never imports analytics. Spec: packages/eventing/specs/event-table-surfaces.feature.
 */

/**
 * Eventing's tables with their category (ET-2, Alex 2026-10-08): a module that meters, sizes or
 * retains storage builds its own map from this list and never names an event table itself.
 * `event-log` rows carry a per-row retention; `process-manager` rows are swept by eventing.
 */
export const EVENT_TABLES = [
  { table: "event_log", store: "clickhouse", category: "event-log" },
  { table: "ProcessManagerInstance", store: "postgres", category: "process-manager" },
  { table: "ProcessManagerInbox", store: "postgres", category: "process-manager" },
  { table: "ProcessManagerOutbox", store: "postgres", category: "process-manager" },
  { table: "ProcessManagerOutboxAttempt", store: "postgres", category: "process-manager" },
] as const;

export type EventTable = (typeof EVENT_TABLES)[number];
export type EventTableCategory = EventTable["category"];

/** A column exposed under its key: `source` absent reads the column of the same name. */
export type EventTableExposedColumn = Readonly<{
  source?: string;
  /** Captured content, which the project's data-privacy policy decides. */
  content?: "output";
}>;

/** A source column exposed nowhere, keyed by its own name, and why. */
export type EventTableOmittedColumn = Readonly<{ omitted: "secret" | "internal" }>;

/** One event table as one view. */
export type EventTableDeclaration = Readonly<{
  view: string;
  store: "clickhouse" | "postgres";
  sourceTable: string;
  /** The exposed column naming the owning project. */
  tenantColumn: string;
  columns: Readonly<Record<string, EventTableExposedColumn | EventTableOmittedColumn>>;
  /** The columns another view joins this one on. */
  joinKeys?: readonly string[];
  description?: string;
  grain?: string;
  timeColumn?: string;
  /** The column whose highest value wins among duplicate rows. */
  dedupVersionColumn?: string;
}>;

const SECRET = { omitted: "secret" } as const;
const INTERNAL_TENANT = { omitted: "internal" } as const;
const OUTPUT = { content: "output" } as const;

export const EVENT_TABLE_DECLARATIONS = [
  {
    view: "legacy_event_log",
    store: "clickhouse",
    sourceTable: "event_log",
    tenantColumn: "TenantId",
    joinKeys: ["TenantId", "AggregateId", "EventId"],
    description: "Legacy append-only event log, superseded by the canonical fact tables",
    grain: "one row per (AggregateType, AggregateId, IdempotencyKey)",
    timeColumn: "EventOccurredAt",
    dedupVersionColumn: "EventTimestamp",
    columns: {
      TenantId: {},
      IdempotencyKey: {},
      AggregateType: {},
      AggregateId: {},
      EventId: {},
      EventType: {},
      EventVersion: {},
      EventTimestamp: {},
      CreatedAt: {},
      EventPayload: OUTPUT,
      ProcessingTraceparent: OUTPUT,
      EventOccurredAt: {},
      _retention_days: {},
      _size_bytes: {},
    },
  },
  {
    view: "process_manager_inboxes",
    store: "postgres",
    sourceTable: "ProcessManagerInbox",
    tenantColumn: "TenantId",
    columns: {
      TenantId: { source: "projectId" },
      ProcessManagerInboxId: { source: "id" },
      ProcessName: { source: "processName" },
      processKey: SECRET,
      tenantId: INTERNAL_TENANT,
      SourceEventId: { source: "sourceEventId" },
      sourceEventKey: SECRET,
      ConsumedAt: { source: "consumedAt" },
    },
  },
  {
    view: "process_manager_instances",
    store: "postgres",
    sourceTable: "ProcessManagerInstance",
    tenantColumn: "TenantId",
    columns: {
      TenantId: { source: "projectId" },
      ProcessManagerInstanceId: { source: "id" },
      ProcessName: { source: "processName" },
      processKey: SECRET,
      tenantId: INTERNAL_TENANT,
      UserId: { source: "userId" },
      State: { source: "state", ...OUTPUT },
      Revision: { source: "revision" },
      NextWakeAt: { source: "nextWakeAt" },
      UpdatedAt: { source: "updatedAt" },
    },
  },
  {
    view: "process_manager_outbox_attempts",
    store: "postgres",
    sourceTable: "ProcessManagerOutboxAttempt",
    tenantColumn: "TenantId",
    description:
      "One row per failed outbox delivery attempt, so the table grows with delivery trouble rather than with traffic.",
    columns: {
      TenantId: { source: "projectId" },
      ProcessManagerOutboxAttemptId: { source: "id" },
      OutboxId: { source: "outboxId" },
      Attempt: { source: "attempt" },
      OccurredAt: { source: "occurredAt" },
      Outcome: { source: "outcome" },
      ErrorType: { source: "errorType" },
      ErrorMessage: { source: "errorMessage", ...OUTPUT },
      RetryAfterMs: { source: "retryAfterMs" },
    },
  },
  {
    view: "process_manager_outboxes",
    store: "postgres",
    sourceTable: "ProcessManagerOutbox",
    tenantColumn: "TenantId",
    columns: {
      TenantId: { source: "projectId" },
      ProcessManagerOutboxId: { source: "id" },
      ProcessName: { source: "processName" },
      processKey: SECRET,
      tenantId: INTERNAL_TENANT,
      UserId: { source: "userId" },
      messageKey: SECRET,
      IntentType: { source: "intentType" },
      Payload: { source: "payload", ...OUTPUT },
      TraceCarrier: { source: "traceCarrier", ...OUTPUT },
      SourceEventId: { source: "sourceEventId" },
      Status: { source: "status" },
      Attempts: { source: "attempts" },
      NextAttemptAt: { source: "nextAttemptAt" },
      LeasedUntil: { source: "leasedUntil" },
      leaseToken: SECRET,
      DispatchedAt: { source: "dispatchedAt" },
      CreatedAt: { source: "createdAt" },
      UpdatedAt: { source: "updatedAt" },
    },
  },
] as const satisfies readonly EventTableDeclaration[];
