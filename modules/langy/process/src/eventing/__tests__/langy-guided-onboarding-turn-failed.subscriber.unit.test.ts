/**
 * guided_onboarding_turn_failed: one per failed turn of the guided conversation, with its code
 * and path, tracked against the conversation's user.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
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
const EXPERIMENT = { "$feature/experiment_onboarding_langy_guided": "guided" };

function failedEvent(code = "langy_github_not_connected") {
  const failed = agentResponseFailedEvent({ id: "evt_failed", occurredAt: T0, turnId: "turn-1" });
  return { ...failed, data: { ...failed.data, error: JSON.stringify({ code, meta: {} }) } };
}

function responded(outcome: "completed" | "failed" | "stopped", error?: string) {
  const event = agentRespondedEvent({ id: `evt_${outcome}`, occurredAt: T0, turnId: "turn-1" });
  return { ...event, data: { ...event.data, outcome, error: error ?? null } };
}

function harness(options: {
  guided?: Partial<GuidedOnboardingForProject> | null;
  ownerUserId?: string | null;
  readFails?: boolean;
}) {
  const tracked: unknown[] = [];
  const reads = { guided: 0, conversations: 0 };
  const guided: GuidedOnboardingForProject | null =
    options.guided === null
      ? null
      : {
          organizationId: "org-1",
          conversationId: CONVERSATION_ID,
          currentPath: "gateway",
          experimentProperties: EXPERIMENT,
          ...options.guided,
        };
  const subscriber = createGuidedOnboardingTurnFailedSubscriber({
    guidedOnboarding: {
      read: async () => {
        reads.guided += 1;
        if (options.readFails) throw new Error("postgres down");
        return guided;
      },
    },
    conversations: {
      getById: async () => {
        reads.conversations += 1;
        return { ownerUserId: options.ownerUserId === undefined ? "user-1" : options.ownerUserId };
      },
    },
    analytics: { track: (input) => void tracked.push(input) },
  });
  return { subscriber, tracked, reads };
}

describe("given the organization's guided onboarding conversation", () => {
  describe("when one of its turns fails with a handled code", () => {
    /** @scenario "a failed Langy turn of the guided conversation is tracked with its code and path" */
    it("tracks the failure against the user with the code, the path and the experiment property", async () => {
      const { subscriber, tracked } = harness({});

      await subscriber.handle(failedEvent(), context);

      expect(tracked).toEqual([
        {
          userId: "user-1",
          event: "guided_onboarding_turn_failed",
          projectId: PROJECT_ID,
          properties: {
            code: "langy_github_not_connected",
            path: "gateway",
            conversation_id: CONVERSATION_ID,
            turn_id: "turn-1",
            organization_id: "org-1",
            ...EXPERIMENT,
          },
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
    it("tracks the failure from the responded event", async () => {
      const { subscriber, tracked } = harness({});
      const event = responded("failed", JSON.stringify({ code: "langy_worker_stopped" }));

      expect(subscriber.options?.enqueue?.filter?.(event)).toBe(true);
      await subscriber.handle(event, context);

      expect(tracked).toEqual([
        expect.objectContaining({
          event: "guided_onboarding_turn_failed",
          properties: expect.objectContaining({ code: "langy_worker_stopped" }),
        }),
      ]);
    });

    it("tracks nothing for a completed or a stopped turn", async () => {
      const { subscriber, tracked, reads } = harness({});

      for (const event of [responded("completed"), responded("stopped")]) {
        expect(subscriber.options?.enqueue?.filter?.(event)).toBe(false);
        await subscriber.handle(event, context);
      }

      expect(tracked).toEqual([]);
      expect(reads.guided).toBe(0);
    });
  });

  describe("when the guided conversation has no owner", () => {
    it("tracks nothing", async () => {
      const { subscriber, tracked } = harness({ ownerUserId: null });
      await subscriber.handle(failedEvent(), context);
      expect(tracked).toEqual([]);
    });
  });

  describe("when the read fails", () => {
    it("returns normally and tracks nothing", async () => {
      const { subscriber, tracked } = harness({ readFails: true });
      await expect(subscriber.handle(failedEvent(), context)).resolves.toBeUndefined();
      expect(tracked).toEqual([]);
    });
  });
});

describe("given a conversation that is not the organization's guided conversation", () => {
  /** @scenario "a failed turn of an ordinary conversation tracks nothing" */
  it("tracks nothing when one of its turns fails", async () => {
    const { subscriber, tracked, reads } = harness({ guided: { conversationId: "conv-other" } });

    await subscriber.handle(failedEvent(), context);

    expect(tracked).toEqual([]);
    expect(reads.conversations).toBe(0);
  });

  it("tracks nothing when the organization recorded no guided onboarding", async () => {
    const { subscriber, tracked } = harness({ guided: null });
    await subscriber.handle(failedEvent(), context);
    expect(tracked).toEqual([]);
  });
});
