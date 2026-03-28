import { defineCommand } from "../../commands/defineCommand";
import {
  suiteRunStartedEventDataSchema,
  suiteRunItemStartedEventDataSchema,
  suiteRunItemCompletedEventDataSchema,
} from "./schemas/events";

/**
 * All suite-run-processing commands defined from event data schemas.
 *
 * Event data schemas (in events.ts) are the single source of truth.
 * Command data = envelope (tenantId, occurredAt, idempotencyKey?) + event data.
 * The handle() method strips envelope fields and creates an event.
 */

export const StartSuiteRunCommand = defineCommand({
  commandType: "lw.suite_run.start" as const,
  eventType: "lw.suite_run.started" as const,
  eventVersion: "2026-03-01",
  aggregateType: "suite_run",
  schema: suiteRunStartedEventDataSchema,
  aggregateId: (d) => d.batchRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.batchRunId}:${d.idempotencyKey}`,
  spanAttributes: (d) => ({
    "payload.batchRun.id": d.batchRunId,
    "payload.suite.id": d.suiteId,
    "payload.total": d.total,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.batchRunId}:${d.idempotencyKey}`,
});

export const RecordSuiteRunItemStartedCommand = defineCommand({
  commandType: "lw.suite_run.record_item_started" as const,
  eventType: "lw.suite_run.item_started" as const,
  eventVersion: "2026-03-01",
  aggregateType: "suite_run",
  schema: suiteRunItemStartedEventDataSchema,
  aggregateId: (d) => d.batchRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.batchRunId}:${d.scenarioRunId}:itemStarted`,
  spanAttributes: (d) => ({
    "payload.batchRun.id": d.batchRunId,
    "payload.scenarioRun.id": d.scenarioRunId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.batchRunId}:${d.scenarioRunId}:itemStarted`,
});

export const CompleteSuiteRunItemCommand = defineCommand({
  commandType: "lw.suite_run.complete_item" as const,
  eventType: "lw.suite_run.item_completed" as const,
  eventVersion: "2026-03-01",
  aggregateType: "suite_run",
  schema: suiteRunItemCompletedEventDataSchema,
  aggregateId: (d) => d.batchRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.batchRunId}:${d.scenarioRunId}:itemCompleted`,
  spanAttributes: (d) => ({
    "payload.batchRun.id": d.batchRunId,
    "payload.scenarioRun.id": d.scenarioRunId,
    "payload.status": d.status,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.batchRunId}:${d.scenarioRunId}:itemCompleted`,
});
