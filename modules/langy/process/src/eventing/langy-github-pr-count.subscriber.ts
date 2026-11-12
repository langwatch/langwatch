/**
 * The daily pull request cap counts pull requests, from the fact of one opening: an answer whose
 * `gh pr create` printed a pull request URL. A turn that opened none, or pushed to a pull request
 * that already existed, counts nothing.
 * @see specs/langy/langy-github-prs.feature
 */
import { DispatchError, type EventSubscriberDefinition } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import { pullRequestKeyOf, pullRequestsOpenedIn } from "../rules/langy-ci-follow-up.rules.ts";
import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";

const logger = createLogger("langwatch:langy:github-pr-count");

interface LangyConversationOwnerReader {
  /** Throws `langy_conversation_not_found` until the conversation is folded. */
  getById(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ ownerUserId: string | null }>;
}

/** Where the opened pull requests are counted against the person's day. */
export interface LangyGithubPrCounter {
  recordOpened(input: {
    userId: string;
    pullRequests: readonly string[];
    at: number;
  }): Promise<void>;
}

/** The keys of the pull requests an answer opened; empty for every other event. */
function openedPullRequestKeys(event: LangyConversationProcessingEvent): string[] {
  if (event.type !== LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED) return [];
  return pullRequestsOpenedIn(event.data.parts).map(pullRequestKeyOf);
}

export function createLangyGithubPrCountSubscriber(deps: {
  conversations: LangyConversationOwnerReader;
  counter: LangyGithubPrCounter;
}): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "langyGithubPrCount",
    eventTypes: [LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED],
    options: {
      deduplication: { makeId: (event) => `langy-github-pr-count:${event.id}` },
      enqueue: { filter: (event) => openedPullRequestKeys(event).length > 0 },
    },
    async handle(event): Promise<void> {
      const pullRequests = openedPullRequestKeys(event);
      if (pullRequests.length === 0) return;
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);
      const conversation = await deps.conversations
        .getById({ projectId, conversationId })
        .catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "langy_conversation_not_found") {
            throw new DispatchError({
              message: `Langy conversation ${conversationId} is not folded yet; retrying`,
              retryable: true,
              cause: error,
            });
          }
          throw error;
        });
      const userId = conversation.ownerUserId;
      if (!userId) {
        logger.warn({ projectId, conversationId }, "Langy opened a pull request with no owner");
        return;
      }
      await deps.counter.recordOpened({ userId, pullRequests, at: event.occurredAt });
    },
  };
}
