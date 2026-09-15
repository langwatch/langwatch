import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { createLogger } from "@langwatch/observability";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { onboardingExperimentProperties } from "~/server/onboarding/guided-onboarding.experiment";
import type { GuidedOnboardingForProject } from "~/server/onboarding/onboarding-variant";
import { trackServerEvent } from "~/server/posthog";

const logger = createLogger("langwatch:langy:guided-onboarding-turn-failed");

/** The organization's guided onboarding behind a project, or null when it has none. */
export interface GuidedOnboardingReader {
  read(params: {
    projectId: string;
  }): Promise<GuidedOnboardingForProject | null>;
}

/** The owner of a conversation, for the distinct id the failure is tracked against. */
export interface LangyConversationOwnerReader {
  read(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ ownerUserId: string | null } | null>;
}

export interface GuidedOnboardingTurnFailedSubscriberDeps {
  guidedOnboarding: GuidedOnboardingReader;
  conversations: LangyConversationOwnerReader;
}

const TERMINAL_EVENTS = [
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
] as const;

/**
 * The failure a terminal turn event describes, or null when the turn did
 * not fail: `agent_response_failed` always did, `agent_responded` only with
 * the outcome `failed` (a stop by the user is not a failure).
 */
export function turnFailureOf(
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

/**
 * The failed turn's error is the serialized handled error the relay wrote,
 * whose `code` names the failure (`langy_github_not_connected`,
 * `langy_worker_stopped`, ...). Anything else reads as unknown.
 */
function errorCodeOf(error: string | null | undefined): string {
  if (!error) return "unknown";
  try {
    const parsed: unknown = JSON.parse(error);
    const code = (parsed as { code?: unknown } | null)?.code;
    return typeof code === "string" && code.length > 0 ? code : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Tracks `guided_onboarding_turn_failed` once per failed turn of the
 * organization's guided onboarding conversation, against the user of the
 * conversation, with the failure's code and the path being run. A failed
 * turn of any other conversation tracks nothing.
 */
export function createGuidedOnboardingTurnFailedSubscriber(
  deps: GuidedOnboardingTurnFailedSubscriberDeps,
): EventSubscriberDefinition<LangyConversationProcessingEvent> {
  return {
    name: "guidedOnboardingTurnFailed",
    eventTypes: [...TERMINAL_EVENTS],
    options: {
      deduplication: {
        makeId: (event) => `guided-onboarding-turn-failed:${event.id}`,
      },
      enqueue: { filter: (event) => turnFailureOf(event) !== null },
    },
    async handle(event): Promise<void> {
      const failure = turnFailureOf(event);
      if (!failure) return;
      const projectId = event.tenantId;
      const conversationId = String(event.aggregateId);

      try {
        const guided = await deps.guidedOnboarding.read({ projectId });
        if (!guided || guided.state.conversationId !== conversationId) return;

        const conversation = await deps.conversations.read({
          projectId,
          conversationId,
        });
        const userId = conversation?.ownerUserId;
        if (!userId) {
          logger.warn(
            { projectId, conversationId, turnId: failure.turnId },
            "Guided conversation has no owner, guided_onboarding_turn_failed not tracked",
          );
          return;
        }

        trackServerEvent({
          userId,
          event: "guided_onboarding_turn_failed",
          projectId,
          properties: {
            code: failure.code,
            path: guided.state.currentPath ?? null,
            conversation_id: conversationId,
            turn_id: failure.turnId,
            organization_id: guided.organizationId,
            ...onboardingExperimentProperties(guided.variant),
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
