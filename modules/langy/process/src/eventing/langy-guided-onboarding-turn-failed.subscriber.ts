/**
 * `guided_onboarding_turn_failed`: once per failed turn of the organization's guided onboarding
 * conversation, recorded as a fact against the conversation's user, with the failure's code and
 * the path run. Nurturing sends the analytics event from it.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { EventSubscriberDefinition } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import {
  type GuidedOnboardingTurnFailedEventData,
  LANGY_CONVERSATION_EVENT_TYPES,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { GuidedPath, OnboardingVariant } from "@langwatch/onboarding-contract";

import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";

const logger = createLogger("langwatch:langy:guided-onboarding-turn-failed");

/** The organization's guided onboarding behind a project, as onboarding answers it. */
export interface GuidedOnboardingForProject {
  organizationId: string;
  conversationId: string | null | undefined;
  currentPath: GuidedPath | null | undefined;
  /** Where the onboarding experiment put the organization; null for one older than it. */
  variant: OnboardingVariant | null;
}

export interface GuidedOnboardingReader {
  /** Throws `project_not_found` when the project is gone; unguided has a null `conversationId`. */
  getByProject(params: { projectId: string }): Promise<GuidedOnboardingForProject>;
}

/** The owner of a conversation, for the distinct id the failure is tracked against. */
interface LangyConversationOwnerReader {
  /** Throws `langy_conversation_not_found` until the conversation is folded. */
  getById(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ ownerUserId: string | null }>;
}

/** The facts langy records about the guided conversation; peers react to them. */
export interface GuidedOnboardingFacts {
  recordTurnFailed(data: GuidedOnboardingTurnFailedEventData): Promise<void>;
}

interface GuidedOnboardingTurnFailedSubscriberDeps {
  guidedOnboarding: GuidedOnboardingReader;
  conversations: LangyConversationOwnerReader;
  facts: GuidedOnboardingFacts;
}

/** The failure a terminal event describes; a stop by the user is not one. */
export function extractTurnFailure(
  event: LangyConversationProcessingEvent,
): { turnId: string; code: string } | null {
  if (event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED) {
    return { turnId: event.data.turnId, code: errorCodeOf(event.data.error) };
  }
  if (
    event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED &&
    event.data.outcome === "failed"
  ) {
    return { turnId: event.data.turnId, code: errorCodeOf(event.data.error) };
  }
  return null;
}

/** The relay writes the serialized handled error; its `code` names the failure. */
function errorCodeOf(error: string | null | undefined): string {
  if (!error) return "unknown";
  try {
    const parsed: unknown = JSON.parse(error);
    if (typeof parsed !== "object" || parsed === null || !("code" in parsed)) return "unknown";
    const { code } = parsed;
    return typeof code === "string" && code.length > 0 ? code : "unknown";
  } catch {
    return "unknown";
  }
}

export function createGuidedOnboardingTurnFailedSubscriber(
  deps: GuidedOnboardingTurnFailedSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "guidedOnboardingTurnFailed",
    eventTypes: [
      LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    ],
    options: {
      deduplication: { makeId: (event) => `guided-onboarding-turn-failed:${event.id}` },
      enqueue: { filter: (event) => extractTurnFailure(event) !== null },
    },
    async handle(event): Promise<void> {
      const failure = extractTurnFailure(event);
      if (!failure) return;
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);

      try {
        await trackGuidedTurnFailure({
          deps,
          failure,
          projectId,
          conversationId,
          sourceEvent: { id: event.id, occurredAt: event.occurredAt },
        });
      } catch (error) {
        logger.error(
          { projectId, conversationId, turnId: failure.turnId, error },
          "Failed to record guided_onboarding_turn_failed, the fact is discarded",
        );
      }
    },
  };
}

async function trackGuidedTurnFailure({
  deps,
  failure,
  projectId,
  conversationId,
  sourceEvent,
}: {
  deps: GuidedOnboardingTurnFailedSubscriberDeps;
  failure: { turnId: string; code: string };
  projectId: string;
  conversationId: string;
  sourceEvent: { id: string; occurredAt: number };
}): Promise<void> {
  const guided = await deps.guidedOnboarding.getByProject({ projectId }).catch((error: unknown) => {
    if (HandledError.isHandled(error) && error.code === "project_not_found") return null;
    throw error;
  });
  if (!guided || guided.conversationId !== conversationId) return;

  const conversation = await deps.conversations
    .getById({ projectId, conversationId })
    .catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "langy_conversation_not_found")
        return null;
      throw error;
    });
  const userId = conversation?.ownerUserId;
  if (!userId) {
    logger.warn(
      { projectId, conversationId, turnId: failure.turnId },
      "Guided conversation has no owner, guided_onboarding_turn_failed not recorded",
    );
    return;
  }

  await deps.facts.recordTurnFailed({
    tenantId: projectId,
    occurredAt: sourceEvent.occurredAt,
    sourceEventId: sourceEvent.id,
    organizationId: guided.organizationId,
    userId,
    conversationId,
    turnId: failure.turnId,
    code: failure.code,
    path: guided.currentPath ?? null,
    onboardingVariant: guided.variant,
  });
}
