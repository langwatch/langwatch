/**
 * `guided_onboarding_turn_failed`: once per failed turn of the organization's guided onboarding
 * conversation, against the conversation's user, with the failure's code and the path run.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { EventSubscriberDefinition } from "@langwatch/eventing";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type { LangyConversationProcessingEvent } from "./langy-conversation-state.projection.ts";

const logger = createLogger("langwatch:langy:guided-onboarding-turn-failed");

/** The organization's guided onboarding behind a project, as onboarding answers it. */
export interface GuidedOnboardingForProject {
  organizationId: string;
  conversationId: string | null | undefined;
  currentPath: string | null | undefined;
  /** The A/B experiment property to spread, empty for an organization without a variant. */
  experimentProperties: Record<string, string>;
}

export interface GuidedOnboardingReader {
  read(params: { projectId: string }): Promise<GuidedOnboardingForProject | null>;
}

/** The owner of a conversation, for the distinct id the failure is tracked against. */
export interface LangyConversationOwnerReader {
  read(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ ownerUserId: string | null } | null>;
}

/** Fire and forget: a failed turn must not fail again on its analytics. */
export interface GuidedOnboardingAnalytics {
  track(input: {
    userId: string;
    event: string;
    projectId: string;
    properties: Record<string, unknown>;
  }): void;
}

export interface GuidedOnboardingTurnFailedSubscriberDeps {
  guidedOnboarding: GuidedOnboardingReader;
  conversations: LangyConversationOwnerReader;
  analytics: GuidedOnboardingAnalytics;
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
        const guided = await deps.guidedOnboarding.read({ projectId });
        if (!guided || guided.conversationId !== conversationId) return;

        const conversation = await deps.conversations.read({ projectId, conversationId });
        const userId = conversation?.ownerUserId;
        if (!userId) {
          logger.warn(
            { projectId, conversationId, turnId: failure.turnId },
            "Guided conversation has no owner, guided_onboarding_turn_failed not tracked",
          );
          return;
        }

        deps.analytics.track({
          userId,
          event: "guided_onboarding_turn_failed",
          projectId,
          properties: {
            code: failure.code,
            path: guided.currentPath ?? null,
            conversation_id: conversationId,
            turn_id: failure.turnId,
            organization_id: guided.organizationId,
            ...guided.experimentProperties,
          },
        });
      } catch (error) {
        logger.error(
          { projectId, conversationId, turnId: failure.turnId, error },
          "Failed to track guided_onboarding_turn_failed, the event is discarded",
        );
      }
    },
  };
}
