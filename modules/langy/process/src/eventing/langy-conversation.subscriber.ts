import {
  DispatchError,
  type EventSubscriberDefinition,
  type ProjectionCursor,
} from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import {
  cursorHasReachedEvent,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
  LANGY_CONVERSATION_STATUS,
  type LangyCredentials,
  type LangyTurnAdmissionCapability,
  LangyTurnErrors,
  LangyWorkerStoppedError,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";

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
  /** Throws `langy_conversation_not_found` until the conversation is folded. */
  getById(params: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationLivenessRecord>;
}
export interface LangyFailTurnCommand {
  failTurn(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    error: string;
  }): Promise<void>;
}
interface LangyLivenessBuffer {
  liveness(params: {
    conversationId: string;
    turnId: string;
    now: number;
    graceMs: number;
  }): Promise<{ stale: boolean }>;
  appendStatus(params: { conversationId: string; turnId: string; status: string }): Promise<void>;
  markError(params: { conversationId: string; turnId: string; error: string }): Promise<void>;
}
interface LangyWorkerDispatch {
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
interface LangyTurnHandoffRecord {
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
type LangyTurnHandoffRecordLookup =
  | { kind: "hit"; handoff: LangyTurnHandoffRecord }
  | { kind: "miss" };
interface LangyTurnHandoffReader {
  read(params: { conversationId: string; turnId: string }): Promise<LangyTurnHandoffRecordLookup>;
}
export interface AgentTurnLivenessSubscriberDeps {
  buffer: LangyLivenessBuffer;
  conversations: LangyConversationLivenessReader;
  failTurn: LangyFailTurnCommand;
  worker: LangyWorkerDispatch;
  handoffStore: LangyTurnHandoffReader;
  clock?: () => number;
}
export interface LangyConversationFreshnessRecord {
  cursor: ProjectionCursor;
  ownerUserId: string;
  isShared: boolean;
}
export interface LangyConversationFreshnessReader {
  /** Throws `langy_conversation_not_found` until the conversation is folded. */
  getById(params: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationFreshnessRecord>;
}
/**
 * The tenant-wide broadcast channel this feature publishes on. `eventType` is the single literal
 * this feature ever fires, not an open string.
 * contravariant. Pinning the literal is also the ADR-046 contract: the signal
 */
export interface LangyConversationUpdateChannel {
  broadcastToTenant(
    tenantId: string,
    payload: string,
    eventType: "langy_conversation_updated",
  ): Promise<void>;
}
export interface LangyConversationUpdateBroadcastSubscriberDeps {
  broadcast: LangyConversationUpdateChannel;
  conversations: LangyConversationFreshnessReader;
}

function projectionNotReadyError(params: { projectionName: string; eventId: string }): Error {
  return new Error(`${params.projectionName} has not projected event ${params.eventId} yet`);
}
function extractTurnId(event: LangyConversationProcessingEvent): string | null {
  return "turnId" in event.data ? (event.data.turnId ?? null) : null;
}

export function createAgentTurnLivenessSubscriber(
  deps: AgentTurnLivenessSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  const clock = deps.clock ?? (() => nowInstant().epochMilliseconds);
  return {
    name: "agentTurnLiveness",
    eventTypes: LIVENESS_EVENT_TYPES,
    options: {
      delay: LANGY_HEARTBEAT_GRACE_MS,
      deduplication: {
        makeId: (event) =>
          `langy-liveness:${event.tenantId}:${String(event.aggregateId)}:${extractTurnId(event) ?? "?"}`,
        ttlMs: LANGY_HEARTBEAT_GRACE_MS * 2,
      },
    },
    async handle(event): Promise<void> {
      const [turn] = await findRunningTurn({ deps, event });
      if (!turn) return;
      const now = clock();
      const liveness = await deps.buffer.liveness({
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        now,
        graceMs: LANGY_HEARTBEAT_GRACE_MS,
      });
      if (!liveness.stale) {
        throw new DispatchError({
          message: `langy turn ${turn.turnId} still live; re-checking liveness`,
          retryable: true,
          retryAfterMs: LANGY_HEARTBEAT_GRACE_MS,
        });
      }
      const stalledMs =
        turn.lastActivityAtMs === null ? MAX_STALL_MS + 1 : now - turn.lastActivityAtMs;
      const [handoff] = await findMatchingHandoff({ deps, turn });
      if (stalledMs > MAX_STALL_MS) {
        await failStalledTurn({ deps, turn, stalledMs, hasHandoff: handoff !== undefined });
        return;
      }
      if (!handoff) {
        throw new DispatchError({
          message: `langy turn ${turn.turnId} has no handoff but is still active (${stalledMs}ms); re-checking liveness`,
          retryable: true,
          retryAfterMs: LANGY_HEARTBEAT_GRACE_MS,
        });
      }
      await redriveTurn({ deps, turn, handoff });
      throw new DispatchError({
        message: `langy turn ${turn.turnId} stalled (${stalledMs}ms); re-driven, awaiting liveness`,
        retryable: true,
      });
    },
  };
}

type LivenessTurn = {
  projectId: string;
  conversationId: string;
  turnId: string;
  lastActivityAtMs: number | null;
};

/** The turn the event names, when the folded conversation is still running exactly that turn. */
async function findRunningTurn({
  deps,
  event,
}: {
  deps: AgentTurnLivenessSubscriberDeps;
  event: LangyConversationProcessingEvent;
}): Promise<LivenessTurn[]> {
  const eventTurnId = extractTurnId(event);
  if (!eventTurnId) return [];
  const projectId = event.tenantId;
  const conversationId = String(event.aggregateId);
  const conversation = await getFoldedConversation({
    reader: deps.conversations,
    projectId,
    conversationId,
    event,
  });
  const running = conversation.status === LANGY_CONVERSATION_STATUS.RUNNING;
  if (!running || conversation.currentTurnId !== eventTurnId) return [];
  return [
    {
      projectId,
      conversationId,
      turnId: eventTurnId,
      lastActivityAtMs: conversation.lastActivityAtMs,
    },
  ];
}

/** The turn's parked handoff, only when it really is this turn's. */
async function findMatchingHandoff({
  deps,
  turn,
}: {
  deps: AgentTurnLivenessSubscriberDeps;
  turn: LivenessTurn;
}): Promise<LangyTurnHandoffRecord[]> {
  const lookup = await deps.handoffStore.read({
    conversationId: turn.conversationId,
    turnId: turn.turnId,
  });
  if (lookup.kind !== "hit") return [];
  const { handoff } = lookup;
  const same =
    handoff.projectId === turn.projectId &&
    handoff.conversationId === turn.conversationId &&
    handoff.turnId === turn.turnId;
  return same ? [handoff] : [];
}

/** A turn silent past the stall window is durably failed as a stopped worker. */
async function failStalledTurn({
  deps,
  turn,
  stalledMs,
  hasHandoff,
}: {
  deps: AgentTurnLivenessSubscriberDeps;
  turn: LivenessTurn;
  stalledMs: number;
  hasHandoff: boolean;
}): Promise<void> {
  const { projectId, conversationId, turnId } = turn;
  livenessLogger.warn(
    { projectId, conversationId, turnId, stalledMs, reason: "stall_expired", hasHandoff },
    "failing a stalled langy turn",
  );
  const error = LangyTurnErrors.serialize(new LangyWorkerStoppedError());
  await deps.buffer.markError({ conversationId, turnId, error }).catch(() => undefined);
  await deps.failTurn.failTurn({ projectId, conversationId, turnId, error });
}

/** Says it is reconnecting, then dispatches the parked handoff again. */
async function redriveTurn({
  deps,
  turn,
  handoff,
}: {
  deps: AgentTurnLivenessSubscriberDeps;
  turn: LivenessTurn;
  handoff: LangyTurnHandoffRecord;
}): Promise<void> {
  const { projectId, conversationId, turnId } = turn;
  await deps.buffer
    .appendStatus({ conversationId, turnId, status: "Reconnecting to the agent…" })
    .catch(() => undefined);
  await deps.worker.dispatch({
    intent: dispatchIntentOf({
      resumable: Boolean(handoff.resumeToken),
      hasApiKey: Boolean(handoff.credentials.langwatchApiKey),
    }),
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
      const record = await getFoldedConversation({
        reader: deps.conversations,
        projectId,
        conversationId,
        event,
      });
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

function dispatchIntentOf({
  resumable,
  hasApiKey,
}: {
  resumable: boolean;
  hasApiKey: boolean;
}): "create" | "revive" | "continue" {
  if (resumable) return "revive";
  return hasApiKey ? "create" : "continue";
}

/** The folded conversation once it has reached `event`; until then the delivery retries. */
async function getFoldedConversation<TRecord extends { cursor: ProjectionCursor }>({
  reader,
  projectId,
  conversationId,
  event,
}: {
  reader: { getById(params: { projectId: string; conversationId: string }): Promise<TRecord> };
  projectId: string;
  conversationId: string;
  event: LangyConversationProcessingEvent;
}): Promise<TRecord> {
  try {
    const record = await reader.getById({ projectId, conversationId });
    if (cursorHasReachedEvent(record.cursor, event)) return record;
  } catch (error) {
    if (!(HandledError.isHandled(error) && error.code === "langy_conversation_not_found"))
      throw error;
  }
  throw projectionNotReadyError({ projectionName: "langyConversation", eventId: event.id });
}
