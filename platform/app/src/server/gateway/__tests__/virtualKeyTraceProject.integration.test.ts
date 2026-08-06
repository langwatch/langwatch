/**
 * @vitest-environment node
 *
 * Every virtual key must resolve a project for its traces to land in,
 * against real Postgres.
 *
 * Debits ride the gateway's spend commands and no longer depend on this,
 * but a key whose traces land nowhere is invisible in every usage view,
 * and per-key spend is read from the trace path.
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
import { toVirtualKeySnakeDto } from "../virtualKey.dto";
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

// An org with a governance project AND real projects, so a key owned above
// a project has somewhere it could have named and the fallback is a guess.
const ORG_CHOICE_ID = `org-vktp-choice-${suffix}`;
const TEAM_CHOICE_ID = `team-vktp-choice-${suffix}`;
const CHOICE_GOV_PROJECT_ID = `proj-vktp-choice-gov-${suffix}`;
const CHOICE_PROJECT_A_ID = `proj-vktp-choice-a-${suffix}`;
const CHOICE_PROJECT_B_ID = `proj-vktp-choice-b-${suffix}`;

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

    await prisma.organization.create({
      data: {
        id: ORG_CHOICE_ID,
        name: `VKTP Choice ${suffix}`,
        slug: `vktp-choice-${suffix}`,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_CHOICE_ID,
        name: `VKTP Choice Team ${suffix}`,
        slug: `vktp-choice-team-${suffix}`,
        organizationId: ORG_CHOICE_ID,
      },
    });
    for (const [id, kind] of [
      [CHOICE_GOV_PROJECT_ID, "internal_governance"],
      [CHOICE_PROJECT_A_ID, "application"],
      [CHOICE_PROJECT_B_ID, "application"],
    ] as const) {
      await prisma.project.create({
        data: {
          id,
          name: id,
          slug: id,
          teamId: TEAM_CHOICE_ID,
          language: "en",
          framework: "openai",
          apiKey: `key-${id}`,
          kind,
        },
      });
    }

    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vktp.local`, name: "VKTP" },
    });
  }, 120_000);

  afterAll(async () => {
    const orgIds = [ORG_BARE_ID, ORG_GOV_ID, ORG_CHOICE_ID];
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
      where: { teamId: { in: [TEAM_BARE_ID, TEAM_GOV_ID, TEAM_CHOICE_ID] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [TEAM_BARE_ID, TEAM_GOV_ID, TEAM_CHOICE_ID] } },
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
    ).rejects.toMatchObject({ code: "trace_project_required" });

    await expect(
      service.create({
        organizationId: ORG_BARE_ID,
        name: `homeless-team-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "TEAM", scopeId: TEAM_BARE_ID }],
      }),
    ).rejects.toMatchObject({ code: "trace_project_required" });

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

  describe("when the organization has projects the key could have named", () => {
    /** @scenario "A shared key must say where its traces land once there is a choice" */
    it("refuses an org- or team-owned key that names no destination", async () => {
      const service = VirtualKeyService.create(prisma);

      for (const scope of [
        { scopeType: "ORGANIZATION" as const, scopeId: ORG_CHOICE_ID },
        { scopeType: "TEAM" as const, scopeId: TEAM_CHOICE_ID },
      ]) {
        const refusal = await service
          .create({
            organizationId: ORG_CHOICE_ID,
            name: `unnamed-${scope.scopeType}-${suffix}`,
            actorUserId: USER_ID,
            scopes: [scope],
          })
          .catch((error: unknown) => error);

        expect(refusal).toMatchObject({
          code: "gateway_trace_project_ambiguous",
          httpStatus: 400,
          fault: "customer",
        });
      }

      // A refusal that left the key behind would be worse than no refusal.
      const keys = await prisma.virtualKey.findMany({
        where: { organizationId: ORG_CHOICE_ID },
      });
      expect(keys).toHaveLength(0);
    });

    /** @scenario "A key that reaches several projects must pick one for its traces" */
    it("refuses a key scoped to two projects with no destination named", async () => {
      const service = VirtualKeyService.create(prisma);

      const refusal = await service
        .create({
          organizationId: ORG_CHOICE_ID,
          name: `two-projects-${suffix}`,
          actorUserId: USER_ID,
          scopes: [
            { scopeType: "PROJECT", scopeId: CHOICE_PROJECT_A_ID },
            { scopeType: "PROJECT", scopeId: CHOICE_PROJECT_B_ID },
          ],
        })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "gateway_trace_project_ambiguous",
        meta: { project_scope_count: 2 },
      });
    });

    it("accepts the same key once it names where its traces land", async () => {
      const service = VirtualKeyService.create(prisma);

      const { virtualKey } = await service.create({
        organizationId: ORG_CHOICE_ID,
        name: `named-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_CHOICE_ID }],
        traceProjectId: CHOICE_PROJECT_A_ID,
      });

      expect(virtualKey.traceProjectId).toBe(CHOICE_PROJECT_A_ID);
    });
  });

  describe("when the destination a key names is not one of this organization's", () => {
    /** @scenario "A destination that is named has to be one that exists" */
    it("refuses a project belonging to another organization, and writes nothing", async () => {
      const service = VirtualKeyService.create(prisma);
      const before = await prisma.virtualKey.count({
        where: { organizationId: ORG_CHOICE_ID },
      });

      const refusal = await service
        .create({
          organizationId: ORG_CHOICE_ID,
          name: `foreign-destination-${suffix}`,
          actorUserId: USER_ID,
          // A real project, of a different organization. Resolution would
          // otherwise fall through to this key's single project scope and
          // save it attributing traffic to CHOICE_PROJECT_A_ID while the
          // stored destination went on naming somebody else's project.
          scopes: [{ scopeType: "PROJECT", scopeId: CHOICE_PROJECT_A_ID }],
          traceProjectId: PROJECT_BARE_ID,
        })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "gateway_trace_project_unknown" });
      expect(
        await prisma.virtualKey.count({
          where: { organizationId: ORG_CHOICE_ID },
        }),
      ).toBe(before);
    });

    it("refuses a project that does not exist at all", async () => {
      const service = VirtualKeyService.create(prisma);

      const refusal = await service
        .create({
          organizationId: ORG_CHOICE_ID,
          name: `deleted-destination-${suffix}`,
          actorUserId: USER_ID,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_CHOICE_ID }],
          traceProjectId: `proj-vktp-gone-${suffix}`,
        })
        .catch((error: unknown) => error);

      // Same refusal as a foreign project on purpose: telling the two apart
      // would confirm which project ids exist somewhere else.
      expect(refusal).toMatchObject({ code: "gateway_trace_project_unknown" });
    });
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
    ).rejects.toMatchObject({ code: "trace_project_required" });

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
    ).rejects.toMatchObject({ code: "trace_project_required" });

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

  describe("when keys reach their destination three different ways", () => {
    /** @scenario "A key says which rule decides where its traces land" */
    it("reports which rule answered for each", async () => {
      const service = VirtualKeyService.create(prisma);
      const repo = new VirtualKeyRepository(prisma);

      const named = await service.create({
        organizationId: ORG_CHOICE_ID,
        name: `source-named-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_CHOICE_ID }],
        traceProjectId: CHOICE_PROJECT_B_ID,
      });
      const scoped = await service.create({
        organizationId: ORG_CHOICE_ID,
        name: `source-scoped-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: CHOICE_PROJECT_A_ID }],
      });
      // The third shape can no longer be created, so it is written the way
      // the keys that carry it were: before the rule existed.
      const legacy = await service.create({
        organizationId: ORG_GOV_ID,
        name: `source-legacy-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_GOV_ID }],
      });

      const sources = await Promise.all(
        [
          [named.virtualKey.id, ORG_CHOICE_ID],
          [scoped.virtualKey.id, ORG_CHOICE_ID],
          [legacy.virtualKey.id, ORG_GOV_ID],
        ].map(async ([id, orgId]) => {
          const vk = await repo.findById(id!, orgId!);
          return toVirtualKeySnakeDto(vk!).trace_project_source;
        }),
      );

      expect(sources).toEqual([
        "explicit",
        "project_scope",
        "governance_fallback",
      ]);
    });
  });
});
