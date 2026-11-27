// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import {
  createTenantId,
  type Event,
  type EventSubscriberDefinition,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import {
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import { PROJECT_AGGREGATE_TYPE, PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { NurturingModule } from "../../app/nurturing.app.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import {
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  nurturingProjectPlacementsMap,
  nurturingProjectUsageEventing,
} from "../nurturing-project-usage.pipeline.ts";
import {
  copiesOver,
  liveMapsOver,
  ownerFact,
} from "./nurturing-organization-copies.test-helpers.ts";

/** The usage pipeline's lanes as the module declares them, for an app that syncs or one that does not. */
const COPY_LANES = [
  "virtualKeys",
  "userErasureMarks",
  "identityErasureMarks",
  "projectPlacements",
  "organizationCreations",
  "organizationAdmins",
  "organizationMembers",
  "authMembers",
  "personalOwnersOfOrganization",
  "personalOwnersOfProject",
  "tracedProjectsOfTrace",
  "tracedProjectsOfProject",
  "lastTraces",
  "evaluationDays",
  "traceDaySpans",
  "traceDayFailures",
  "organizationPlans",
];

/** The lanes only a deployment with a Customer.io channel registers: the folds and the syncs. */
const SYNC_LANES = [
  "promptUsage",
  "evaluatorUsage",
  "scenarioUsage",
  "simulationUsage",
  "firstTraceUsageSync",
  "traceUsageSync",
  "organizationCreatedSync",
];

function usagePipelineWith(app: Partial<NurturingModule>) {
  return nurturingProjectUsageEventing.build({
    participation: "consume",
    repositories: MemoryNurturingRepositories.create(),
    app: createApiFixture<NurturingModule>(app),
    processStore: InMemoryProcessStore.createForTesting(),
  });
}

function usageLanesWith(syncsOrganizationUsage: boolean): string[] {
  const pipeline = usagePipelineWith({ syncsOrganizationUsage: () => syncsOrganizationUsage });
  return (pipeline.globalProjections ?? []).map(({ name }) => name);
}

const lane = (name: string) => `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${name}`;

/** Project's creation fact for a project of org-1, as project's log holds it. */
const projectCreatedFact = (occurredAt: number, projectId = "project-1") =>
  ownerFact({
    type: PROJECT_CREATED_EVENT_TYPE,
    aggregateType: PROJECT_AGGREGATE_TYPE,
    aggregateId: projectId,
    tenantId: projectId,
    data: { tenantId: projectId, projectId, organizationId: "org-1", occurredAt },
  });

/** Organization's creation fact for org-1, as organization's log holds it. */
const organizationCreatedFact = (occurredAt: number) =>
  ownerFact({
    type: ORGANIZATION_CREATED_EVENT_TYPE,
    aggregateType: ORGANIZATION_AGGREGATE_TYPE,
    aggregateId: "org-1",
    tenantId: "org-1",
    data: { tenantId: "org-1", organizationId: "org-1", organizationName: "Acme", occurredAt },
  });

describe("the usage pipeline's registration", () => {
  /** @scenario "Without a Customer.io channel nothing is counted, but the copies are kept" */
  it("registers only the copies and the replayable day lanes without a Customer.io channel", () => {
    const lanes = usageLanesWith(false);

    expect(lanes).toContain(lane("traceDaySpans"));
    expect(lanes).toContain(lane("traceDayFailures"));
    expect(lanes.toSorted()).toEqual(COPY_LANES.map(lane).toSorted());
  });

  /** @scenario "A project's first trace syncs its organization too" */
  it("registers the folds, the syncs and the placement copies with a channel, and no other lane", () => {
    const lanes = usageLanesWith(true);

    expect(lanes.toSorted()).toEqual([...COPY_LANES, ...SYNC_LANES].map(lane).toSorted());
  });

  /** @scenario "A new organization gets its name and creation time on its founder" */
  it("hands an organization's creation fact to the organization-created service", async () => {
    const organizationCreated = vi.fn(async () => {});
    const pipeline = usagePipelineWith({
      syncsOrganizationUsage: () => true,
      organizationCreated,
    });
    const subscribers: EventSubscriberDefinition<Event>[] = [];
    const registry = createApiFixture<
      Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
    >({
      registerEventSubscriber: (subscriber) => void subscribers.push(subscriber),
      // The folds and maps register too; this test reads only the event subscribers.
      registerPeerFoldProjection: () => {},
      registerPeerMapProjection: () => {},
      registerSubscriber: () => {},
    });
    for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
    const data = {
      tenantId: "org-1",
      organizationId: "org-1",
      organizationName: "Acme",
      occurredAt: 1_000,
    };

    const sync = subscribers.find(({ name }) => name === lane("organizationCreatedSync"));
    await sync?.handle(
      {
        id: "event-1",
        aggregateId: "org-1",
        aggregateType: "organization",
        tenantId: createTenantId("org-1"),
        createdAt: 1_000,
        occurredAt: 1_000,
        type: ORGANIZATION_CREATED_EVENT_TYPE,
        version: "2026-10-01",
        data,
      } as Event,
      { tenantId: createTenantId("org-1"), aggregateId: "org-1" },
    );

    expect(organizationCreated).toHaveBeenCalledWith(data);
  });
});

describe("the placement copies", () => {
  /** @scenario "A created project is placed in its organization from the creation fact" */
  it("places a created project in its organization, the same on a redelivery", async () => {
    const repositories = MemoryNurturingRepositories.create();
    const deliver = liveMapsOver(copiesOver(repositories));
    const fact = projectCreatedFact(1_000);

    await deliver(fact);
    await deliver(fact);

    await expect(repositories.placements.getPlacement({ projectId: "project-1" })).resolves.toEqual(
      { outcome: "known", organizationId: "org-1" },
    );
    await expect(
      repositories.placements.findProjectIds({ organizationId: "org-1" }),
    ).resolves.toEqual(["project-1"]);
  });

  /** @scenario "A moved or archived project keeps its placement" */
  it("takes only the creation fact, so a move or an archive writes nothing", () => {
    const copies = copiesOver(MemoryNurturingRepositories.create());

    const { map } = nurturingProjectPlacementsMap(copies);

    expect(map.eventTypes).toEqual([PROJECT_CREATED_EVENT_TYPE]);
  });

  /** @scenario "A project nurturing never saw created sends nothing" */
  it("leaves a project it never saw created unknown", async () => {
    const { placements } = MemoryNurturingRepositories.create();

    await expect(placements.getPlacement({ projectId: "project-old" })).resolves.toEqual({
      outcome: "unknown",
    });
  });

  /** @scenario "The signup day comes from the organization's creation fact" */
  it("keeps the earliest creation time of an organization", async () => {
    const repositories = MemoryNurturingRepositories.create();
    const deliver = liveMapsOver(copiesOver(repositories));

    await deliver(organizationCreatedFact(2_000));
    await deliver(organizationCreatedFact(5_000));

    await expect(
      repositories.organizationsCreated.findOrganizationCreatedAt({ organizationId: "org-1" }),
    ).resolves.toEqual({ organizationCreatedAt: 2_000 });
    await expect(
      repositories.organizationsCreated.findOrganizationCreatedAt({ organizationId: "org-old" }),
    ).resolves.toEqual({ organizationCreatedAt: null });
  });
});
