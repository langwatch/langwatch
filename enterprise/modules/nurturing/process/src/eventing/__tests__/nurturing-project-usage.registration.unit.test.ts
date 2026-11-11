// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { NurturingModule } from "../../app/nurturing.app.ts";
import type { CustomerIoChannel } from "../../channels/customer-io.channel.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import {
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  nurturingOrganizationCreatedSubscriber,
  nurturingProjectPlacementSubscriber,
  nurturingProjectUsageEventing,
} from "../nurturing-project-usage.pipeline.ts";

type Setup = Parameters<typeof NurturingModule.create>[0];
type EventingSetupOf = Parameters<typeof nurturingProjectUsageEventing.build>[0];

/** The usage pipeline's lanes as the module wires them, with or without a Customer.io channel. */
async function usageLanesWith(customerIo: CustomerIoChannel | undefined): Promise<string[]> {
  const repositories = MemoryNurturingRepositories.create();
  // Neither dependency is called while the module is only being created.
  const app = await NurturingModule.create({
    channels: { customerIo, posthog: undefined },
    dependencies: {},
    repositories,
    resources: { own: () => {} },
  } as unknown as Setup);
  const pipeline = nurturingProjectUsageEventing.build({
    repositories,
    app,
  } as unknown as EventingSetupOf);
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
  it("registers no fold and no subscriber without a Customer.io channel", async () => {
    const lanes = await usageLanesWith(undefined);

    expect(lanes).not.toContain(lane("traceDayCount"));
    expect(lanes).toEqual([]);
  });

  it("registers the trace-day count and the placement copies with a channel", async () => {
    const lanes = await usageLanesWith({} as CustomerIoChannel);

    expect(lanes).toEqual(
      expect.arrayContaining([
        lane("traceDayCount"),
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

    if (!("handle" in subscriber)) throw new Error("placement handles one fact at a time");
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

    if (!("handle" in subscriber)) throw new Error("creation handles one fact at a time");
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
