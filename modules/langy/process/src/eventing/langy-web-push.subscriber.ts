/**
 * Langy's notifications leave from the server through Web Push: a long turn, a waiting card,
 * the `notify` tool; to the owner, when they turned notifications on.
 * @see specs/langy/langy-notifications.feature
 */
import {
  createTenantId,
  type EventSubscriberDefinition,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_NOTIFICATION_TOPIC,
  langyConversationPath,
  langyNotificationContent,
  langyNotificationTag,
  makeConversationTurnKey,
  type LangyConversationStateData,
  type LangyConversationTurnData,
  type LangyNotificationEvent,
} from "@langwatch/langy-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";

const logger = createLogger("langwatch:langy:web-push");

const NOTIFY_TOOL_NAME = "notify";

/** The folded conversation, as far as a notification reads it. */
export interface LangyWebPushConversationReader {
  /** Null until the conversation is folded. */
  find(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ ownerUserId: string | null; title: string | null } | null>;
}

/** When the turn began, from its folded document; null until it is folded. */
export type LangyTurnStartReader = (params: {
  projectId: string;
  conversationId: string;
  turnId: string;
}) => Promise<number | null>;

export interface LangyWebPushSubscriberDeps {
  conversations: LangyWebPushConversationReader;
  turnStartedAt: LangyTurnStartReader;
  users: Pick<UserApi, "getNotificationPreference">;
  projects: Pick<ProjectApi, "findSummaryById">;
  notifications: Pick<NotificationService, "requestWebPushDelivery">;
}

/** What an event is, before the turn length and the person's answer decide. */
type Candidate =
  | { kind: "turn_finished"; turnId: string }
  | { kind: "decision_needed" }
  | { kind: "tool"; title: string; body: string }
  | { kind: "not_a_candidate" };

const NOT_A_CANDIDATE = { kind: "not_a_candidate" } as const;

function notifyToolCandidate(toolName: string, input: unknown): Candidate {
  if (toolName !== NOTIFY_TOOL_NAME) return NOT_A_CANDIDATE;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return NOT_A_CANDIDATE;
  const { title, body } = input as { title?: unknown; body?: unknown };
  if (typeof title !== "string" || title.trim() === "") return NOT_A_CANDIDATE;
  return { kind: "tool", title, body: typeof body === "string" ? body : "" };
}

/** Which events can become a notification; everything else never reaches the queue. */
export function langyWebPushCandidate(event: LangyConversationProcessingEvent): Candidate {
  switch (event.type) {
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED:
      return event.data.outcome === "completed"
        ? { kind: "turn_finished", turnId: event.data.turnId }
        : NOT_A_CANDIDATE;
    case LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED:
      return { kind: "decision_needed" };
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED:
      return notifyToolCandidate(event.data.toolName, event.data.input);
    default:
      return NOT_A_CANDIDATE;
  }
}

export function createLangyWebPushSubscriber(
  deps: LangyWebPushSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "langyWebPush",
    eventTypes: [
      LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED,
      LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
    ],
    options: {
      deduplication: { makeId: (event) => `langy-web-push:${event.id}` },
      enqueue: {
        filter: (event) => langyWebPushCandidate(event).kind !== "not_a_candidate",
      },
    },
    handle: (event) => requestPush(deps, event),
  };
}

/**
 * Asks notification for the push an event is worth, keyed by the event so a redelivery asks
 * for the same push and notification queues it once.
 */
async function requestPush(
  deps: LangyWebPushSubscriberDeps,
  event: LangyConversationProcessingEvent,
): Promise<void> {
  const candidate = langyWebPushCandidate(event);
  if (candidate.kind === "not_a_candidate") return;
  const projectId = event.tenantId;
  const conversationId = String(event.aggregateId);

  const conversation = await deps.conversations.find({ projectId, conversationId });
  if (!conversation) {
    throw new Error(`langyConversation has not projected conversation ${conversationId} yet`);
  }
  const owner = conversation.ownerUserId;
  if (!owner) return;

  const notificationEvent = await toNotificationEvent(deps, candidate, {
    projectId,
    conversationId,
    occurredAt: event.occurredAt,
  });
  if (notificationEvent.kind === "not_a_candidate") return;
  const content = langyNotificationContent({
    event: notificationEvent,
    conversationTitle: conversation.title,
  });
  if (content.kind === "skip") return;

  const preference = await deps.users.getNotificationPreference({
    id: owner,
    topic: LANGY_NOTIFICATION_TOPIC,
  });
  if (preference.choice !== "enabled") return;

  const project = await deps.projects.findSummaryById(projectId);
  if (!project) return;

  const { queued } = await deps.notifications.requestWebPushDelivery({
    userId: owner,
    projectId,
    idempotencyKey: `langy:${event.id}`,
    topic: langyNotificationTag(conversationId),
    urgency: "high",
    message: {
      title: content.title,
      body: content.body,
      url: langyConversationPath({ projectSlug: project.slug, conversationId }),
      tag: langyNotificationTag(conversationId),
    },
  });
  if (queued > 0) {
    logger.debug({ conversationId, kind: candidate.kind, queued }, "Langy push queued");
  }
}

async function toNotificationEvent(
  deps: LangyWebPushSubscriberDeps,
  candidate: Exclude<Candidate, { kind: "not_a_candidate" }>,
  at: { projectId: string; conversationId: string; occurredAt: number },
): Promise<LangyNotificationEvent | { kind: "not_a_candidate" }> {
  if (candidate.kind !== "turn_finished") return candidate;
  const startedAt = await deps.turnStartedAt({
    projectId: at.projectId,
    conversationId: at.conversationId,
    turnId: candidate.turnId,
  });
  if (startedAt === null) return NOT_A_CANDIDATE;
  return { kind: "turn_finished", durationMs: at.occurredAt - startedAt };
}

/** The two readers over Langy's folded documents, keyed the way the projections write them. */
export function langyWebPushReaders(stores: {
  conversations: StateProjectionStore<LangyConversationStateData>;
  turns: StateProjectionStore<LangyConversationTurnData>;
}): Pick<LangyWebPushSubscriberDeps, "conversations" | "turnStartedAt"> {
  return {
    conversations: {
      async find({ projectId, conversationId }) {
        const read = await stores.conversations.get(conversationId, {
          tenantId: createTenantId(projectId),
          aggregateId: conversationId,
        });
        if (read.kind === "empty") return null;
        const { UserId, Title } = read.projection.state;
        return { ownerUserId: UserId || null, title: Title };
      },
    },
    async turnStartedAt({ projectId, conversationId, turnId }) {
      const read = await stores.turns.get(makeConversationTurnKey(conversationId, turnId), {
        tenantId: createTenantId(projectId),
        aggregateId: conversationId,
      });
      return read.kind === "empty" ? null : read.projection.state.StartedAt;
    },
  };
}
