// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { createTenantId, InMemoryProcessStore } from "@langwatch/eventing";
import { PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { NurturingModule } from "../../app/nurturing.app.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import {
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  nurturingOrganizationCreatedSubscriber,
  nurturingProjectPlacementSubscriber,
  nurturingProjectUsageEventing,
} from "../nurturing-project-usage.pipeline.ts";

/** The usage pipeline's lanes as the module declares them, for an app that syncs or one that does not. */
function usageLanesWith(syncsOrganizationUsage: boolean): string[] {
  const app = createApiFixture<NurturingModule>({
    syncsOrganizationUsage: () => syncsOrganizationUsage,
  });
  const pipeline = nurturingProjectUsageEventing.build({
    participation: "consume",
    repositories: MemoryNurturingRepositories.create(),
    app,
    processStore: InMemoryProcessStore.createForTesting(),
  });
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
  /** @scenario "Without a Customer.io channel nothing is counted" */
  it("registers no fold and no subscriber without a Customer.io channel", () => {
    const lanes = usageLanesWith(false);

    expect(lanes).not.toContain(lane("traceDayCount"));
    expect(lanes).toEqual([]);
  });

  /** @scenario "A project's first trace syncs its organization too" */
  it("registers the trace-day count, both trace syncs and the placement copies with a channel", () => {
    const lanes = usageLanesWith(true);

    expect(lanes).toEqual(
      expect.arrayContaining([
        lane("traceDayCount"),
        lane("failedTraceDayCount"),
        lane("firstTraceUsageSync"),
        lane("traceUsageSync"),
        lane("projectPlacement"),
        lane("organizationCreated"),
      ]),
    );
  });
});

describe("the placement copies", () => {
  /** @scenario "A created project is placed in its organization from the creation fact" */
  it("places a created project in its organization, the same on a redelivery", async () => {
    const placements = MemoryNurturingProjectPlacementRepository.create();
    const subscriber = nurturingProjectPlacementSubscriber(placements);
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
    const subscriber = nurturingProjectPlacementSubscriber(
      MemoryNurturingProjectPlacementRepository.create(),
    );

    expect(subscriber.eventType).toBe(PROJECT_CREATED_EVENT_TYPE);
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
