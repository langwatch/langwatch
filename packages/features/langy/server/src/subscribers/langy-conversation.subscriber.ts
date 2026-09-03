import {
  DispatchError,
  type EventSubscriberDefinition,
  type ProjectionCursor,
} from "@langwatch/eventing";
import {
  cursorHasReachedEvent,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
  LANGY_CONVERSATION_STATUS,
  type LangyCredentials,
  type LangyTurnAdmissionCapability,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { LangyConversationProcessingEvent } from "../adapters/eventing.langy.adapter";
import { LangyTurnErrors, LangyWorkerStoppedError } from "../adapters/langy.turn-errors.adapter";

const livenessLogger = createLogger("langwatch:langy:agent-turn-liveness-subscriber");
const broadcastLogger = createLogger("langwatch:langy:conversation-update-broadcast-subscriber");

export const LANGY_HEARTBEAT_GRACE_MS = 30_000;
const MAX_STALL_MS = LANGY_HEARTBEAT_GRACE_MS * 3;
const LIVENESS_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
] as const;

export interface LangyConversationLivenessRecord {
  cursor: ProjectionCursor;
  status: string;
  currentTurnId: string | null;
  lastActivityAtMs: number | null;
}
export interface LangyConversationLivenessReader {
  read(params: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationLivenessRecord | null>;
}
export interface LangyFailTurnCommandPort {
  failTurn(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    error: string;
  }): Promise<void>;
}
export interface LangyLivenessBufferPort {
  liveness(params: {
    conversationId: string;
    turnId: string;
    now: number;
    graceMs: number;
  }): Promise<{ stale: boolean }>;
  appendStatus(params: { conversationId: string; turnId: string; status: string }): Promise<void>;
  markError(params: { conversationId: string; turnId: string; error: string }): Promise<void>;
}
export interface LangyWorkerDispatchPort {
  dispatch(params: {
    intent: "create" | "revive" | "continue";
    conversationId: string;
    turnId: string;
    projectId: string;
    userId: string;
    runToken: string;
    prompt: string;
    system: string;
    historySeed?: string;
    credentials: LangyCredentials;
    modelOverride?: string;
    resumeToken?: string;
  }): Promise<unknown>;
}
export interface LangyTurnHandoffRecord {
  projectId: string;
  conversationId: string;
  turnId: string;
  actorUserId: string;
  prompt: string;
  system: string;
  historySeed?: string;
  modelOverride?: string;
  credentials: LangyCredentials;
  runToken: string;
  resumeToken?: string;
}
export interface LangyTurnHandoffReader {
  read(params: { conversationId: string; turnId: string }): Promise<LangyTurnHandoffRecord | null>;
}
export interface AgentTurnLivenessSubscriberDeps {
  buffer: LangyLivenessBufferPort;
  conversations: LangyConversationLivenessReader;
  failTurn: LangyFailTurnCommandPort;
  worker: LangyWorkerDispatchPort;
  handoffStore: LangyTurnHandoffReader;
  clock?: () => number;
}
export interface LangyConversationFreshnessRecord {
  cursor: ProjectionCursor;
  ownerUserId: string;
  isShared: boolean;
}
export interface LangyConversationFreshnessReader {
  read(params: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationFreshnessRecord | null>;
}
/**
 * The tenant-wide broadcast channel this feature publishes on.
 *
 * `eventType` is the single literal this feature ever fires, not an open
 * string. The host's broadcaster types it as a closed union and routes on it
 * (each type is its own Redis channel), so a port promising to pass any string
 * cannot be satisfied by the real service — a parameter position is
 * contravariant. Pinning the literal is also the ADR-046 contract: the signal
 * carries the conversation id and nothing else, and a second channel from here
 * would be a new decision rather than a wider type.
 */
export interface LangyBroadcastPort {
  broadcastToTenant(
    tenantId: string,
    payload: string,
    eventType: "langy_conversation_updated",
  ): Promise<void>;
}
export interface LangyConversationUpdateBroadcastSubscriberDeps {
  broadcast: LangyBroadcastPort;
  conversations: LangyConversationFreshnessReader;
}

function projectionNotReadyError(params: { projectionName: string; eventId: string }): Error {
  return new Error(`${params.projectionName} has not projected event ${params.eventId} yet`);
}
function turnIdOf(event: LangyConversationProcessingEvent): string | null {
  return "turnId" in event.data ? (event.data.turnId ?? null) : null;
}

export function createAgentTurnLivenessSubscriber(
  deps: AgentTurnLivenessSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  const clock = deps.clock ?? (() => Date.now());
  return {
    name: "agentTurnLiveness",
    eventTypes: LIVENESS_EVENT_TYPES,
    options: {
      delay: LANGY_HEARTBEAT_GRACE_MS,
      deduplication: {
        makeId: (event) =>
          `langy-liveness:${event.tenantId}:${String(event.aggregateId)}:${turnIdOf(event) ?? "?"}`,
        ttlMs: LANGY_HEARTBEAT_GRACE_MS * 2,
      },
    },
    async handle(event): Promise<void> {
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const eventTurnId = turnIdOf(event);
      if (!eventTurnId) return;
      const conversation = await deps.conversations.read({ projectId, conversationId });
      if (!conversation || !cursorHasReachedEvent(conversation.cursor, event)) {
        throw projectionNotReadyError({
          projectionName: "langyConversation",
          eventId: event.id,
        });
      }
      if (
        conversation.status !== LANGY_CONVERSATION_STATUS.RUNNING ||
        conversation.currentTurnId === null ||
        conversation.currentTurnId !== eventTurnId
      )
        return;
      const turnId = conversation.currentTurnId;
      const now = clock();
      const liveness = await deps.buffer.liveness({
        conversationId,
        turnId,
        now,
        graceMs: LANGY_HEARTBEAT_GRACE_MS,
      });
      if (!liveness.stale) {
        throw new DispatchError({
          message: `langy turn ${turnId} still live; re-checking liveness`,
          retryable: true,
          retryAfterMs: LANGY_HEARTBEAT_GRACE_MS,
        });
      }
      const stalledMs =
        conversation.lastActivityAtMs === null
          ? MAX_STALL_MS + 1
          : now - conversation.lastActivityAtMs;
      const candidateHandoff = await deps.handoffStore.read({ conversationId, turnId });
      const handoff =
        candidateHandoff?.projectId === projectId &&
        candidateHandoff.conversationId === conversationId &&
        candidateHandoff.turnId === turnId
          ? candidateHandoff
          : null;
      if (stalledMs > MAX_STALL_MS) {
        livenessLogger.warn(
          {
            projectId,
            conversationId,
            turnId,
            stalledMs,
            reason: "stall_expired",
            hasHandoff: handoff !== null,
          },
          "failing a stalled langy turn",
        );
        const error = LangyTurnErrors.serialize(new LangyWorkerStoppedError());
        await deps.buffer.markError({ conversationId, turnId, error }).catch(() => undefined);
        await deps.failTurn.failTurn({ projectId, conversationId, turnId, error });
        return;
      }
      if (!handoff) {
        throw new DispatchError({
          message: `langy turn ${turnId} has no handoff but is still active (${stalledMs}ms); re-checking liveness`,
          retryable: true,
          retryAfterMs: LANGY_HEARTBEAT_GRACE_MS,
        });
      }
      await deps.buffer
        .appendStatus({ conversationId, turnId, status: "Reconnecting to the agent…" })
        .catch(() => undefined);
      await deps.worker.dispatch({
        intent: handoff.resumeToken
          ? "revive"
          : handoff.credentials.langwatchApiKey
            ? "create"
            : "continue",
        conversationId,
        turnId,
        projectId,
        userId: handoff.actorUserId,
        runToken: handoff.runToken,
        prompt: handoff.prompt,
        system: handoff.system,
        ...(handoff.historySeed ? { historySeed: handoff.historySeed } : {}),
        credentials: handoff.credentials,
        ...(handoff.modelOverride ? { modelOverride: handoff.modelOverride } : {}),
        ...(handoff.resumeToken ? { resumeToken: handoff.resumeToken } : {}),
      });
      throw new DispatchError({
        message: `langy turn ${turnId} stalled (${stalledMs}ms); re-driven, awaiting liveness`,
        retryable: true,
      });
    },
  };
}

export function createLangyConversationUpdateBroadcastSubscriber(
  deps: LangyConversationUpdateBroadcastSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "langyConversationUpdateBroadcast",
    eventTypes: LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
    options: {
      deduplication: {
        makeId: (event) =>
          `langy-conversation-update:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: 15_000,
      },
    },
    async handle(event): Promise<void> {
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const record = await deps.conversations.read({ projectId, conversationId });
      if (!record || !cursorHasReachedEvent(record.cursor, event)) {
        throw projectionNotReadyError({
          projectionName: "langyConversation",
          eventId: event.id,
        });
      }
      try {
        await deps.broadcast.broadcastToTenant(
          projectId,
          JSON.stringify({
            event: "langy_conversation_updated",
            conversationId,
            cursor: record.cursor,
            ownerUserId: record.ownerUserId,
            isShared: record.isShared,
          }),
          "langy_conversation_updated",
        );
      } catch (error) {
        broadcastLogger.warn(
          { projectId, conversationId, error },
          "Failed to broadcast Langy conversation invalidation",
        );
      }
    },
  };
}

export function createLangyTurnAdmissionLifecycleSubscriber(deps: {
  admissions: Pick<LangyTurnAdmissionCapability, "confirmAccepted" | "release">;
}): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  const terminalEvents = [
    LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
    LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
    LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
  ] as const;
  return {
    name: "langyTurnAdmissionLifecycle",
    eventTypes: [LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED, ...terminalEvents],
    options: {
      deduplication: { makeId: (event) => `langy-turn-admission-lifecycle:${event.id}` },
    },
    async handle(event): Promise<void> {
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const turnId = "turnId" in event.data ? event.data.turnId : undefined;
      if (event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED) {
        await deps.admissions.confirmAccepted({
          projectId,
          conversationId,
          turnId: event.data.turnId,
        });
        return;
      }
      await deps.admissions.release({
        projectId,
        conversationId,
        ...(turnId ? { turnId } : {}),
      });
    },
  };
}
