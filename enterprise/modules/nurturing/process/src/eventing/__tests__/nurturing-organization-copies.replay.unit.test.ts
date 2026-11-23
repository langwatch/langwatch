// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's placement, organization-creation and admin copies as peer maps filled at deploy:
 * the real replay engine over seeded owner logs, the module's own steps, memory repositories.
 * Live delivery of the same facts through the registered lanes is the oracle.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { ReplayEvent } from "@langwatch/eventing";
import {
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import { PROJECT_AGGREGATE_TYPE, PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingRepositories } from "../../repositories/nurturing.repositories.ts";
import {
  ADMINS_STEP,
  copiesDeploy,
  copiesOver,
  liveMapsOver,
  ORGANIZATIONS_CREATED_STEP,
  ownerFact,
  PLACEMENTS_STEP,
  userErasedFact,
} from "./nurturing-organization-copies.test-helpers.ts";

/** Project's created fact, as project's log holds it, live or from its backfill. */
function projectCreated({
  projectId,
  organizationId = "org-1",
  adminUserId,
  occurredAt,
  backfilled,
}: Readonly<{
  projectId: string;
  organizationId?: string;
  adminUserId?: string | null;
  occurredAt: number;
  backfilled?: true;
}>): ReplayEvent {
  return ownerFact({
    type: PROJECT_CREATED_EVENT_TYPE,
    aggregateType: PROJECT_AGGREGATE_TYPE,
    aggregateId: projectId,
    tenantId: projectId,
    data: {
      tenantId: projectId,
      projectId,
      organizationId,
      occurredAt,
      ...(adminUserId === undefined ? {} : { adminUserId }),
      ...(backfilled ? { backfilled } : {}),
    },
  });
}

/** Organization's created fact for one organization. */
function organizationCreated(organizationId: string, occurredAt: number): ReplayEvent {
  return ownerFact({
    type: ORGANIZATION_CREATED_EVENT_TYPE,
    aggregateType: ORGANIZATION_AGGREGATE_TYPE,
    aggregateId: organizationId,
    tenantId: organizationId,
    data: { tenantId: organizationId, organizationId, organizationName: "Acme", occurredAt },
  });
}

/** What the three copies hold for the named projects and organizations. */
async function copiedRows({
  repositories,
  projectIds,
  organizationIds,
}: Readonly<{
  repositories: NurturingRepositories;
  projectIds: readonly string[];
  organizationIds: readonly string[];
}>) {
  const placements = await Promise.all(
    projectIds.map((projectId) => repositories.placements.getPlacement({ projectId })),
  );
  const organizations = await Promise.all(
    organizationIds.map(async (organizationId) => ({
      projects: (await repositories.placements.findProjectIds({ organizationId })).toSorted(),
      created: await repositories.organizationsCreated.findOrganizationCreatedAt({
        organizationId,
      }),
      row: await repositories.milestones.findOrganization({ organizationId }),
    })),
  );
  return { placements, organizations };
}

/** What live delivery of the facts, one at a time in the given order, leaves in the copies. */
async function liveRows({
  facts,
  projectIds,
  organizationIds,
}: Readonly<{ facts: readonly ReplayEvent[]; projectIds: string[]; organizationIds: string[] }>) {
  const repositories = MemoryNurturingRepositories.create();
  const deliver = liveMapsOver(copiesOver(repositories));
  for (const fact of facts) await deliver(fact);
  return copiedRows({ repositories, projectIds, organizationIds });
}

/** The facts of two organizations' projects, some from project's backfill, admins at several stamps. */
function organizationsLog(): ReplayEvent[] {
  return [
    organizationCreated("org-1", 500),
    organizationCreated("org-2", 700),
    projectCreated({ projectId: "p-1", adminUserId: "admin-a", occurredAt: 1_000 }),
    projectCreated({ projectId: "p-2", adminUserId: "admin-b", occurredAt: 3_000 }),
    projectCreated({ projectId: "p-3", adminUserId: null, occurredAt: 4_000, backfilled: true }),
    projectCreated({
      projectId: "p-4",
      organizationId: "org-2",
      adminUserId: "admin-c",
      occurredAt: 2_000,
      backfilled: true,
    }),
  ];
}

const PROJECTS = ["p-1", "p-2", "p-3", "p-4", "p-never"];
const ORGANIZATIONS = ["org-1", "org-2", "org-never"];

describe("given owner logs holding projects and organizations created before the copies existed", () => {
  /** @scenario "Projects and organizations created before the copies existed are copied at deploy" */
  it("fills the placement, creation and admin copies as live delivery of the same facts would", async () => {
    const facts = organizationsLog();
    const worker = copiesDeploy({ events: facts });

    await worker.runAll();

    const rows = await copiedRows({
      repositories: worker.repositories,
      projectIds: PROJECTS,
      organizationIds: ORGANIZATIONS,
    });
    expect(rows).toEqual(
      await liveRows({ facts, projectIds: PROJECTS, organizationIds: ORGANIZATIONS }),
    );
    expect(rows.organizations[0]).toMatchObject({
      projects: ["p-1", "p-2", "p-3"],
      created: { organizationCreatedAt: 500 },
      row: [{ adminUserId: "admin-b", seeded: true }],
    });
    expect(rows.placements[4]).toEqual({ outcome: "unknown" });
  });

  /** @scenario "Replaying the organization copies twice leaves every row as it was" */
  it("leaves every row byte-identical when each step runs again, trailing pass included", async () => {
    const worker = copiesDeploy({ events: organizationsLog() });
    await worker.runAll();
    const read = () =>
      copiedRows({
        repositories: worker.repositories,
        projectIds: PROJECTS,
        organizationIds: ORGANIZATIONS,
      });
    const first = JSON.stringify(await read());

    for (const step of [PLACEMENTS_STEP, ORGANIZATIONS_CREATED_STEP, ADMINS_STEP]) {
      await worker.run(step);
    }

    expect(JSON.stringify(await read())).toBe(first);
  });
});

describe("given the copies' facts delivered live", () => {
  /** @scenario "Each organization copy ends the same whatever order its facts land in, however often" */
  it("leaves the same rows in reverse order and when every fact is delivered twice", async () => {
    const facts = organizationsLog();
    const forward = await liveRows({ facts, projectIds: PROJECTS, organizationIds: ORGANIZATIONS });

    const reverse = await liveRows({
      facts: facts.toReversed(),
      projectIds: PROJECTS,
      organizationIds: ORGANIZATIONS,
    });
    const twice = await liveRows({
      facts: facts.flatMap((fact) => [fact, fact]),
      projectIds: PROJECTS,
      organizationIds: ORGANIZATIONS,
    });

    expect(reverse).toEqual(forward);
    expect(twice).toEqual(forward);
  });
});

describe("given an organization's admin was erased", () => {
  const erased = "admin-erased";
  const keptAdmin = () =>
    projectCreated({ projectId: "p-1", adminUserId: "admin-a", occurredAt: 1_000 });
  const facts = () => [
    keptAdmin(),
    projectCreated({ projectId: "p-2", adminUserId: erased, occurredAt: 3_000 }),
  ];
  const adminOf = async (repositories: NurturingRepositories) =>
    (await repositories.milestones.findOrganization({ organizationId: "org-1" }))[0]?.adminUserId;

  /** @scenario "The deploy replay names no admin erased before the copy existed" */
  it("names no erased admin when the steps run in the declared order", async () => {
    const worker = copiesDeploy({ events: [...facts(), userErasedFact(erased)] });

    await worker.runAll();

    // The erased admin's later stamp is written as no one, so the earlier admin is not restored.
    expect(await adminOf(worker.repositories)).toBeNull();
  });

  /** @scenario "The deploy replay names no admin erased before the copy existed" */
  it("leaves no admin erased while the admin step replays, whether written before or after", async () => {
    const repositories = MemoryNurturingRepositories.create();
    let erasedOnce = false;
    const worker = copiesDeploy({
      events: facts(),
      repositories,
      copies: {
        ...copiesOver(repositories),
        admins: {
          recordAdminFact: async (input) => {
            await repositories.milestones.recordAdminFact(input);
            if (erasedOnce) return;
            erasedOnce = true;
            await repositories.milestones.forgetAdmin({ adminUserId: erased });
          },
        },
      },
    });

    await worker.run(ADMINS_STEP);

    expect(await adminOf(repositories)).toBeNull();
  });

  /** @scenario "A late project-created fact naming an erased admin names no one" */
  it("writes the erased admin nowhere when a later live fact names them", async () => {
    const worker = copiesDeploy({ events: [keptAdmin(), userErasedFact(erased)] });
    await worker.runAll();
    const deliver = liveMapsOver(copiesOver(worker.repositories));

    await deliver(projectCreated({ projectId: "p-late", adminUserId: erased, occurredAt: 9_000 }));

    expect(await adminOf(worker.repositories)).toBeNull();
  });
});

describe("given a deployment with a Customer.io channel", () => {
  /** @scenario "Replaying the organization copies sends nothing" */
  it("runs no sync when the copies replay over facts a live delivery would sync", async () => {
    const sync = {
      usageChanged: vi.fn(async () => undefined),
      tracesChanged: vi.fn(async () => undefined),
      organizationCreated: vi.fn(async () => undefined),
    };
    const worker = copiesDeploy({ events: organizationsLog(), sync });

    await worker.runAll();

    expect(sync.organizationCreated).not.toHaveBeenCalled();
    expect(sync.usageChanged).not.toHaveBeenCalled();
    expect(sync.tracesChanged).not.toHaveBeenCalled();
    await expect(
      worker.repositories.organizationsCreated.findOrganizationCreatedAt({
        organizationId: "org-1",
      }),
    ).resolves.toEqual({ organizationCreatedAt: 500 });
  });
});
