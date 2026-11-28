// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  AGENT_STOP_EVENT_TYPES,
  agentStopDecidedEventDataSchema,
  agentStopRequestedEventDataSchema,
  agentStopRestoreRequestedEventDataSchema,
  agentStopRetryRequestedEventDataSchema,
  agentStopTargetSettledEventDataSchema,
  agentStopTargetsDroppedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import type { Event, StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";

import {
  AGENT_STOP_PROJECTION_VERSION,
  type AgentStopRecord,
  approvedStop,
  deniedStop,
  foldRequestOnce,
  requestedStop,
  restoreRequestedStop,
  retriedStop,
  targetAppliedStop,
  targetFailedStop,
  targetRevertedStop,
  targetRevertFailedStop,
  targetsDroppedStop,
} from "../rules/agent-stop.rules.ts";

const AGENT_STOP_PROJECTION_NAME = "agentStop" as const;

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
    case AGENT_STOP_EVENT_TYPES.DENIED: {
      const decision = agentStopDecidedEventDataSchema.parse(data);
      const decide = type === AGENT_STOP_EVENT_TYPES.APPROVED ? approvedStop : deniedStop;
      const fold = (held: AgentStopRecord) => decide({ stop: held, data: decision, at });
      if (decision.requestId === undefined) return fold(stop);
      return foldRequestOnce({ stop, requestId: decision.requestId, fold });
    }
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
    case AGENT_STOP_EVENT_TYPES.RESTORE_REQUESTED: {
      const restore = agentStopRestoreRequestedEventDataSchema.parse(data);
      return foldRequestOnce({
        stop,
        requestId: restore.requestId,
        fold: (held) => restoreRequestedStop({ stop: held, data: restore, at }),
      });
    }
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
    case AGENT_STOP_EVENT_TYPES.RETRY_REQUESTED: {
      const retry = agentStopRetryRequestedEventDataSchema.parse(data);
      return foldRequestOnce({
        stop,
        requestId: retry.requestId,
        fold: (held) => retriedStop({ stop: held, data: retry, at }),
      });
    }
    case AGENT_STOP_EVENT_TYPES.TARGETS_DROPPED: {
      const drop = agentStopTargetsDroppedEventDataSchema.parse(data);
      return foldRequestOnce({
        stop,
        requestId: drop.dropId,
        fold: (held) => targetsDroppedStop({ stop: held, data: drop, at }),
      });
    }
    default:
      return stop;
  }
}

/**
 * The AgentStop row: the stop's status and every target's outcome. The executor skips an event
 * at or before the row's cursor (`lastAppliedEventId`), so a redelivery folds once; a request
 * the API already advanced the row by folds once through `advancedRequestIds`.
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
