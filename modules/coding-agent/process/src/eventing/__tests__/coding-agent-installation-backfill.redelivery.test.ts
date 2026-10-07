/**
 * @vitest-environment node
 * @unit
 * @see modules/coding-agent/specs/github-installation-backfill.feature
 */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import {
  GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE,
  type GithubInstallationConnectedEventData,
} from "@langwatch/github-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { buildTestCodingAgentProcessingPipeline } from "../../__tests__/fixtures/coding-agent-processing.fixture.ts";
import {
  TestBillingPolicy,
  TestClock,
  TestEvents,
  TestGithubService,
  TestMetricSeries,
  createTestProjects,
  TestSessions,
  TestTraceSessions,
  session,
} from "../../__tests__/fixtures/coding-agent.fixture.ts";
import type { CodingAgentPullRequestMappingBackfill } from "../../services/coding-agent-pull-request-mapping-backfill.service.ts";
import { CodingAgentFeatureService } from "../../services/coding-agent.service.ts";

const LANE = "coding_agent_processing.codingAgentInstallationBackfill";

const CONNECTED: GithubInstallationConnectedEventData = {
  tenantId: "organization-1",
  organizationId: "organization-1",
  installationId: "installation-1",
  occurredAt: 1_500,
};

function connectedEvent({
  data = CONNECTED,
  id = "event-1",
}: {
  data?: GithubInstallationConnectedEventData;
  id?: string;
} = {}): Event {
  return {
    id,
    aggregateId: data.installationId,
    aggregateType: "github_installation",
    tenantId: createTenantId(data.tenantId),
    createdAt: data.occurredAt,
    occurredAt: data.occurredAt,
    type: GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE,
    version: "2026-10-07",
    data,
  };
}

function installationLane(
  backfill?: CodingAgentPullRequestMappingBackfill,
): EventSubscriberDefinition | undefined {
  const pipeline = buildTestCodingAgentProcessingPipeline(undefined, undefined, backfill);
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  return lanes.get(LANE);
}

function deduplicationIdOf({
  definition,
  event,
}: {
  definition: EventSubscriberDefinition;
  event: Event;
}): string {
  const strategy = definition.options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the peer subscriber declares its own deduplication id");
  }
  return strategy.makeId(event);
}

function backfillOverOneBranch(): {
  service: CodingAgentFeatureService;
  github: TestGithubService;
} {
  const sessions = new TestSessions();
  sessions.recentRowsByTenant.set("project-a", [
    session({
      tenantId: "project-a",
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      gitBranch: "feature",
    }),
  ]);
  const projects = createTestProjects();
  projects.projects = [{ id: "project-a" }];
  const github = new TestGithubService();
  const service = CodingAgentFeatureService.create({
    sessions,
    traceSessions: new TestTraceSessions(),
    metricSeries: new TestMetricSeries(),
    sessionEvents: new TestEvents(),
    github,
    projects,
    billing: new TestBillingPolicy(),
    clock: new TestClock(),
  });
  return { service, github };
}

describe("coding-agent's installation backfill peer lane", () => {
  describe("when the pipeline holds no installation backfill", () => {
    it("mounts no lane on GitHub's connect", () => {
      expect(installationLane()).toBeUndefined();
    });
  });

  describe("when GitHub records an installation connected", () => {
    /** @scenario "connecting an installation backfills pull request mappings" */
    it("backfills the connected organization's recent session branches", async () => {
      const { service, github } = backfillOverOneBranch();
      const definition = installationLane(service);
      if (!definition) throw new Error("no installation backfill lane mounted");

      await definition.handle(connectedEvent(), {
        tenantId: CONNECTED.tenantId,
        aggregateId: CONNECTED.installationId,
      });

      expect(definition.eventTypes).toEqual([GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE]);
      expect(github.mappingRequests).toEqual([
        {
          tenantId: "project-a",
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          headBranch: "feature",
        },
      ]);
    });
  });

  describe("when the same connect is redelivered", () => {
    /** @scenario "a redelivered installation connect is harmless" */
    it("keys both deliveries alike and asks GitHub for the same branches again", async () => {
      const { service, github } = backfillOverOneBranch();
      const definition = installationLane(service);
      if (!definition) throw new Error("no installation backfill lane mounted");
      const context = { tenantId: CONNECTED.tenantId, aggregateId: CONNECTED.installationId };

      await definition.handle(connectedEvent(), context);
      const first = [...github.mappingRequests];
      await definition.handle(connectedEvent({ id: "redelivered" }), context);

      expect(first).toHaveLength(1);
      expect(github.mappingRequests).toEqual([...first, ...first]);
      expect(deduplicationIdOf({ definition, event: connectedEvent() })).toBe(
        deduplicationIdOf({ definition, event: connectedEvent({ id: "redelivered" }) }),
      );
    });

    it("keys a later reconnect of the same installation apart", () => {
      const definition = installationLane(backfillOverOneBranch().service);
      if (!definition) throw new Error("no installation backfill lane mounted");
      const later = connectedEvent({ data: { ...CONNECTED, occurredAt: 9_000 }, id: "event-2" });

      expect(deduplicationIdOf({ definition, event: connectedEvent() })).not.toBe(
        deduplicationIdOf({ definition, event: later }),
      );
    });
  });
});
