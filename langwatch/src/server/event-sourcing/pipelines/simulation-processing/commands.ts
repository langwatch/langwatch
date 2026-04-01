import { defineCommand } from "../../commands/defineCommand";
import {
  simulationRunQueuedEventDataSchema,
  simulationRunStartedEventDataSchema,
  simulationMessageSnapshotEventDataSchema,
  simulationRunFinishedEventDataSchema,
  simulationTextMessageStartEventDataSchema,
  simulationTextMessageEndEventDataSchema,
  simulationRunDeletedEventDataSchema,
} from "./schemas/events";

/**
 * All pure simulation-processing commands defined from event data schemas.
 *
 * computeRunMetrics is NOT here — it's a complex command with DI (TraceSummaryStore,
 * scheduleRetry) and stays as a manual class.
 */

export const QueueRunCommand = defineCommand({
  commandType: "lw.simulation_run.queue",
  eventType: "lw.simulation_run.queued",
  eventVersion: "2026-03-08",
  aggregateType: "simulation_run",
  schema: simulationRunQueuedEventDataSchema,
  aggregateId: (d) => d.scenarioRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.scenarioRunId}:queueRun`,
  spanAttributes: (d) => ({
    "payload.scenarioRun.id": d.scenarioRunId,
    "payload.scenario.id": d.scenarioId,
    "payload.batchRun.id": d.batchRunId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.scenarioRunId}:queue-run`,
});

export const StartRunCommand = defineCommand({
  commandType: "lw.simulation_run.start",
  eventType: "lw.simulation_run.started",
  eventVersion: "2026-02-01",
  aggregateType: "simulation_run",
  schema: simulationRunStartedEventDataSchema,
  aggregateId: (d) => d.scenarioRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.scenarioRunId}:startRun`,
  spanAttributes: (d) => ({
    "payload.scenarioRun.id": d.scenarioRunId,
    "payload.scenario.id": d.scenarioId,
    "payload.batchRun.id": d.batchRunId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.scenarioRunId}:start-run`,
});

export const MessageSnapshotCommand = defineCommand({
  commandType: "lw.simulation_run.message_snapshot",
  eventType: "lw.simulation_run.message_snapshot",
  eventVersion: "2026-02-01",
  aggregateType: "simulation_run",
  schema: simulationMessageSnapshotEventDataSchema,
  aggregateId: (d) => d.scenarioRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.scenarioRunId}:messageSnapshot:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.scenarioRun.id": d.scenarioRunId,
    "payload.messages.count": d.messages.length,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.scenarioRunId}:message-snapshot`,
});

export const TextMessageStartCommand = defineCommand({
  commandType: "lw.simulation_run.text_message_start",
  eventType: "lw.simulation_run.text_message_start",
  eventVersion: "2026-02-01",
  aggregateType: "simulation_run",
  schema: simulationTextMessageStartEventDataSchema,
  aggregateId: (d) => d.scenarioRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.scenarioRunId}:textMessageStart:${d.messageId}`,
  spanAttributes: (d) => ({
    "payload.scenarioRun.id": d.scenarioRunId,
    "payload.message.id": d.messageId,
    "payload.role": d.role,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.scenarioRunId}:text-message-start:${d.messageId}`,
});

export const TextMessageEndCommand = defineCommand({
  commandType: "lw.simulation_run.text_message_end",
  eventType: "lw.simulation_run.text_message_end",
  eventVersion: "2026-02-01",
  aggregateType: "simulation_run",
  schema: simulationTextMessageEndEventDataSchema,
  aggregateId: (d) => d.scenarioRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.scenarioRunId}:textMessageEnd:${d.messageId}`,
  spanAttributes: (d) => ({
    "payload.scenarioRun.id": d.scenarioRunId,
    "payload.message.id": d.messageId,
    "payload.role": d.role,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.scenarioRunId}:text-message-end:${d.messageId}`,
});

export const FinishRunCommand = defineCommand({
  commandType: "lw.simulation_run.finish",
  eventType: "lw.simulation_run.finished",
  eventVersion: "2026-02-01",
  aggregateType: "simulation_run",
  schema: simulationRunFinishedEventDataSchema,
  aggregateId: (d) => d.scenarioRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.scenarioRunId}:finishRun`,
  spanAttributes: (d) => ({
    "payload.scenarioRun.id": d.scenarioRunId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.scenarioRunId}:finish-run`,
});

export const DeleteRunCommand = defineCommand({
  commandType: "lw.simulation_run.delete",
  eventType: "lw.simulation_run.deleted",
  eventVersion: "2026-02-01",
  aggregateType: "simulation_run",
  schema: simulationRunDeletedEventDataSchema,
  aggregateId: (d) => d.scenarioRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.scenarioRunId}:deleteRun`,
  spanAttributes: (d) => ({
    "payload.scenarioRun.id": d.scenarioRunId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.scenarioRunId}:delete-run`,
});
