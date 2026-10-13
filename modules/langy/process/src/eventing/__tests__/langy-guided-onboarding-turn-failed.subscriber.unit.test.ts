/**
 * guided_onboarding_turn_failed: one fact per failed turn of the guided conversation, with its
 * code and path, recorded against the conversation's user. Nurturing sends it to analytics.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import {
  createGuidedOnboardingTurnFailedSubscriber,
  type GuidedOnboardingForProject,
  extractTurnFailure,
} from "../langy-guided-onboarding-turn-failed.subscriber.ts";
import {
  agentRespondedEvent,
  agentResponseFailedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  T0,
} from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

function failedEvent(code = "langy_github_not_connected") {
  const failed = agentResponseFailedEvent({ id: "evt_failed", occurredAt: T0, turnId: "turn-1" });
  return { ...failed, data: { ...failed.data, error: JSON.stringify({ code, meta: {} }) } };
}

function responded(outcome: "completed" | "failed" | "stopped", error?: string) {
  const event = agentRespondedEvent({ id: `evt_${outcome}`, occurredAt: T0, turnId: "turn-1" });
  return { ...event, data: { ...event.data, outcome, error: error ?? null } };
}

function harness(options: {
  guided?: Partial<GuidedOnboardingForProject>;
  ownerUserId?: string | null;
  readFails?: boolean;
  projectGone?: boolean;
}) {
  const recorded: unknown[] = [];
  const reads = { guided: 0, conversations: 0 };
  const guided: GuidedOnboardingForProject = {
    organizationId: "org-1",
    conversationId: CONVERSATION_ID,
    currentPath: "gateway",
    variant: "guided",
    ...options.guided,
  };
  const subscriber = createGuidedOnboardingTurnFailedSubscriber({
    guidedOnboarding: {
      getByProject: async ({ projectId }) => {
        reads.guided += 1;
        if (options.readFails) throw new Error("postgres down");
        if (options.projectGone) {
          throw new ProjectNotFoundError("Project not found", { meta: { projectId } });
        }
        return guided;
      },
    },
    conversations: {
      getById: async () => {
        reads.conversations += 1;
        return { ownerUserId: options.ownerUserId === undefined ? "user-1" : options.ownerUserId };
      },
    },
    facts: { recordTurnFailed: async (data) => void recorded.push(data) },
  });
  return { subscriber, recorded, reads };
}

describe("given the organization's guided onboarding conversation", () => {
  describe("when one of its turns fails with a handled code", () => {
    /** @scenario "a failed Langy turn of the guided conversation is tracked with its code and path" */
    it("records the failure against the user with the code, the path and the variant", async () => {
      const { subscriber, recorded } = harness({});

      await subscriber.handle(failedEvent(), context);

      expect(recorded).toEqual([
        {
          tenantId: PROJECT_ID,
          occurredAt: T0,
          sourceEventId: "evt_failed",
          organizationId: "org-1",
          userId: "user-1",
          conversationId: CONVERSATION_ID,
          turnId: "turn-1",
          code: "langy_github_not_connected",
          path: "gateway",
          onboardingVariant: "guided",
        },
      ]);
    });

    it("reads an unparseable error as unknown", () => {
      const failed = agentResponseFailedEvent({ id: "evt", occurredAt: T0, turnId: "turn-1" });
      expect(extractTurnFailure(failed)).toEqual({ turnId: "turn-1", code: "unknown" });
    });
  });

  describe("when a turn ends in failure with a partial answer", () => {
    /** @scenario "a turn that ended in failure with a partial answer is tracked as failed" */
    it("records the failure from the responded event", async () => {
      const { subscriber, recorded } = harness({});
      const event = responded("failed", JSON.stringify({ code: "langy_worker_stopped" }));

      expect(subscriber.options?.enqueue?.filter?.(event)).toBe(true);
      await subscriber.handle(event, context);

      expect(recorded).toEqual([expect.objectContaining({ code: "langy_worker_stopped" })]);
    });

    it("records nothing for a completed or a stopped turn", async () => {
      const { subscriber, recorded, reads } = harness({});

      for (const event of [responded("completed"), responded("stopped")]) {
        expect(subscriber.options?.enqueue?.filter?.(event)).toBe(false);
        await subscriber.handle(event, context);
      }

      expect(recorded).toEqual([]);
      expect(reads.guided).toBe(0);
    });
  });

  describe("when the guided conversation has no owner", () => {
    it("records nothing", async () => {
      const { subscriber, recorded } = harness({ ownerUserId: null });
      await subscriber.handle(failedEvent(), context);
      expect(recorded).toEqual([]);
    });
  });

  describe("when the read fails", () => {
    it("returns normally and records nothing", async () => {
      const { subscriber, recorded } = harness({ readFails: true });
      await expect(subscriber.handle(failedEvent(), context)).resolves.toBeUndefined();
      expect(recorded).toEqual([]);
    });
  });
});

describe("given a conversation that is not the organization's guided conversation", () => {
  /** @scenario "a failed turn of an ordinary conversation tracks nothing" */
  it("records nothing when one of its turns fails", async () => {
    const { subscriber, recorded, reads } = harness({ guided: { conversationId: "conv-other" } });

    await subscriber.handle(failedEvent(), context);

    expect(recorded).toEqual([]);
    expect(reads.conversations).toBe(0);
  });

  it("records nothing when the organization recorded no guided onboarding", async () => {
    const { subscriber, recorded } = harness({ guided: { conversationId: null } });
    await subscriber.handle(failedEvent(), context);
    expect(recorded).toEqual([]);
  });

  it("records nothing when the project is gone", async () => {
    const { subscriber, recorded, reads } = harness({ projectGone: true });
    await expect(subscriber.handle(failedEvent(), context)).resolves.toBeUndefined();
    expect(recorded).toEqual([]);
    expect(reads.conversations).toBe(0);
  });
});
