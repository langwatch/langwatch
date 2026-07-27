/**
 * @vitest-environment node
 *
 * Every virtual key must resolve a project for its traces and costs to
 * land in, against real Postgres.
 *
 * Budget spend is accrued from the trace fold, so a key whose traces land
 * nowhere accrues nothing against ANY budget, the org-wide cap included.
 * These tests pin the write-path refusal (`trace_project_required`) on
 * create, on the update that would remove the destination, and on edits
 * to keys that predate the rule, plus the governance-project fallback
 * that makes org/team ownership legal without a hand-picked project.
 *
 * Spec: specs/ai-gateway/virtual-key-creation.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { resolveTraceProject } from "../scopeResolver";
import { VirtualKeyRepository } from "../virtualKey.repository";
import { VirtualKeyService } from "../virtualKey.service";

const suffix = nanoid(8);

// An org with no governance project: nothing above a project can resolve
// a trace destination here.
const ORG_BARE_ID = `org-vktp-bare-${suffix}`;
const TEAM_BARE_ID = `team-vktp-bare-${suffix}`;
const PROJECT_BARE_ID = `proj-vktp-bare-${suffix}`;

// An org whose governance project is the fallback destination for keys
// owned above a project.
const ORG_GOV_ID = `org-vktp-gov-${suffix}`;
const TEAM_GOV_ID = `team-vktp-gov-${suffix}`;
const GOV_PROJECT_ID = `proj-vktp-gov-${suffix}`;

const USER_ID = `usr-vktp-${suffix}`;

describe("virtual keys must have a home for their traces (real PG)", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: {
        id: ORG_BARE_ID,
        name: `VKTP Bare ${suffix}`,
        slug: `vktp-bare-${suffix}`,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_BARE_ID,
        name: `VKTP Bare Team ${suffix}`,
        slug: `vktp-bare-team-${suffix}`,
        organizationId: ORG_BARE_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_BARE_ID,
        name: `VKTP Bare Project ${suffix}`,
        slug: `vktp-bare-proj-${suffix}`,
        teamId: TEAM_BARE_ID,
        language: "en",
        framework: "openai",
        apiKey: `vktp-bare-key-${suffix}`,
      },
    });

    await prisma.organization.create({
      data: {
        id: ORG_GOV_ID,
        name: `VKTP Gov ${suffix}`,
        slug: `vktp-gov-${suffix}`,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_GOV_ID,
        name: `VKTP Gov Team ${suffix}`,
        slug: `vktp-gov-team-${suffix}`,
        organizationId: ORG_GOV_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: GOV_PROJECT_ID,
        name: `VKTP Governance ${suffix}`,
        slug: `vktp-gov-proj-${suffix}`,
        teamId: TEAM_GOV_ID,
        language: "en",
        framework: "openai",
        apiKey: `vktp-gov-key-${suffix}`,
        kind: "internal_governance",
      },
    });

    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vktp.local`, name: "VKTP" },
    });
  }, 120_000);

  afterAll(async () => {
    const orgIds = [ORG_BARE_ID, ORG_GOV_ID];
    await prisma.auditLog.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.virtualKey.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [PROJECT_BARE_ID, GOV_PROJECT_ID] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [TEAM_BARE_ID, TEAM_GOV_ID] } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await stopTestContainers();
  }, 120_000);

  /** @scenario "A key owned above a project is refused until its traces have a home" */
  it("refuses creating an org- or team-owned key when no trace project resolves", async () => {
    const service = VirtualKeyService.create(prisma);

    await expect(
      service.create({
        organizationId: ORG_BARE_ID,
        name: `homeless-org-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_BARE_ID }],
        // The cap that could never accrue a cent: proves the refusal
        // rolls back the whole transaction, budget included.
        budget: { limitUsd: "10.00", window: "DAY" },
      }),
    ).rejects.toThrow(/trace_project_required/);

    await expect(
      service.create({
        organizationId: ORG_BARE_ID,
        name: `homeless-team-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "TEAM", scopeId: TEAM_BARE_ID }],
      }),
    ).rejects.toThrow(/trace_project_required/);

    // Neither the keys nor the budget survived the refusal.
    const keys = await prisma.virtualKey.findMany({
      where: {
        organizationId: ORG_BARE_ID,
        name: { in: [`homeless-org-${suffix}`, `homeless-team-${suffix}`] },
      },
    });
    expect(keys).toHaveLength(0);
    const budgets = await prisma.gatewayBudget.findMany({
      where: { organizationId: ORG_BARE_ID, scopeType: "VIRTUAL_KEY" },
    });
    expect(budgets).toHaveLength(0);
  });

  /** @scenario "The governance inbox is a home for a shared key's traces" */
  it("resolves org- and team-owned keys to the governance project", async () => {
    const service = VirtualKeyService.create(prisma);
    const repo = new VirtualKeyRepository(prisma);

    const { virtualKey: orgKey } = await service.create({
      organizationId: ORG_GOV_ID,
      name: `shared-org-${suffix}`,
      actorUserId: USER_ID,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_GOV_ID }],
    });
    const { virtualKey: teamKey } = await service.create({
      organizationId: ORG_GOV_ID,
      name: `shared-team-${suffix}`,
      actorUserId: USER_ID,
      scopes: [{ scopeType: "TEAM", scopeId: TEAM_GOV_ID }],
    });

    for (const id of [orgKey.id, teamKey.id]) {
      const vk = await repo.findById(id, ORG_GOV_ID);
      const traceProject = await resolveTraceProject(prisma, vk!);
      expect(traceProject?.id).toBe(GOV_PROJECT_ID);
    }
  });

  /** @scenario "A key cannot be updated into dropping its traces" */
  it("refuses the re-scope that would remove the trace destination, keeping the key intact", async () => {
    const service = VirtualKeyService.create(prisma);
    const { virtualKey } = await service.create({
      organizationId: ORG_BARE_ID,
      name: `projected-${suffix}`,
      actorUserId: USER_ID,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_BARE_ID }],
    });

    await expect(
      service.update({
        id: virtualKey.id,
        organizationId: ORG_BARE_ID,
        actorUserId: USER_ID,
        name: `projected-renamed-${suffix}`,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_BARE_ID }],
      }),
    ).rejects.toThrow(/trace_project_required/);

    // The whole update rolled back: scopes untouched, rename included.
    const after = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
      include: { scopes: true },
    });
    expect(after.name).toBe(`projected-${suffix}`);
    expect(after.scopes).toEqual([
      expect.objectContaining({
        scopeType: "PROJECT",
        scopeId: PROJECT_BARE_ID,
      }),
    ]);
  });

  /** @scenario "A key that predates this rule must be given a home before it changes" */
  it("blocks edits to a legacy homeless key until it gets a home, while revoke stays open", async () => {
    // Seeded directly, the way keys created before the rule exist in the
    // database: org-owned, no project scope, org without governance.
    const legacyEditId = `vk_vktp_legacy_edit_${suffix}`;
    const legacyRevokeId = `vk_vktp_legacy_revoke_${suffix}`;
    for (const [id, name] of [
      [legacyEditId, `legacy-edit-${suffix}`],
      [legacyRevokeId, `legacy-revoke-${suffix}`],
    ] as const) {
      await prisma.virtualKey.create({
        data: {
          id,
          organizationId: ORG_BARE_ID,
          name,
          hashedSecret: `hash-${id}`,
          displayPrefix: "vk-lw-leg",
          createdById: USER_ID,
          scopes: {
            create: [{ scopeType: "ORGANIZATION", scopeId: ORG_BARE_ID }],
          },
        },
      });
    }
    const service = VirtualKeyService.create(prisma);

    // A plain rename is refused: the next touch has to close the hole.
    await expect(
      service.update({
        id: legacyEditId,
        organizationId: ORG_BARE_ID,
        actorUserId: USER_ID,
        name: `legacy-edit-renamed-${suffix}`,
      }),
    ).rejects.toThrow(/trace_project_required/);

    // The update that gives its traces a home goes through, and carries
    // the rest of the edit with it.
    const fixed = await service.update({
      id: legacyEditId,
      organizationId: ORG_BARE_ID,
      actorUserId: USER_ID,
      name: `legacy-edit-renamed-${suffix}`,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_BARE_ID }],
    });
    expect(fixed.name).toBe(`legacy-edit-renamed-${suffix}`);

    // Revoking never demands a destination: killing the key is the other
    // way of closing the hole.
    const revoked = await service.revoke({
      id: legacyRevokeId,
      organizationId: ORG_BARE_ID,
      actorUserId: USER_ID,
    });
    expect(revoked.status).toBe("REVOKED");
  });
});
