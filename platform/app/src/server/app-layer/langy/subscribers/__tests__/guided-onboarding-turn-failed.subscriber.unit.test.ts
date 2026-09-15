/**
 * @vitest-environment node
 *
 * guided_onboarding_turn_failed: one per failed Langy turn of the
 * organization's guided onboarding conversation, with the failure's code
 * and the path being run, tracked against the user of the conversation.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import {
  createGuidedOnboardingTurnFailedSubscriber,
  type GuidedOnboardingTurnFailedSubscriberDeps,
  turnFailureOf,
} from "../guided-onboarding-turn-failed.subscriber";

const { trackServerEvent } = vi.hoisted(() => ({ trackServerEvent: vi.fn() }));

vi.mock("~/server/posthog", () => ({ trackServerEvent }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const context: EventSubscriberContext = {
  tenantId: "project-1",
  aggregateId: "conversation-1",
};

function event(
  type: string,
  data: Record<string, unknown>,
  conversationId = "conversation-1",
): LangyConversationProcessingEvent {
  return {
    id: `event-${type}`,
    aggregateId: conversationId,
    aggregateType: "langy_conversation",
    tenantId: "project-1",
    createdAt: 1_000,
    occurredAt: 1_000,
    type,
    version: "1",
    data: { conversationId, turnId: "turn-1", ...data },
  } as unknown as LangyConversationProcessingEvent;
}

function failedEvent(code = "langy_github_not_connected") {
  return event(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED, {
    error: JSON.stringify({ code, kind: code, meta: {}, reasons: [] }),
  });
}

function createDeps(
  overrides: Partial<{
    conversationId: string | undefined;
    currentPath: string | undefined;
  }> = {},
): GuidedOnboardingTurnFailedSubscriberDeps {
  return {
    guidedOnboarding: {
      read: vi.fn().mockResolvedValue({
        organizationId: "org-1",
        variant: "guided",
        state: {
          paths: ["gateway", "llmops"],
          donePaths: [],
          currentPath:
            "currentPath" in overrides ? overrides.currentPath : "gateway",
          conversationId:
            "conversationId" in overrides
              ? overrides.conversationId
              : "conversation-1",
        },
      }),
    },
    conversations: {
      read: vi.fn().mockResolvedValue({ ownerUserId: "user-1" }),
    },
  };
}

describe("createGuidedOnboardingTurnFailedSubscriber()", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when a turn of the guided conversation fails with a handled code", () => {
    /** @scenario "a failed Langy turn of the guided conversation is tracked with its code and path" */
    it("tracks guided_onboarding_turn_failed against the user with the code, the path and the experiment property", async () => {
      const deps = createDeps();
      const subscriber = createGuidedOnboardingTurnFailedSubscriber(deps);

      await subscriber.handle(failedEvent(), context);

      expect(trackServerEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "guided_onboarding_turn_failed",
        projectId: "project-1",
        properties: {
          code: "langy_github_not_connected",
          path: "gateway",
          conversation_id: "conversation-1",
          turn_id: "turn-1",
          organization_id: "org-1",
          "$feature/experiment_onboarding_langy_guided": "guided",
        },
      });
    });

    it("reads an unparseable error as unknown", () => {
      const failure = turnFailureOf(
        event(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED, {
          error: "worker exploded",
        }),
      );

      expect(failure).toEqual({ turnId: "turn-1", code: "unknown" });
    });
  });

  describe("when a turn ended in failure with a partial answer", () => {
    /** @scenario "a turn that ended in failure with a partial answer is tracked as failed" */
    it("tracks guided_onboarding_turn_failed from the responded event", async () => {
      const deps = createDeps();
      const subscriber = createGuidedOnboardingTurnFailedSubscriber(deps);
      const responded = event(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED, {
        messageId: "message-1",
        outcome: "failed",
        error: JSON.stringify({ code: "langy_worker_stopped" }),
      });

      expect(subscriber.options?.enqueue?.filter?.(responded)).toBe(true);
      await subscriber.handle(responded, context);

      expect(trackServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "guided_onboarding_turn_failed",
          properties: expect.objectContaining({ code: "langy_worker_stopped" }),
        }),
      );
    });

    it("tracks nothing for a completed or a stopped turn", async () => {
      const deps = createDeps();
      const subscriber = createGuidedOnboardingTurnFailedSubscriber(deps);
      const completed = event(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED, {
        messageId: "message-1",
        outcome: "completed",
      });
      const stopped = event(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED, {
        messageId: "message-1",
        outcome: "stopped",
      });

      expect(subscriber.options?.enqueue?.filter?.(completed)).toBe(false);
      expect(subscriber.options?.enqueue?.filter?.(stopped)).toBe(false);
      await subscriber.handle(completed, context);
      await subscriber.handle(stopped, context);

      expect(trackServerEvent).not.toHaveBeenCalled();
      expect(deps.guidedOnboarding.read).not.toHaveBeenCalled();
    });
  });

  describe("when the conversation is not the organization's guided conversation", () => {
    /** @scenario "a failed turn of an ordinary conversation tracks nothing" */
    it("tracks nothing", async () => {
      const deps = createDeps({ conversationId: "conversation-other" });
      const subscriber = createGuidedOnboardingTurnFailedSubscriber(deps);

      await subscriber.handle(failedEvent(), context);

      expect(trackServerEvent).not.toHaveBeenCalled();
      expect(deps.conversations.read).not.toHaveBeenCalled();
    });

    it("tracks nothing when the organization recorded no guided onboarding", async () => {
      const deps = createDeps();
      (
        deps.guidedOnboarding.read as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);
      const subscriber = createGuidedOnboardingTurnFailedSubscriber(deps);

      await subscriber.handle(failedEvent(), context);

      expect(trackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the guided conversation has no owner", () => {
    it("tracks nothing", async () => {
      const deps = createDeps();
      (deps.conversations.read as ReturnType<typeof vi.fn>).mockResolvedValue({
        ownerUserId: null,
      });
      const subscriber = createGuidedOnboardingTurnFailedSubscriber(deps);

      await subscriber.handle(failedEvent(), context);

      expect(trackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the read fails", () => {
    it("returns normally and tracks nothing", async () => {
      const deps = createDeps();
      (
        deps.guidedOnboarding.read as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("postgres down"));
      const subscriber = createGuidedOnboardingTurnFailedSubscriber(deps);

      await expect(
        subscriber.handle(failedEvent(), context),
      ).resolves.toBeUndefined();
      expect(trackServerEvent).not.toHaveBeenCalled();
    });
  });
});
