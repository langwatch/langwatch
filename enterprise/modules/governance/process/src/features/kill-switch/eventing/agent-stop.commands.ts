// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The `agent_stop` aggregate's commands: one aggregate per stop, the organisation its tenant. Each
 * idempotency key names the stop and, for an outcome, its target, so a redelivery records once.
 */
import {
  AGENT_STOP_AGGREGATE_TYPE,
  AGENT_STOP_COMMAND_TYPES,
  AGENT_STOP_EVENT_TYPES,
  AGENT_STOP_EVENT_VERSION,
  agentStopDecidedEventDataSchema,
  agentStopRequestedEventDataSchema,
  agentStopRestoreRequestedEventDataSchema,
  agentStopRetryRequestedEventDataSchema,
  agentStopTargetSettledEventDataSchema,
  agentStopTargetsDroppedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import { defineCommand } from "@langwatch/eventing";

const stopAttributes = (data: { stopId: string }) => ({ "payload.stop_id": data.stopId });
const targetAttributes = (data: { stopId: string; targetId: string }) => ({
  "payload.stop_id": data.stopId,
  "payload.target_id": data.targetId,
});

/** A revert outcome carries its restore round or its drop, so each restore and drop records its own. */
function revertKey({
  data,
  outcome,
}: {
  data: {
    stopId: string;
    targetId: string;
    restoreRound?: number | undefined;
    dropId?: string | undefined;
  };
  outcome: string;
}): string {
  const key = `${data.stopId}:${outcome}:${data.targetId}`;
  return data.dropId ? `${key}:drop:${data.dropId}` : `${key}:${data.restoreRound ?? 1}`;
}

/** An apply outcome carries its retry round once the stop was retried, so each run records its own. */
function applyKey({
  data,
  outcome,
}: {
  data: { stopId: string; targetId: string; retryRound?: number | undefined };
  outcome: string;
}): string {
  const key = `${data.stopId}:${outcome}:${data.targetId}`;
  return data.retryRound ? `${key}:retry:${data.retryRound}` : key;
}

const RequestAgentStopCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.REQUEST,
  eventType: AGENT_STOP_EVENT_TYPES.REQUESTED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopRequestedEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => `${data.stopId}:requested`,
  spanAttributes: (data) => ({ ...stopAttributes(data), "payload.agent_id": data.agentId }),
  makeJobId: (data) => `${data.stopId}:requested`,
});

const ApproveAgentStopCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.APPROVE,
  eventType: AGENT_STOP_EVENT_TYPES.APPROVED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopDecidedEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => `${data.stopId}:approved`,
  spanAttributes: stopAttributes,
  makeJobId: (data) => `${data.stopId}:approved`,
});

const DenyAgentStopCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.DENY,
  eventType: AGENT_STOP_EVENT_TYPES.DENIED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopDecidedEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => `${data.stopId}:denied`,
  spanAttributes: stopAttributes,
  makeJobId: (data) => `${data.stopId}:denied`,
});

const RecordAgentStopTargetAppliedCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.RECORD_TARGET_APPLIED,
  eventType: AGENT_STOP_EVENT_TYPES.TARGET_APPLIED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopTargetSettledEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => applyKey({ data, outcome: "applied" }),
  spanAttributes: targetAttributes,
  makeJobId: (data) => applyKey({ data, outcome: "applied" }),
});

const RecordAgentStopTargetFailedCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.RECORD_TARGET_FAILED,
  eventType: AGENT_STOP_EVENT_TYPES.TARGET_FAILED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopTargetSettledEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => applyKey({ data, outcome: "failed" }),
  spanAttributes: targetAttributes,
  makeJobId: (data) => applyKey({ data, outcome: "failed" }),
});

const RequestAgentStopRestoreCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.REQUEST_RESTORE,
  eventType: AGENT_STOP_EVENT_TYPES.RESTORE_REQUESTED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopRestoreRequestedEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => `${data.stopId}:restore:${data.requestId}`,
  spanAttributes: stopAttributes,
  makeJobId: (data) => `${data.stopId}:restore:${data.requestId}`,
});

const RecordAgentStopTargetRevertedCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.RECORD_TARGET_REVERTED,
  eventType: AGENT_STOP_EVENT_TYPES.TARGET_REVERTED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopTargetSettledEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => revertKey({ data, outcome: "reverted" }),
  spanAttributes: targetAttributes,
  makeJobId: (data) => revertKey({ data, outcome: "reverted" }),
});

const RecordAgentStopTargetRevertFailedCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.RECORD_TARGET_REVERT_FAILED,
  eventType: AGENT_STOP_EVENT_TYPES.TARGET_REVERT_FAILED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopTargetSettledEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => revertKey({ data, outcome: "revert_failed" }),
  spanAttributes: targetAttributes,
  makeJobId: (data) => revertKey({ data, outcome: "revert_failed" }),
});

const RetryAgentStopCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.RETRY,
  eventType: AGENT_STOP_EVENT_TYPES.RETRY_REQUESTED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopRetryRequestedEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => `${data.stopId}:retry:${data.requestId}`,
  spanAttributes: stopAttributes,
  makeJobId: (data) => `${data.stopId}:retry:${data.requestId}`,
});

const DropAgentStopTargetsCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.DROP_TARGETS,
  eventType: AGENT_STOP_EVENT_TYPES.TARGETS_DROPPED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopTargetsDroppedEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => `${data.stopId}:drop:${data.dropId}`,
  spanAttributes: stopAttributes,
  makeJobId: (data) => `${data.stopId}:drop:${data.dropId}`,
});

export const AGENT_STOP_COMMANDS = {
  request: RequestAgentStopCommand,
  approve: ApproveAgentStopCommand,
  deny: DenyAgentStopCommand,
  recordTargetApplied: RecordAgentStopTargetAppliedCommand,
  recordTargetFailed: RecordAgentStopTargetFailedCommand,
  requestRestore: RequestAgentStopRestoreCommand,
  recordTargetReverted: RecordAgentStopTargetRevertedCommand,
  recordTargetRevertFailed: RecordAgentStopTargetRevertFailedCommand,
  retry: RetryAgentStopCommand,
  dropTargets: DropAgentStopTargetsCommand,
} as const;
export type AgentStopCommandName = keyof typeof AGENT_STOP_COMMANDS;
