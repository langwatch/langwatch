// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  AGENT_STOP_EVENT_TYPES,
  agentStopDecidedEventDataSchema,
  agentStopRequestedEventDataSchema,
  agentStopRestoreRequestedEventDataSchema,
  agentStopTargetSettledEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import type { Event, StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";

import {
  type AgentStopRecord,
  approvedStop,
  deniedStop,
  requestedStop,
  restoreRequestedStop,
  targetAppliedStop,
  targetFailedStop,
  targetRevertedStop,
  targetRevertFailedStop,
} from "../rules/agent-stop.rules.ts";

const AGENT_STOP_PROJECTION_NAME = "agentStop" as const;
const AGENT_STOP_PROJECTION_VERSION = "2026-11-16" as const;

/** Null until the stop's request is folded; the store writes nothing for it. */
export type AgentStopProjectionState = AgentStopRecord | null;

/** Folds one event onto the stop; the process manager folds the same way. */
export function foldAgentStop({
  stop,
  type,
  data,
  at,
}: {
  stop: AgentStopProjectionState;
  type: string;
  data: unknown;
  at: number;
}): AgentStopProjectionState {
  if (type === AGENT_STOP_EVENT_TYPES.REQUESTED) {
    return stop ?? requestedStop({ data: agentStopRequestedEventDataSchema.parse(data), at });
  }
  if (!stop) return stop;
  switch (type) {
    case AGENT_STOP_EVENT_TYPES.APPROVED:
      return approvedStop({ stop, data: agentStopDecidedEventDataSchema.parse(data), at });
    case AGENT_STOP_EVENT_TYPES.DENIED:
      return deniedStop({ stop, data: agentStopDecidedEventDataSchema.parse(data), at });
    case AGENT_STOP_EVENT_TYPES.TARGET_APPLIED:
      return targetAppliedStop({
        stop,
        data: agentStopTargetSettledEventDataSchema.parse(data),
        at,
      });
    case AGENT_STOP_EVENT_TYPES.TARGET_FAILED:
      return targetFailedStop({
        stop,
        data: agentStopTargetSettledEventDataSchema.parse(data),
        at,
      });
    case AGENT_STOP_EVENT_TYPES.RESTORE_REQUESTED:
      return restoreRequestedStop({
        stop,
        data: agentStopRestoreRequestedEventDataSchema.parse(data),
        at,
      });
    case AGENT_STOP_EVENT_TYPES.TARGET_REVERTED:
      return targetRevertedStop({
        stop,
        data: agentStopTargetSettledEventDataSchema.parse(data),
        at,
      });
    case AGENT_STOP_EVENT_TYPES.TARGET_REVERT_FAILED:
      return targetRevertFailedStop({
        stop,
        data: agentStopTargetSettledEventDataSchema.parse(data),
        at,
      });
    default:
      return stop;
  }
}

/**
 * The AgentStop row: the stop's status and every target's outcome. The executor skips an event
 * at or before the row's cursor (`lastAppliedEventId`), so a redelivery folds once.
 */
export function agentStopProjection(
  store: StateProjectionStore<AgentStopProjectionState>,
): StateProjectionDefinition<AgentStopProjectionState, Event> {
  return {
    name: AGENT_STOP_PROJECTION_NAME,
    version: AGENT_STOP_PROJECTION_VERSION,
    eventTypes: Object.values(AGENT_STOP_EVENT_TYPES),
    init: () => null,
    apply: (stop, event) =>
      foldAgentStop({ stop, type: event.type, data: event.data, at: event.occurredAt }),
    store,
  };
}
