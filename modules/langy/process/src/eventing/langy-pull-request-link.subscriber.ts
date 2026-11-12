/**
 * Links each pull request a turn opened to its conversation, so CI on it can wake Langy there,
 * and starts the follow-up count again when a turn the person sent completes.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import { DispatchError, type EventSubscriberDefinition } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { LangyPullRequestLinkRepository } from "../repositories/langy-pull-request-link.repository.ts";
import { pullRequestsOpenedIn } from "../rules/langy-ci-follow-up.rules.ts";
import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";

interface LangyConversationOwnerReader {
  /** Throws `langy_conversation_not_found` until the conversation is folded. */
  getById(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ ownerUserId: string | null }>;
}

export interface LangyPullRequestLinkSubscriberDeps {
  links: Pick<LangyPullRequestLinkRepository, "link" | "isFollowUpTurn" | "resetFollowUps">;
  conversations: LangyConversationOwnerReader;
  projects: Pick<ProjectApi, "findIdentity">;
}

export function createLangyPullRequestLinkSubscriber(
  deps: LangyPullRequestLinkSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "langyPullRequestLink",
    eventTypes: [LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED],
    options: {
      deduplication: { makeId: (event) => `langy-pull-request-link:${event.id}` },
    },
    handle: (event) => applyAnswer(deps, event),
  };
}

async function applyAnswer(
  deps: LangyPullRequestLinkSubscriberDeps,
  event: LangyConversationProcessingEvent,
): Promise<void> {
  if (event.type !== LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED) return;
  const projectId = event.tenantId;
  const conversationId = String(event.aggregateId);
  const { turnId, parts } = event.data;

  const isFollowUp = await deps.links.isFollowUpTurn({ conversationId, turnId });
  if (!isFollowUp) await deps.links.resetFollowUps({ conversationId });

  const opened = pullRequestsOpenedIn(parts);
  if (opened.length === 0) return;

  const [conversation, project] = await Promise.all([
    readOwner(deps, { projectId, conversationId }),
    deps.projects.findIdentity(projectId),
  ]);
  if (!conversation.ownerUserId || !project) return;

  for (const pull of opened) {
    await deps.links.link({
      ...pull,
      organizationId: project.organizationId,
      projectId,
      conversationId,
      userId: conversation.ownerUserId,
      linkedAt: event.occurredAt,
    });
  }
}

/** Not folded yet is retryable: the answer and its conversation fold on the same stream. */
function readOwner(
  deps: LangyPullRequestLinkSubscriberDeps,
  at: { projectId: string; conversationId: string },
): Promise<{ ownerUserId: string | null }> {
  return deps.conversations.getById(at).catch((error: unknown) => {
    if (HandledError.isHandled(error) && error.code === "langy_conversation_not_found") {
      throw new DispatchError({
        message: `Langy conversation ${at.conversationId} is not folded yet; retrying`,
        retryable: true,
        cause: error,
      });
    }
    throw error;
  });
}
