// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import { SIGNED_UP_EVENT_TYPE } from "@langwatch/auth-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE,
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_VERSION,
  LANGY_GUIDED_ONBOARDING_AGGREGATE_TYPE,
  type GuidedOnboardingTurnFailedEventData,
} from "@langwatch/langy-contract";
import {
  GUIDED_ONBOARDING_AGGREGATE_TYPE,
  GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
  GUIDED_ONBOARDING_RECORDED_EVENT_VERSION,
  type GuidedOnboardingRecordedEventData,
} from "@langwatch/onboarding-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import {
  USER_AGGREGATE_TYPE,
  USER_DEACTIVATED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  USER_REACTIVATED_EVENT_TYPE,
  USER_CREATED_EVENT_TYPE,
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
function nurturingOverMemoryPostHog(users: UserApi = createApiFixture<UserApi>({})) {
  const posthog = MemoryPostHogChannel.create();
  const customerIoFetch = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
  );
  const seen = new Set<string>();
  const delivery = NurturingDeliveryService.create({
    claims: { claim: async (key: string) => !seen.has(key) && Boolean(seen.add(key)) },
    customerIo: NurturingService.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn: customerIoFetch,
    }),
    posthog,
    users,
  });
  const pipeline = buildNurturingPipeline({
    deliver: (input) => delivery.deliver(input),
    projectCreated: async () => undefined,
    guidedTurnFailed: (data) => delivery.deliverGuidedTurnFailed(data),
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
      ).toEqual([[USER_REGISTERED_EVENT_TYPE], [USER_CREATED_EVENT_TYPE]]);
    });
  });
});

/** User's created fact for user-1; `backfilled` when the seed step recorded it. */
function createdFact({ backfilled }: { backfilled?: true } = {}): Event {
  return {
    ...userFact(USER_CREATED_EVENT_TYPE),
    data: {
      tenantId: "user-1",
      userId: "user-1",
      occurredAt: 1_000,
      ...(backfilled ? { backfilled } : {}),
    },
    idempotencyKey: "user-1:created",
  } as Event;
}

/** The person behind user-1, read fresh at delivery and never stored (§9). */
function jane(): UserApi {
  return createApiFixture<UserApi>({
    findById: async () => ({
      id: "user-1",
      name: "Jane Doe",
      email: "jane@example.com",
      emailVerified: true,
      image: null,
      pendingSsoSetup: false,
      createdAt: new Date(1_000),
      updatedAt: new Date(1_000),
      lastLoginAt: null,
      deactivatedAt: null,
    }),
  });
}

describe("nurturing's userCreated peer subscriber", () => {
  describe("when user records a minted account, delivered twice", () => {
    /** @scenario A minted account is identified to PostHog and Customer.io, with no signed_up */
    it("identifies the person once to each sink and tracks no signed_up", async () => {
      const { posthog, customerIoFetch, deliverFact } = nurturingOverMemoryPostHog(jane());

      await deliverFact(createdFact());
      await deliverFact(createdFact());
      await settle();

      expect(posthog.identified).toEqual([
        { userId: "user-1", properties: { created_at: new Date(1_000).toISOString() } },
      ]);
      expect(posthog.tracked).toEqual([]);
      expect(customerIoFetch).toHaveBeenCalledTimes(1);
      const body = customerIoFetch.mock.calls[0]?.[1]?.body;
      expect(typeof body === "string" ? JSON.parse(body) : body).toEqual({
        userId: "user-1",
        traits: {
          email: "jane@example.com",
          name: "Jane Doe",
          createdAt: new Date(1_000).toISOString(),
        },
      });
    });
  });

  describe("when the seed step recorded the fact for an older account", () => {
    /** @scenario A backfilled created fact is not sent to PostHog or Customer.io */
    it("sends nothing to either sink", async () => {
      const { posthog, customerIoFetch, deliverFact } = nurturingOverMemoryPostHog(jane());

      await deliverFact(createdFact({ backfilled: true }));
      await settle();

      expect(posthog.identified).toEqual([]);
      expect(posthog.tracked).toEqual([]);
      expect(customerIoFetch).not.toHaveBeenCalled();
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

/** Langy's fact for one failed guided turn, as its langy_guided_onboarding pipeline records it. */
function turnFailedFact(overrides: Partial<GuidedOnboardingTurnFailedEventData> = {}): Event {
  const data: GuidedOnboardingTurnFailedEventData = {
    tenantId: "project-1",
    occurredAt: 1_000,
    sourceEventId: "evt-failed",
    organizationId: "org-1",
    userId: "user-1",
    conversationId: "conv-1",
    turnId: "turn-1",
    code: "langy_github_not_connected",
    path: "gateway",
    onboardingVariant: "guided",
    ...overrides,
  };
  return {
    id: "evt-turn-failed-fact",
    aggregateId: data.conversationId,
    aggregateType: LANGY_GUIDED_ONBOARDING_AGGREGATE_TYPE,
    tenantId: createTenantId("project-1"),
    createdAt: 1_000,
    occurredAt: 1_000,
    type: GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE,
    version: GUIDED_ONBOARDING_TURN_FAILED_EVENT_VERSION,
    data,
    idempotencyKey: `guided-turn-failed:${data.sourceEventId}`,
  } as Event;
}

describe("nurturing's guidedOnboardingTurnFailed peer subscriber", () => {
  describe("when langy records a failed turn of the guided conversation", () => {
    /** @scenario "A failed guided turn langy recorded is tracked against the conversation's user" */
    it("tracks it in PostHog against the user and makes no Customer.io call", async () => {
      const { posthog, customerIoFetch, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(turnFailedFact());
      await settle();

      expect(posthog.tracked).toEqual([
        {
          userId: "user-1",
          event: "guided_onboarding_turn_failed",
          uuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
          properties: {
            code: "langy_github_not_connected",
            path: "gateway",
            conversation_id: "conv-1",
            turn_id: "turn-1",
            organization_id: "org-1",
            "$feature/experiment_onboarding_langy_guided": "guided",
            projectId: "project-1",
          },
        },
      ]);
      expect(customerIoFetch).not.toHaveBeenCalled();
    });

    /** @scenario "A failed guided turn of an organization without a variant carries no experiment property" */
    it("carries no experiment property for an organization without a variant", async () => {
      const { posthog, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(turnFailedFact({ onboardingVariant: null, path: null }));
      await settle();

      expect(posthog.tracked).toHaveLength(1);
      expect(posthog.tracked[0]?.properties).toEqual({
        code: "langy_github_not_connected",
        path: null,
        conversation_id: "conv-1",
        turn_id: "turn-1",
        organization_id: "org-1",
        projectId: "project-1",
      });
    });

    /** @scenario "A redelivered failed-turn fact is tracked once" */
    it("tracks one event for a fact delivered twice, under one uuid per source event", async () => {
      const { posthog, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(turnFailedFact());
      await deliverFact(turnFailedFact());
      await deliverFact(turnFailedFact({ sourceEventId: "evt-failed-2", turnId: "turn-2" }));
      await settle();

      const uuids = posthog.tracked.map(({ uuid }) => uuid);
      expect(posthog.tracked).toHaveLength(2);
      expect(new Set(uuids).size).toBe(2);
    });
  });
});

const MORNING = 1_791_280_800_000;
const SIGNUP_AGE_MS = 3.5 * 24 * 60 * 60 * 1000;
const NEXT_DAY = 1_791_334_800_000;

/** Trace's own fact for a project's trace, as its project_milestones pipeline records it. */
function traceFact({
  type,
  occurredAt,
  onboardingVariant = "guided",
}: {
  type: string;
  occurredAt: number;
  onboardingVariant?: string;
}): Event {
  return {
    id: `evt-${type}-${occurredAt}`,
    aggregateId: "project-1",
    aggregateType: "trace_project",
    tenantId: createTenantId("project-1"),
    createdAt: occurredAt,
    occurredAt,
    type,
    version: "2026-10-01",
    data: {
      tenantId: "project-1",
      projectId: "project-1",
      userId: "admin-1",
      sdkLanguage: "python",
      sdkFramework: "openai",
      occurredAt,
      organizationCreatedAt: occurredAt - SIGNUP_AGE_MS,
      onboardingVariant,
    },
    idempotencyKey: `project-1:${type}:${occurredAt}`,
  } as Event;
}

/** Scenario's finished-run fact against a connected agent, carrying the organization's admin. */
function runFinishedFact({ runId, occurredAt }: { runId: string; occurredAt: number }): Event {
  return {
    id: `evt-run-${runId}`,
    aggregateId: runId,
    aggregateType: "simulation_run",
    tenantId: createTenantId("project-1"),
    createdAt: occurredAt,
    occurredAt,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: "2026-10-01",
    data: {
      scenarioRunId: runId,
      scenarioId: "scenario-1",
      target: { type: "connected", referenceId: "agent-1" },
      results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
      status: "SUCCESS",
      organizationAdmin: {
        userId: "admin-1",
        onboardingVariant: "guided",
        organizationCreatedAt: occurredAt - SIGNUP_AGE_MS,
      },
      occurredAt,
    },
    idempotencyKey: `${runId}:finished`,
  } as Event;
}

const activeDays = (posthog: { tracked: readonly { event: string }[] }) =>
  posthog.tracked.filter(({ event }) => event === "project_active_day");

describe("nurturing's project active day, derived from trace and scenario facts", () => {
  describe("when a project's first trace and later traces arrive on one UTC day", () => {
    /** @scenario "the first signal of the day tracks the project's active day" */
    /** @scenario "subsequent signals the same day do not re-track" */
    it("tracks project_active_day once, against the admin, with the source", async () => {
      const { posthog, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(traceFact({ type: FIRST_TRACE_RECORDED_EVENT_TYPE, occurredAt: MORNING }));
      await deliverFact(
        traceFact({ type: TRACE_RECEIVED_EVENT_TYPE, occurredAt: MORNING + 1_000 }),
      );
      await deliverFact(
        traceFact({ type: TRACE_RECEIVED_EVENT_TYPE, occurredAt: MORNING + 2_000 }),
      );
      await settle();

      expect(activeDays(posthog)).toEqual([
        {
          userId: "admin-1",
          event: "project_active_day",
          properties: {
            source: "trace",
            projectId: "project-1",
            days_since_signup: 3,
            "$feature/experiment_onboarding_langy_guided": "guided",
          },
        },
      ]);
    });
  });

  describe("when the same project signals again after midnight UTC", () => {
    /** @scenario "the first signal of the next UTC day tracks again" */
    it("tracks project_active_day once more for the new day", async () => {
      const { posthog, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(traceFact({ type: TRACE_RECEIVED_EVENT_TYPE, occurredAt: MORNING }));
      await deliverFact(traceFact({ type: TRACE_RECEIVED_EVENT_TYPE, occurredAt: NEXT_DAY }));
      await settle();

      expect(activeDays(posthog)).toHaveLength(2);
    });
  });

  describe("when a succeeded scenario run is the day's first signal", () => {
    /** @scenario "a succeeded scenario run against a connected agent is a signal of the day" */
    it("tracks project_active_day with the source scenario_run and the experiment property", async () => {
      const { posthog, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(runFinishedFact({ runId: "run-1", occurredAt: MORNING }));
      await deliverFact(runFinishedFact({ runId: "run-2", occurredAt: MORNING + 1_000 }));
      await settle();

      expect(activeDays(posthog)).toEqual([
        {
          userId: "admin-1",
          event: "project_active_day",
          properties: expect.objectContaining({
            source: "scenario_run",
            days_since_signup: 3,
            "$feature/experiment_onboarding_langy_guided": "guided",
          }),
        },
      ]);
    });
  });

  describe("when a trace fact carries an onboarding variant nurturing does not know", () => {
    /** @scenario "the first signal of the day tracks the project's active day" */
    it("tracks project_active_day without the experiment property", async () => {
      const { posthog, deliverFact } = nurturingOverMemoryPostHog();

      await deliverFact(
        traceFact({
          type: TRACE_RECEIVED_EVENT_TYPE,
          occurredAt: MORNING,
          onboardingVariant: "retired-variant",
        }),
      );
      await settle();

      expect(activeDays(posthog)).toEqual([
        {
          userId: "admin-1",
          event: "project_active_day",
          properties: { source: "trace", projectId: "project-1", days_since_signup: 3 },
        },
      ]);
    });
  });
});
