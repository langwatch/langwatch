import { createApiFixture } from "@langwatch/api-fixture";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import { NurturingDeliveryService } from "../nurturing-delivery.service.ts";
import { NurturingService } from "../nurturing.service.ts";

const scenarioCreated: NurturingSignal = {
  kind: "scenario_created",
  sourceEventId: "event-1",
  tenantId: "project-1",
  occurredAt: 1_500,
  userId: "user-1",
  projectId: "project-1",
  scenarioId: "scenario-1",
  scenarioCount: 3,
};

const firstTrace: NurturingSignal = {
  kind: "first_trace_integrated",
  sourceEventId: "event-2",
  tenantId: "project-1",
  occurredAt: 1_600,
  userId: "admin-1",
  projectId: "project-1",
  sdkLanguage: "python",
  sdkFramework: "unknown",
};

/** Customer.io over a recording fetch: each call is kept as its path and body. */
function customerIo(status = 200) {
  const sent: { path: string; body: unknown }[] = [];
  const reported: Error[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    sent.push({ path: new URL(url instanceof Request ? url.url : url).pathname, body });
    return new Response(null, { status });
  });
  const service = NurturingService.create({
    config: { customerIoApiKey: "key", customerIoRegion: "us" },
    fetchFn,
    errorReporter: { capture: (error) => reported.push(error) },
  });
  return { service, sent, reported };
}

/** Lets the fire-and-forget sends settle before the assertions read them. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A delivery over memory PostHog and a recording Customer.io. */
function deliveryOverBothSinks() {
  const posthog = MemoryPostHogChannel.create();
  const cio = customerIo();
  const delivery = NurturingDeliveryService.create({
    claims: claims(),
    users: users(),
    customerIo: cio.service,
    posthog,
  });
  return { posthog, cio, delivery };
}

const source = { tenantId: "project-1", occurredAt: Date.UTC(2026, 8, 29) };

/** The user module: a fixed email and name for every id, read fresh at send time. */
function users(): UserApi {
  return createApiFixture<UserApi>({
    findById: async () => ({
      id: "user-1",
      name: "Jane Doe",
      email: "jane@example.com",
      emailVerified: true,
      image: null,
      pendingSsoSetup: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastLoginAt: null,
      deactivatedAt: null,
    }),
  });
}

/** The platform's idempotency member: true the first time a key is seen. */
function claims() {
  const seen = new Set<string>();
  return {
    claim: vi.fn(async (key: string) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

describe("NurturingDeliveryService", () => {
  describe("when a created scenario is delivered", () => {
    /** @scenario "A created scenario reaches PostHog and Customer.io with main's attributes" */
    it("tracks it in PostHog with the project and sends Customer.io its count and event", async () => {
      const posthog = MemoryPostHogChannel.create();
      const cio = customerIo();
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog,
      });

      await delivery.deliver({ key: "scenario_created:event-1", signal: scenarioCreated });
      await settle();

      expect(posthog.tracked).toEqual([
        { userId: "user-1", event: "scenario_created", properties: { projectId: "project-1" } },
      ]);
      expect(cio.sent).toEqual([
        {
          path: "/v1/identify",
          body: expect.objectContaining({ userId: "user-1", traits: { scenario_count: 3 } }),
        },
        {
          path: "/v1/track",
          body: expect.objectContaining({
            userId: "user-1",
            event: "scenario_created",
            properties: { scenario_id: "scenario-1", project_id: "project-1" },
          }),
        },
      ]);
    });
  });

  describe("when the same signal is delivered twice", () => {
    /** @scenario "A redelivered signal is sent once" */
    it("sends it once", async () => {
      const posthog = MemoryPostHogChannel.create();
      const cio = customerIo();
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog,
      });

      await delivery.deliver({ key: "scenario_created:event-1", signal: scenarioCreated });
      await delivery.deliver({ key: "scenario_created:event-1", signal: scenarioCreated });
      await settle();

      expect(posthog.tracked).toHaveLength(1);
      expect(cio.sent).toHaveLength(2);
    });
  });

  describe("when a project's first trace is delivered", () => {
    /** @scenario "A first trace reaches PostHog and Customer.io, against the organization's admin" */
    it("tracks first_trace_integrated in both sinks with the SDK", async () => {
      const { posthog, cio, delivery } = deliveryOverBothSinks();

      await delivery.deliver({ key: "first_trace_integrated:event-2", signal: firstTrace });
      await settle();

      expect(posthog.tracked).toEqual([
        {
          userId: "admin-1",
          event: "first_trace_integrated",
          properties: { sdk_language: "python", sdk_framework: "unknown", projectId: "project-1" },
        },
      ]);
      expect(cio.sent).toEqual([
        {
          path: "/v1/identify",
          body: expect.objectContaining({
            userId: "admin-1",
            traits: {
              has_traces: true,
              sdk_language: "python",
              sdk_framework: "unknown",
              first_trace_at: "1970-01-01T00:00:01.600Z",
            },
          }),
        },
        {
          path: "/v1/track",
          body: expect.objectContaining({
            event: "first_trace_integrated",
            properties: {
              sdk_language: "python",
              sdk_framework: "unknown",
              project_id: "project-1",
            },
          }),
        },
      ]);
    });
  });

  describe("when a scenario of an organization in the onboarding experiment is delivered", () => {
    /** @scenario "A scenario in an onboarding experiment carries its variant to PostHog" */
    /** @scenario "scenario_created carries the experiment property" */
    it("carries the variant and the experiment property", async () => {
      const { posthog, delivery } = deliveryOverBothSinks();

      await delivery.deliver({
        key: "scenario_created:event-3",
        signal: { ...scenarioCreated, sourceEventId: "event-3", onboardingVariant: "guided" },
      });

      expect(posthog.tracked[0]?.properties).toEqual({
        onboarding_variant: "guided",
        "$feature/experiment_onboarding_langy_guided": "guided",
        projectId: "project-1",
      });
    });
  });

  describe("when a connected agent's successful scenario run is delivered", () => {
    /** @scenario "A connected agent's successful scenario run reaches PostHog against the admin" */
    it("tracks scenario_run_succeeded against the admin and sends Customer.io nothing", async () => {
      const { posthog, cio, delivery } = deliveryOverBothSinks();

      await delivery.deliver({
        key: "scenario_run_succeeded:event-4",
        signal: {
          kind: "scenario_run_succeeded",
          sourceEventId: "event-4",
          ...source,
          userId: "admin-1",
          projectId: "project-1",
          scenarioId: "scenario-1",
          runId: "run-1",
          onboardingVariant: "classic",
        },
      });
      await settle();

      expect(posthog.tracked).toEqual([
        {
          userId: "admin-1",
          event: "scenario_run_succeeded",
          properties: {
            scenario_id: "scenario-1",
            run_id: "run-1",
            connected_agent: true,
            "$feature/experiment_onboarding_langy_guided": "control",
            projectId: "project-1",
          },
        },
      ]);
      expect(cio.sent).toEqual([]);
    });
  });

  describe("when a created workflow is delivered", () => {
    /** @scenario "A created workflow tells Customer.io the project's workflow count" */
    it("sends Customer.io the count and workflow_created", async () => {
      const { cio, delivery } = deliveryOverBothSinks();

      await delivery.deliver({
        key: "workflow_created:event-5",
        signal: {
          kind: "workflow_created",
          sourceEventId: "event-5",
          ...source,
          userId: "user-1",
          projectId: "project-1",
          workflowId: "workflow-1",
          workflowCount: 2,
        },
      });
      await settle();

      expect(cio.sent).toEqual([
        {
          path: "/v1/identify",
          body: expect.objectContaining({ userId: "user-1", traits: { workflow_count: 2 } }),
        },
        {
          path: "/v1/track",
          body: expect.objectContaining({
            event: "workflow_created",
            properties: { workflow_id: "workflow-1", project_id: "project-1" },
          }),
        },
      ]);
    });
  });

  describe("when a completed checkout is delivered", () => {
    /** @scenario "A completed checkout marks the organization's PostHog group as subscribed" */
    it("tracks subscription_created against the organization and sets its group", async () => {
      const { posthog, delivery } = deliveryOverBothSinks();

      await delivery.deliver({
        key: "checkout_completed:event-6",
        signal: {
          kind: "checkout_completed",
          sourceEventId: "event-6",
          ...source,
          organizationId: "org-1",
          subscriptionId: "sub-1",
          checkoutCreatedAt: "2026-09-29T00:00:00.000Z",
        },
      });

      expect(posthog.tracked).toEqual([
        {
          userId: "org-1",
          event: "subscription_created",
          properties: { subscriptionId: "sub-1", $groups: { organization: "org-1" } },
        },
      ]);
      expect(posthog.groups).toEqual([
        {
          groupType: "organization",
          groupKey: "org-1",
          properties: {
            subscriptionCreatedAt: "2026-09-29T00:00:00.000Z",
            hasActiveSubscription: true,
          },
        },
      ]);
    });
  });

  describe("when no sink is configured", () => {
    /** @scenario "With no sink configured a signal is recorded and nothing is sent" */
    it("claims nothing and sends nothing", async () => {
      const claim = claims();
      const delivery = NurturingDeliveryService.create({
        claims: claim,
        users: users(),
        customerIo: undefined,
        posthog: undefined,
      });

      await delivery.deliver({ key: "scenario_created:event-1", signal: scenarioCreated });

      expect(claim.claim).not.toHaveBeenCalled();
    });
  });

  describe("when Customer.io answers every call with a server error", () => {
    /** @scenario "A Customer.io outage is logged and the delivery completes" */
    it("resolves and reports the failure", async () => {
      const cio = customerIo(500);
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog: undefined,
      });

      await expect(
        delivery.deliver({ key: "scenario_created:event-1", signal: scenarioCreated }),
      ).resolves.toBeUndefined();
      await settle();
      expect(cio.reported.length).toBeGreaterThan(0);
    });
  });

  describe("when a tenant's trace update is delivered twice within five minutes", () => {
    /** @scenario "Trace, simulation and evaluation updates to Customer.io are debounced per tenant" */
    it("sends Customer.io the update once", async () => {
      const cio = customerIo();
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog: undefined,
      });
      const trace = (sourceEventId: string): NurturingSignal => ({
        kind: "trace_received",
        sourceEventId,
        ...source,
        userId: "admin-1",
        projectId: "project-1",
      });

      await delivery.deliver({ key: "trace_received:event-1", signal: trace("event-1") });
      await delivery.deliver({ key: "trace_received:event-2", signal: trace("event-2") });
      await settle();

      expect(cio.sent.filter((call) => call.path === "/v1/identify")).toHaveLength(1);
    });
  });

  describe("given Customer.io fails while a rule's decision is sent", () => {
    /** @scenario "Activity tracking failure does not break the login flow" */
    it("session_started: returns normally and reports the failure", async () => {
      const cio = customerIo(500);
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog: undefined,
      });

      await expect(
        delivery.deliver({
          key: "session_started:event-7",
          signal: {
            kind: "session_started",
            sourceEventId: "event-7",
            ...source,
            userId: "user-1",
            hasOrganization: true,
          },
        }),
      ).resolves.toBeUndefined();
      await settle();
      expect(cio.reported.length).toBeGreaterThan(0);
    });

    /** @scenario "Feature adoption hook failure does not break the originating action" */
    it("workflow_created: returns normally and reports the failure", async () => {
      const cio = customerIo(500);
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog: undefined,
      });

      await expect(
        delivery.deliver({
          key: "workflow_created:event-8",
          signal: {
            kind: "workflow_created",
            sourceEventId: "event-8",
            ...source,
            userId: "user-1",
            projectId: "project-1",
            workflowId: "workflow-1",
            workflowCount: 1,
          },
        }),
      ).resolves.toBeUndefined();
      await settle();
      expect(cio.reported.length).toBeGreaterThan(0);
    });

    /** @scenario "Integration-method identify failure does not break onboarding navigation" */
    it("integration_method_chosen: returns normally and reports the failure", async () => {
      const cio = customerIo(500);
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog: undefined,
      });

      await expect(
        delivery.deliver({
          key: "integration_method_chosen:event-9",
          signal: {
            kind: "integration_method_chosen",
            sourceEventId: "event-9",
            ...source,
            userId: "user-1",
            selection: "via-platform",
          },
        }),
      ).resolves.toBeUndefined();
      await settle();
      expect(cio.reported.length).toBeGreaterThan(0);
    });

    /** @scenario "Prompt creation hook failure does not break the prompt mutation" */
    it("prompt_created: returns normally and reports the failure", async () => {
      const cio = customerIo(500);
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog: undefined,
      });

      await expect(
        delivery.deliver({
          key: "prompt_created:event-10",
          signal: {
            kind: "prompt_created",
            sourceEventId: "event-10",
            ...source,
            userId: "user-1",
            projectId: "project-1",
            orgPromptCount: 1,
          },
        }),
      ).resolves.toBeUndefined();
      await settle();
      expect(cio.reported.length).toBeGreaterThan(0);
    });

    /** @scenario "Customer.io failure during signup does not block onboarding" */
    it("signed_up: returns normally and reports the failure", async () => {
      const cio = customerIo(500);
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: cio.service,
        posthog: undefined,
      });

      await expect(
        delivery.deliver({
          key: "signed_up:event-11",
          signal: {
            kind: "signed_up",
            sourceEventId: "event-11",
            ...source,
            userId: "user-1",
            organizationId: "org-1",
            organizationName: "Acme Corp",
          },
        }),
      ).resolves.toBeUndefined();
      await settle();
      expect(cio.reported.length).toBeGreaterThan(0);
    });
  });

  describe("when a deployment named no Customer.io key", () => {
    /** @scenario "Signup with no Customer.io key configured completes without errors" */
    it("signed_up: makes no request at all and raises nothing", async () => {
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: undefined,
        posthog: MemoryPostHogChannel.create(),
      });

      await expect(
        delivery.deliver({
          key: "signed_up:event-12",
          signal: {
            kind: "signed_up",
            sourceEventId: "event-12",
            ...source,
            userId: "user-1",
            organizationId: "org-1",
            organizationName: "Acme Corp",
          },
        }),
      ).resolves.toBeUndefined();
    });

    /** @scenario 'without a Customer.io key nothing is sent' */
    it("guided onboarding: makes no request at all and raises nothing", async () => {
      const posthog = MemoryPostHogChannel.create();
      const delivery = NurturingDeliveryService.create({
        claims: claims(),
        users: users(),
        customerIo: undefined,
        posthog,
      });

      await delivery.deliver({
        key: "guided_onboarding_paths:event-13",
        signal: {
          kind: "guided_onboarding_paths",
          sourceEventId: "event-13",
          ...source,
          userId: "user-1",
          organizationId: "org-1",
          event: "paths_selected",
          previousPaths: [],
          paths: ["gateway"],
        },
      });
      await delivery.deliver({
        key: "guided_onboarding_progress:event-14",
        signal: {
          kind: "guided_onboarding_progress",
          sourceEventId: "event-14",
          ...source,
          userId: "user-1",
          organizationId: "org-1",
          event: "path_completed",
          payload: { path: "gateway" },
          state: { paths: ["gateway"], donePaths: ["gateway"] },
        },
      });

      expect(posthog.tracked).toEqual([]);
    });
  });
});
