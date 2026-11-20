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
import { ORGANIZATION_CREATED_EVENT_TYPE } from "@langwatch/organization-contract";
import { PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { NurturingModule } from "../../app/nurturing.app.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingUncopiedProjectRepository } from "../../repositories/memory/memory.nurturing-uncopied-project.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { UNCOPIED_PROJECT_RETRY_WINDOW_MS } from "../../rules/nurturing-project-usage.rules.ts";
import { NurturingUncopiedProjectsService } from "../../services/nurturing-uncopied-projects.service.ts";
import {
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  nurturingOrganizationCreatedSubscriber,
  nurturingProjectPlacementSubscriber,
  nurturingProjectUsageEventing,
} from "../nurturing-project-usage.pipeline.ts";

/** The usage pipeline's lanes as the module declares them, for an app that syncs or one that does not. */
const COPY_LANES = [
  "projectPlacement",
  "organizationCreated",
  "memberFoundedOrganization",
  "memberSignedUp",
  "memberInviteAccepted",
  "memberSsoAutoAdded",
  "memberRemoved",
  "memberDisabled",
  "memberEnabled",
  "virtualKeys",
  "userErasureMarks",
  "identityErasureMarks",
];

/** The lanes only a deployment with a Customer.io channel registers: the folds and the syncs. */
const SYNC_LANES = [
  "promptUsage",
  "evaluatorUsage",
  "scenarioUsage",
  "simulationUsage",
  "traceDayCount",
  "failedTraceDayCount",
  "firstTraceUsageSync",
  "traceUsageSync",
  "evaluationActiveDay",
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

/** The context a peer subscriber's handler gets with each delivery. */
const contextAt = (occurredAt: number) => ({
  tenantId: createTenantId("org-1"),
  aggregateId: "aggregate-1",
  createdAt: occurredAt,
  occurredAt,
  eventId: `event-${occurredAt}`,
});

describe("the usage pipeline's registration", () => {
  /** @scenario "Without a Customer.io channel nothing is counted, but the copies are kept" */
  it("registers only the copies without a Customer.io channel", () => {
    const lanes = usageLanesWith(false);

    expect(lanes).not.toContain(lane("traceDayCount"));
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
    const placements = MemoryNurturingProjectPlacementRepository.create();
    const subscriber = nurturingProjectPlacementSubscriber({
      placements,
      copyLanded: async () => {},
    });
    const data = {
      tenantId: "project-1",
      projectId: "project-1",
      organizationId: "org-1",
      occurredAt: 1_000,
    };

    if (!subscriber.handle) throw new Error("placement handles one fact at a time");
    await subscriber.handle(data, contextAt(1_000));
    await subscriber.handle(data, contextAt(1_000));

    await expect(placements.getPlacement({ projectId: "project-1" })).resolves.toEqual({
      outcome: "known",
      organizationId: "org-1",
    });
    await expect(placements.findProjectIds({ organizationId: "org-1" })).resolves.toEqual([
      "project-1",
    ]);
  });

  /** @scenario "A moved or archived project keeps its placement" */
  it("takes only the creation fact, so a move or an archive writes nothing", () => {
    const subscriber = nurturingProjectPlacementSubscriber({
      placements: MemoryNurturingProjectPlacementRepository.create(),
      copyLanded: async () => {},
    });

    expect(subscriber.eventType).toBe(PROJECT_CREATED_EVENT_TYPE);
  });

  /** @scenario "A project with no copy after the retries is dropped, and its later batches at once" */
  it("forgets a project as uncopied once its copy is written, deleting its first-seen row", async () => {
    let now = 1_000;
    const uncopiedProjects = MemoryNurturingUncopiedProjectRepository.create();
    const uncopied = NurturingUncopiedProjectsService.create({
      uncopiedProjects,
      clock: { nowMs: () => now },
    });
    await uncopied.outcomeOf({ projectId: "project-1" });
    now += UNCOPIED_PROJECT_RETRY_WINDOW_MS;
    await uncopied.outcomeOf({ projectId: "project-1" });
    const placements = MemoryNurturingProjectPlacementRepository.create();
    const subscriber = nurturingProjectPlacementSubscriber({
      placements,
      copyLanded: (input) => uncopied.copyLanded(input),
    });

    if (!subscriber.handle) throw new Error("placement handles one fact at a time");
    await subscriber.handle(
      { tenantId: "project-1", projectId: "project-1", organizationId: "org-1", occurredAt: now },
      contextAt(now),
    );

    expect(uncopiedProjects.storedProjectIds()).toEqual([]);
    expect(uncopied.isDropped({ projectId: "project-1" })).toBe(false);
    await expect(placements.getPlacement({ projectId: "project-1" })).resolves.toEqual({
      outcome: "known",
      organizationId: "org-1",
    });
  });

  /** @scenario "A project nurturing never saw created sends nothing" */
  it("leaves a project it never saw created unknown", async () => {
    const placements = MemoryNurturingProjectPlacementRepository.create();

    await expect(placements.getPlacement({ projectId: "project-old" })).resolves.toEqual({
      outcome: "unknown",
    });
  });

  /** @scenario "The signup day comes from the organization's creation fact" */
  it("keeps the earliest creation time of an organization", async () => {
    const organizationsCreated = MemoryNurturingOrganizationCreatedRepository.create();
    const subscriber = nurturingOrganizationCreatedSubscriber(organizationsCreated);
    const created = (occurredAt: number) => ({
      tenantId: "org-1",
      organizationId: "org-1",
      organizationName: "Acme",
      occurredAt,
    });

    if (!subscriber.handle) throw new Error("creation handles one fact at a time");
    await subscriber.handle(created(2_000), contextAt(2_000));
    await subscriber.handle(created(5_000), contextAt(5_000));

    await expect(
      organizationsCreated.findOrganizationCreatedAt({ organizationId: "org-1" }),
    ).resolves.toEqual({ organizationCreatedAt: 2_000 });
    await expect(
      organizationsCreated.findOrganizationCreatedAt({ organizationId: "org-old" }),
    ).resolves.toEqual({ organizationCreatedAt: null });
  });
});
