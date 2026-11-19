// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Jobs the previous release queued under a retired copy subscriber's key reach the peer map that
 * replaced it, on a worker running the usage pipeline over memory stores.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { type Event, EventSourcing, type ReplayEvent } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import { PROJECT_AGGREGATE_TYPE, PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingRepositories } from "../../repositories/nurturing.repositories.ts";
import { buildNurturingProjectUsagePipeline } from "../nurturing-project-usage.pipeline.ts";
import {
  copiesOver,
  liveEventOf,
  nurturingCopyOwnerPipelines,
  ownerFact,
} from "./nurturing-organization-copies.test-helpers.ts";

/** A worker of the new release: the copy owners and the usage pipeline, consuming. */
function worker() {
  const repositories = MemoryNurturingRepositories.create();
  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({ eventStore });
  for (const owner of nurturingCopyOwnerPipelines()) eventing.register(owner);
  eventing.register(
    buildNurturingProjectUsagePipeline({
      store: repositories.projectUsage,
      copies: copiesOver(repositories),
      sync: undefined,
    }),
  );
  eventing.startConsumers();
  return { eventing, eventStore, repositories };
}

/** A job as the previous release queued it: the owner's event under the retired lane's key. */
async function queuedByPreviousRelease({
  eventing,
  key,
  event,
}: Readonly<{ eventing: EventSourcing; key: string; event: Event }>): Promise<void> {
  const [pipeline, jobType, ...name] = key.split(":");
  await eventing.globalQueue?.send({
    ...event,
    __pipelineName: pipeline,
    __jobType: jobType,
    __jobName: name.join(":"),
  });
}

const projectCreated = (): ReplayEvent =>
  ownerFact({
    type: PROJECT_CREATED_EVENT_TYPE,
    aggregateType: PROJECT_AGGREGATE_TYPE,
    aggregateId: "project-1",
    tenantId: "project-1",
    data: {
      tenantId: "project-1",
      projectId: "project-1",
      organizationId: "org-1",
      adminUserId: "admin-1",
      occurredAt: 1_000,
    },
  });

const organizationCreated = (): ReplayEvent =>
  ownerFact({
    type: ORGANIZATION_CREATED_EVENT_TYPE,
    aggregateType: ORGANIZATION_AGGREGATE_TYPE,
    aggregateId: "org-1",
    tenantId: "org-1",
    data: { tenantId: "org-1", organizationId: "org-1", organizationName: "Acme", occurredAt: 500 },
  });

type Case = Readonly<{
  key: string;
  fact: () => ReplayEvent;
  copied: (repositories: NurturingRepositories) => Promise<unknown>;
  expected: unknown;
}>;

const cases: [string, Case][] = [
  [
    "placement",
    {
      key: "global:subscriber:nurturing_project_usage.projectPlacement",
      fact: projectCreated,
      copied: (repositories) => repositories.placements.getPlacement({ projectId: "project-1" }),
      expected: { outcome: "known", organizationId: "org-1" },
    },
  ],
  [
    "organization creation",
    {
      key: "global:subscriber:nurturing_project_usage.organizationCreated",
      fact: organizationCreated,
      copied: (repositories) =>
        repositories.organizationsCreated.findOrganizationCreatedAt({ organizationId: "org-1" }),
      expected: { organizationCreatedAt: 500 },
    },
  ],
  [
    "admin",
    {
      key: "global:subscriber:nurturing.projectCreated",
      fact: projectCreated,
      copied: async (repositories) =>
        (await repositories.milestones.findOrganization({ organizationId: "org-1" })).map(
          ({ adminUserId, seeded }) => ({ adminUserId, seeded }),
        ),
      expected: [{ adminUserId: "admin-1", seeded: false }],
    },
  ],
];

describe("given a job the previous release queued under a retired copy subscriber's key", () => {
  /** @scenario "Copy jobs the previous release queued reach the peer map that replaced their lane" */
  it.each(cases)(
    "routes the %s job to its successor map, which writes the copy",
    async (_name, { key, fact, copied, expected }) => {
      const { eventing, eventStore, repositories } = worker();
      const event = liveEventOf(fact());
      await eventStore.seed({ events: [event] });

      await queuedByPreviousRelease({ eventing, key, event });

      await vi.waitFor(async () => expect(await copied(repositories)).toEqual(expected));
      await eventing.close();
    },
  );
});
