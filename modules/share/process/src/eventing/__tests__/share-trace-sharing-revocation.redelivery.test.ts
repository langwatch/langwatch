/**
 * @vitest-environment node
 * @unit
 * @see modules/share/specs/share.feature
 */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import {
  ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE,
  ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_VERSION,
  type OrganizationTraceSharingDisabledEventData,
} from "@langwatch/organization-contract";
import {
  PROJECT_TRACE_SHARING_DISABLED_EVENT_TYPE,
  PROJECT_TRACE_SHARING_DISABLED_EVENT_VERSION,
  type ProjectTraceSharingDisabledEventData,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  createShareTestAuthz,
  createShareTestDataRetention,
  createShareTestProjects,
} from "../../app/__tests__/share.fixture.ts";
import { MemoryShareRepositories } from "../../repositories/memory/memory.share.repositories.ts";
import { ShareService } from "../../services/share.service.ts";
import { buildShareTraceSharingRevocationPipeline } from "../share-trace-sharing-revocation.pipeline.ts";

const LANE = "share_trace_sharing_revocation.shareProjectTraceSharingDisabled";
const ORGANIZATION_LANE = "share_trace_sharing_revocation.shareOrganizationTraceSharingDisabled";

const DISABLED: ProjectTraceSharingDisabledEventData = {
  tenantId: "project-1",
  projectId: "project-1",
  organizationId: "organization-1",
  occurredAt: 1_500,
  disabledByUserId: "user-1",
};

function disabledEvent({ id = "event-1" }: { id?: string } = {}): Event {
  return {
    id,
    aggregateId: DISABLED.projectId,
    aggregateType: "project",
    tenantId: createTenantId(DISABLED.tenantId),
    createdAt: DISABLED.occurredAt,
    occurredAt: DISABLED.occurredAt,
    type: PROJECT_TRACE_SHARING_DISABLED_EVENT_TYPE,
    version: PROJECT_TRACE_SHARING_DISABLED_EVENT_VERSION,
    data: DISABLED,
  };
}

const ORGANIZATION_DISABLED: OrganizationTraceSharingDisabledEventData = {
  tenantId: "organization-1",
  organizationId: "organization-1",
  occurredAt: 2_500,
  projectIds: ["project-1", "project-3"],
  changedByUserId: "user-1",
};

function organizationDisabledEvent({ id = "event-2" }: { id?: string } = {}): Event {
  return {
    id,
    aggregateId: ORGANIZATION_DISABLED.organizationId,
    aggregateType: "organization",
    tenantId: createTenantId(ORGANIZATION_DISABLED.tenantId),
    createdAt: ORGANIZATION_DISABLED.occurredAt,
    occurredAt: ORGANIZATION_DISABLED.occurredAt,
    type: ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE,
    version: ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_VERSION,
    data: ORGANIZATION_DISABLED,
  };
}

async function revocationLane({ lane = LANE }: { lane?: string } = {}): Promise<{
  definition: EventSubscriberDefinition;
  shares: ShareService;
}> {
  const repositories = MemoryShareRepositories.create();
  const shares = ShareService.create({
    repository: repositories.shares,
    dataRetention: createShareTestDataRetention(),
    permissions: createShareTestAuthz(),
    projects: createShareTestProjects(),
    cache: repositories.cache,
  });
  for (const [projectId, resourceId] of [
    ["project-1", "trace-1"],
    ["project-1", "trace-2"],
    ["project-2", "trace-3"],
  ] as const) {
    await shares.createShare({ projectId, resourceType: "TRACE", resourceId });
  }
  const pipeline = buildShareTraceSharingRevocationPipeline({ shares });
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const definition = lanes.get(lane);
  if (!definition) throw new Error("no trace sharing revocation lane mounted");
  return { definition, shares };
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

async function linkCounts(shares: ShareService): Promise<number[]> {
  const scopes = [
    ["project-1", "trace-1"],
    ["project-1", "trace-2"],
    ["project-2", "trace-3"],
  ] as const;
  const lists = await Promise.all(
    scopes.map(([projectId, resourceId]) =>
      shares.listForResource({ projectId, resourceType: "TRACE", resourceId }),
    ),
  );
  return lists.map((links) => links.length);
}

const CONTEXT = { tenantId: DISABLED.tenantId, aggregateId: DISABLED.projectId };
const ORGANIZATION_CONTEXT = {
  tenantId: ORGANIZATION_DISABLED.tenantId,
  aggregateId: ORGANIZATION_DISABLED.organizationId,
};

describe("share's trace sharing revocation peer lane", () => {
  describe("when project records trace sharing disabled", () => {
    /** @scenario "project's trace sharing disabled fact revokes that project's trace links" */
    it("revokes the project's trace links and keeps other projects' links", async () => {
      const { definition, shares } = await revocationLane();

      await definition.handle(disabledEvent(), CONTEXT);

      expect(definition.eventTypes).toEqual([PROJECT_TRACE_SHARING_DISABLED_EVENT_TYPE]);
      expect(await linkCounts(shares)).toEqual([0, 0, 1]);
    });
  });

  describe("when the same disabled fact is redelivered", () => {
    /** @scenario "a redelivered trace sharing disabled fact is harmless" */
    it("keys both deliveries alike and removes nothing the second time", async () => {
      const { definition, shares } = await revocationLane();

      await definition.handle(disabledEvent(), CONTEXT);
      await definition.handle(disabledEvent({ id: "redelivered" }), CONTEXT);

      expect(await linkCounts(shares)).toEqual([0, 0, 1]);
      expect(deduplicationIdOf({ definition, event: disabledEvent() })).toBe(
        deduplicationIdOf({ definition, event: disabledEvent({ id: "redelivered" }) }),
      );
    });
  });

  describe("when organization records trace sharing disabled", () => {
    /** @scenario "organization's trace sharing disabled fact revokes the trace links of each listed project" */
    it("revokes the listed projects' trace links and keeps unlisted projects' links", async () => {
      const { definition, shares } = await revocationLane({ lane: ORGANIZATION_LANE });

      await definition.handle(organizationDisabledEvent(), ORGANIZATION_CONTEXT);

      expect(definition.eventTypes).toEqual([ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE]);
      expect(await linkCounts(shares)).toEqual([0, 0, 1]);
    });
  });

  describe("when the same organization disabled fact is redelivered", () => {
    /** @scenario "a redelivered organization trace sharing disabled fact is harmless" */
    it("keys both deliveries alike and removes nothing the second time", async () => {
      const { definition, shares } = await revocationLane({ lane: ORGANIZATION_LANE });

      await definition.handle(organizationDisabledEvent(), ORGANIZATION_CONTEXT);
      await definition.handle(
        organizationDisabledEvent({ id: "redelivered" }),
        ORGANIZATION_CONTEXT,
      );

      expect(await linkCounts(shares)).toEqual([0, 0, 1]);
      expect(deduplicationIdOf({ definition, event: organizationDisabledEvent() })).toBe(
        deduplicationIdOf({ definition, event: organizationDisabledEvent({ id: "redelivered" }) }),
      );
    });
  });
});
