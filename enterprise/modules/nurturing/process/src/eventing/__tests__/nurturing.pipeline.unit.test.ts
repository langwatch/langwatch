// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import { SIGNED_UP_EVENT_TYPE } from "@langwatch/auth-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_AGGREGATE_TYPE,
  GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
  GUIDED_ONBOARDING_RECORDED_EVENT_VERSION,
  type GuidedOnboardingRecordedEventData,
} from "@langwatch/onboarding-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  USER_AGGREGATE_TYPE,
  USER_DEACTIVATED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  USER_REACTIVATED_EVENT_TYPE,
  USER_REGISTERED_EVENT_TYPE,
  type UserApi,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import { NurturingDeliveryService } from "../../services/nurturing-delivery.service.ts";
import { NurturingService } from "../../services/nurturing.service.ts";
import { RecordNurturingSignalCommand } from "../nurturing-signal.commands.ts";
import { buildNurturingPipeline } from "../nurturing.pipeline.ts";

const signal: NurturingSignal = {
  kind: "scenario_created",
  sourceEventId: "event-1",
  tenantId: "project-1",
  occurredAt: 1_500,
  userId: "user-1",
  projectId: "project-1",
  scenarioId: "scenario-1",
  scenarioCount: 3,
};

describe("RecordNurturingSignalCommand", () => {
  describe("when an owner records the same source event twice", () => {
    /** @scenario "An owner's signal lands on nurturing's pipeline keyed by its source event" */
    it("records the same aggregate and idempotency key both times", () => {
      const command = new RecordNurturingSignalCommand();
      const send = () =>
        command.handle({
          tenantId: createTenantId("project-1"),
          aggregateId: "scenario_created:event-1",
          type: "lw.nurturing.record_signal",
          data: { tenantId: "project-1", occurredAt: 1_500, signal },
        })[0];

      const [first, second] = [send(), send()];

      expect(first?.aggregateId).toBe("scenario_created:event-1");
      expect(first?.idempotencyKey).toBe("scenario_created:event-1");
      expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
      expect(first?.data.signal).toEqual(signal);
    });
  });
});

/** Nurturing's pipeline over memory PostHog and a recording Customer.io, as the app composes it. */
function nurturingOverMemoryPostHog() {
  const posthog = MemoryPostHogChannel.create();
  const customerIoFetch = vi.fn(async () => new Response(null, { status: 200 }));
  const seen = new Set<string>();
  const delivery = NurturingDeliveryService.create({
    claims: { claim: async (key: string) => !seen.has(key) && Boolean(seen.add(key)) },
    customerIo: NurturingService.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn: customerIoFetch,
    }),
    posthog,
    users: createApiFixture<UserApi>({}),
  });
  const pipeline = buildNurturingPipeline({
    deliver: (input) => delivery.deliver(input),
    projectCreated: async () => undefined,
    evaluationCompleted: async () => [],
    simulationRunFinished: async () => [],
  });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  /** Hands one event to every nurturing peer subscriber on its type, as the worker would. */
  const deliverFact = async (event: Event) => {
    for (const subscriber of subscribers.filter(({ eventTypes }) =>
      eventTypes.includes(event.type),
    )) {
      await subscriber.handle(event, { tenantId: event.tenantId, aggregateId: event.aggregateId });
    }
  };
  return { posthog, customerIoFetch, subscribers, deliverFact };
}

function userFact(type: string): Event {
  return {
    id: `evt-${type}`,
    aggregateId: "user-1",
    aggregateType: USER_AGGREGATE_TYPE,
    tenantId: createTenantId("user-1"),
    createdAt: 1_000,
    occurredAt: 1_000,
    type,
    version: USER_LIFECYCLE_EVENT_VERSION,
    data: { tenantId: "user-1", userId: "user-1", occurredAt: 1_000 },
    idempotencyKey: "user-1:registered",
  } as Event;
}

/** Auth's sign-up fact for user-1, as its auth_lifecycle pipeline records it. */
function authSignUpFact(): Event {
  return {
    id: "evt-auth-signed-up",
    aggregateId: "user-1",
    aggregateType: "user",
    tenantId: createTenantId("user-1"),
    createdAt: 1_000,
    occurredAt: 1_000,
    type: SIGNED_UP_EVENT_TYPE,
    version: "2026-09-29",
    data: { tenantId: "user-1", userId: "user-1", occurredAt: 1_000 },
    idempotencyKey: "user-1:signed_up",
  } as Event;
}

/** Lets the fire-and-forget sends settle before the assertions read them. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("nurturing's userRegistered peer subscriber", () => {
  describe("when user records a self-service registration, delivered twice", () => {
    /** @scenario Email-mode registration tracks the PostHog signed_up milestone exactly once */
    it("tracks exactly one PostHog signed_up for the user id, with no properties", async () => {
      const { posthog, customerIoFetch, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(userFact(USER_REGISTERED_EVENT_TYPE));
      await deliverFact(userFact(USER_REGISTERED_EVENT_TYPE));
      await settle();

      expect(posthog.tracked).toEqual([{ userId: "user-1", event: "signed_up", properties: {} }]);
      expect(customerIoFetch).not.toHaveBeenCalled();
    });
  });

  describe("when user records no registered fact", () => {
    /** @scenario A rejected registration tracks no PostHog signed_up milestone */
    it("tracks no PostHog signed_up from any other user fact", async () => {
      const { posthog, subscribers, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(userFact(USER_DEACTIVATED_EVENT_TYPE));
      await deliverFact(userFact(USER_REACTIVATED_EVENT_TYPE));
      await settle();

      expect(posthog.tracked).toEqual([]);
      expect(
        subscribers
          .filter(({ eventTypes }) => eventTypes.some((type) => type.startsWith("lw.user.")))
          .map(({ eventTypes }) => eventTypes),
      ).toEqual([[USER_REGISTERED_EVENT_TYPE]]);
    });
  });
});

describe("nurturing's authSignedUp peer subscriber", () => {
  describe("when auth records a person's sign-up, delivered twice", () => {
    /** @scenario BetterAuth signup tracks the PostHog signed_up milestone */
    /** @scenario PostHog signed_up still fires when the SSO auto-add path runs */
    /** @scenario PostHog signed_up still fires when the email has no parsable domain */
    /** @scenario PostHog signed_up still fires when the signup is unverified */
    it("tracks exactly one PostHog signed_up for the user id, with no properties", async () => {
      const { posthog, customerIoFetch, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(authSignUpFact());
      await deliverFact(authSignUpFact());
      await settle();

      expect(posthog.tracked).toEqual([{ userId: "user-1", event: "signed_up", properties: {} }]);
      expect(customerIoFetch).not.toHaveBeenCalled();
    });
  });

  describe("when user and auth both report the same person's sign-up", () => {
    it("tracks one PostHog signed_up for that person", async () => {
      const { posthog, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(userFact(USER_REGISTERED_EVENT_TYPE));
      await deliverFact(authSignUpFact());
      await settle();

      expect(posthog.tracked).toEqual([{ userId: "user-1", event: "signed_up", properties: {} }]);
    });
  });
});

/** Onboarding's guided_onboarding_lifecycle fact for one guided write, as it records it. */
function guidedFact(
  data: Pick<GuidedOnboardingRecordedEventData, "event" | "payload" | "state" | "previousPaths">,
): Event {
  return {
    id: `evt-guided-${data.event}`,
    aggregateId: "org-1",
    aggregateType: GUIDED_ONBOARDING_AGGREGATE_TYPE,
    tenantId: createTenantId("org-1"),
    createdAt: 1_000,
    occurredAt: 1_000,
    type: GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
    version: GUIDED_ONBOARDING_RECORDED_EVENT_VERSION,
    data: {
      tenantId: "org-1",
      occurredAt: 1_000,
      organizationId: "org-1",
      userId: "user-1",
      ...data,
    },
    idempotencyKey: `org-1:org-1:${data.event}:1000`,
  } as Event;
}

describe("nurturing's guidedOnboardingRecorded peer subscriber", () => {
  describe("when onboarding records the picked paths, delivered twice", () => {
    /** @scenario "a guided state write reaches PostHog through the service" */
    /** @scenario "selecting paths tracks the paths and the primary path" */
    /** @scenario "every guided onboarding event carries the experiment property" */
    it("tracks exactly one guided_onboarding_paths_selected against the user, with the person properties", async () => {
      const { posthog, deliverFact } = nurturingOverMemoryPostHog();
      const fact = guidedFact({
        event: "paths_selected",
        payload: { paths: ["gateway", "llmops"], primaryPath: "gateway" },
        previousPaths: [],
        state: { paths: ["gateway", "llmops"], donePaths: [] },
      });

      await deliverFact(fact);
      await deliverFact(fact);
      await settle();

      expect(posthog.tracked).toEqual([
        {
          userId: "user-1",
          event: "guided_onboarding_paths_selected",
          properties: {
            paths: ["gateway", "llmops"],
            primary_path: "gateway",
            "$feature/experiment_onboarding_langy_guided": "guided",
            organization_id: "org-1",
            $set: {
              onboarding_variant: "guided",
              onboarding_paths: ["gateway", "llmops"],
              onboarding_primary_path: "gateway",
            },
          },
        },
      ]);
    });
  });

  describe("when onboarding records a step Customer.io is not told of", () => {
    /** @scenario "skipping the provider is tracked" */
    /** @scenario "completing, skipping and replaying the tour are tracked with the current path" */
    /** @scenario "skipping the provider, replaying the tour and attaching a conversation send nothing" */
    it("tracks it in PostHog and makes no Customer.io call", async () => {
      const { posthog, customerIoFetch, deliverFact } = nurturingOverMemoryPostHog();
      const state = { paths: ["gateway" as const], donePaths: [], currentPath: "gateway" as const };

      await deliverFact(
        guidedFact({ event: "provider_skipped", payload: {}, previousPaths: [], state }),
      );
      await deliverFact(
        guidedFact({ event: "tour_replayed", payload: {}, previousPaths: [], state }),
      );
      await settle();

      expect(posthog.tracked.map(({ event, properties }) => [event, properties?.path])).toEqual([
        ["guided_onboarding_provider_skipped", undefined],
        ["guided_onboarding_tour_replayed", "gateway"],
      ]);
      expect(customerIoFetch).not.toHaveBeenCalled();
    });
  });
});
