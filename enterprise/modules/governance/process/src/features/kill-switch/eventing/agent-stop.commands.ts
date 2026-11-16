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
  agentStopTargetSettledEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import { defineCommand } from "@langwatch/eventing";

const stopAttributes = (data: { stopId: string }) => ({ "payload.stop_id": data.stopId });
const targetAttributes = (data: { stopId: string; targetId: string }) => ({
  "payload.stop_id": data.stopId,
  "payload.target_id": data.targetId,
});

/** A revert outcome carries its restore round, so each restore records its own. */
function revertKey({
  data,
  outcome,
}: {
  data: { stopId: string; targetId: string; restoreRound?: number | undefined };
  outcome: string;
}): string {
  return `${data.stopId}:${outcome}:${data.targetId}:${data.restoreRound ?? 1}`;
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
  idempotencyKey: (data) => `${data.stopId}:applied:${data.targetId}`,
  spanAttributes: targetAttributes,
  makeJobId: (data) => `${data.stopId}:applied:${data.targetId}`,
});

const RecordAgentStopTargetFailedCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.RECORD_TARGET_FAILED,
  eventType: AGENT_STOP_EVENT_TYPES.TARGET_FAILED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopTargetSettledEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => `${data.stopId}:failed:${data.targetId}`,
  spanAttributes: targetAttributes,
  makeJobId: (data) => `${data.stopId}:failed:${data.targetId}`,
});

const RequestAgentStopRestoreCommand = defineCommand({
  commandType: AGENT_STOP_COMMAND_TYPES.REQUEST_RESTORE,
  eventType: AGENT_STOP_EVENT_TYPES.RESTORE_REQUESTED,
  eventVersion: AGENT_STOP_EVENT_VERSION,
  aggregateType: AGENT_STOP_AGGREGATE_TYPE,
  schema: agentStopRestoreRequestedEventDataSchema,
  aggregateId: (data) => data.stopId,
  idempotencyKey: (data) => `${data.stopId}:restore:${data.restoreRound}`,
  spanAttributes: stopAttributes,
  makeJobId: (data) => `${data.stopId}:restore:${data.restoreRound}`,
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

export const AGENT_STOP_COMMANDS = {
  request: RequestAgentStopCommand,
  approve: ApproveAgentStopCommand,
  deny: DenyAgentStopCommand,
  recordTargetApplied: RecordAgentStopTargetAppliedCommand,
  recordTargetFailed: RecordAgentStopTargetFailedCommand,
  requestRestore: RequestAgentStopRestoreCommand,
  recordTargetReverted: RecordAgentStopTargetRevertedCommand,
  recordTargetRevertFailed: RecordAgentStopTargetRevertFailedCommand,
} as const;
export type AgentStopCommandName = keyof typeof AGENT_STOP_COMMANDS;
