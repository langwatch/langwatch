/**
 * @vitest-environment node
 *
 * Every virtual key stores the project its traces and costs land in,
 * against real Postgres.
 *
 * Per-key spend is read from the trace path, so a key whose traces land
 * nowhere is invisible in every usage view and accrues against no budget.
 * These tests pin the four cases creation decides between, the three
 * refusals, and the two things the stored answer changed: editing a key's
 * scopes does not move its destination, and deleting the project a key
 * traces into does not reroute it.
 *
 * Spec: specs/ai-gateway/virtual-key-creation.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { createTestApp } from "~/server/app-layer/presets";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { loadTraceDestinationFacts, toVirtualKeySnakeDto } from "../virtualKey.dto";
import { VirtualKeyRepository } from "@langwatch/gateway-server";
import { VirtualKeyService } from "../virtualKey.service";

const suffix = nanoid(8);
const projects = createTestApp().projects;

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

// An org where projects have been deleted. Deletion is soft, so every row
// below is still readable and the only thing telling it apart from a live
// project is `archivedAt`.
const ORG_ARCH_ID = `org-vktp-arch-${suffix}`;
const TEAM_ARCH_ID = `team-vktp-arch-${suffix}`;
const ARCH_GOV_PROJECT_ID = `proj-vktp-arch-gov-${suffix}`;
const ARCH_DELETED_PROJECT_ID = `proj-vktp-arch-deleted-${suffix}`;
// Live at seed, deleted partway through the test that needs a destination
// to disappear from under a key that already exists.
const ARCH_DOOMED_PROJECT_ID = `proj-vktp-arch-doomed-${suffix}`;

// An org whose older governance project and only application project have
// both been deleted: nothing here is nameable but the newer inbox.
const ORG_GOVARCH_ID = `org-vktp-govarch-${suffix}`;
const TEAM_GOVARCH_ID = `team-vktp-govarch-${suffix}`;
const GOVARCH_OLD_GOV_ID = `proj-vktp-govarch-old-${suffix}`;
const GOVARCH_LIVE_GOV_ID = `proj-vktp-govarch-live-${suffix}`;
const GOVARCH_DELETED_APP_ID = `proj-vktp-govarch-app-${suffix}`;

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

    await prisma.organization.create({
      data: {
        id: ORG_ARCH_ID,
        name: `VKTP Arch ${suffix}`,
        slug: `vktp-arch-${suffix}`,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ARCH_ID,
        name: `VKTP Arch Team ${suffix}`,
        slug: `vktp-arch-team-${suffix}`,
        organizationId: ORG_ARCH_ID,
      },
    });
    await prisma.organization.create({
      data: {
        id: ORG_GOVARCH_ID,
        name: `VKTP GovArch ${suffix}`,
        slug: `vktp-govarch-${suffix}`,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_GOVARCH_ID,
        name: `VKTP GovArch Team ${suffix}`,
        slug: `vktp-govarch-team-${suffix}`,
        organizationId: ORG_GOVARCH_ID,
      },
    });
    // `createdAt` is set by hand rather than left to insertion order: the
    // governance rule picks the oldest, and two rows written in the same
    // millisecond would make which one it picks a coin toss.
    for (const [id, teamId, kind, archivedAt, createdAt] of [
      [ARCH_GOV_PROJECT_ID, TEAM_ARCH_ID, "internal_governance", null, null],
      [
        ARCH_DELETED_PROJECT_ID,
        TEAM_ARCH_ID,
        "application",
        new Date("2026-01-01T00:00:00Z"),
        null,
      ],
      [ARCH_DOOMED_PROJECT_ID, TEAM_ARCH_ID, "application", null, null],
      [
        GOVARCH_OLD_GOV_ID,
        TEAM_GOVARCH_ID,
        "internal_governance",
        new Date("2026-01-01T00:00:00Z"),
        new Date("2025-01-01T00:00:00Z"),
      ],
      [
        GOVARCH_LIVE_GOV_ID,
        TEAM_GOVARCH_ID,
        "internal_governance",
        null,
        new Date("2025-06-01T00:00:00Z"),
      ],
      [
        GOVARCH_DELETED_APP_ID,
        TEAM_GOVARCH_ID,
        "application",
        new Date("2026-01-01T00:00:00Z"),
        null,
      ],
    ] as const) {
      await prisma.project.create({
        data: {
          id,
          name: id,
          slug: id,
          teamId,
          language: "en",
          framework: "openai",
          apiKey: `key-${id}`,
          kind,
          archivedAt,
          ...(createdAt ? { createdAt } : {}),
        },
      });
    }

    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vktp.local`, name: "VKTP" },
    });
  }, 120_000);

  afterAll(async () => {
    const orgIds = [ORG_BARE_ID, ORG_GOV_ID, ORG_CHOICE_ID, ORG_ARCH_ID, ORG_GOVARCH_ID];
    const teamIds = [
      TEAM_BARE_ID,
      TEAM_GOV_ID,
      TEAM_CHOICE_ID,
      TEAM_ARCH_ID,
      TEAM_GOVARCH_ID,
    ];
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
    await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await stopTestContainers();
  }, 120_000);

  /** @scenario "A key owned above a project is refused until its traces have a home" */
  it("refuses creating an org- or team-owned key when no trace project resolves", async () => {
    const service = VirtualKeyService.create(prisma, projects);

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
      const service = VirtualKeyService.create(prisma, projects);

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
      const service = VirtualKeyService.create(prisma, projects);

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
      const service = VirtualKeyService.create(prisma, projects);

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

  describe("given the destination a key names is not one of this organization's", () => {
    /** @scenario "A destination that is named has to be one that exists" */
    it("refuses a project belonging to another organization, and writes nothing", async () => {
      const service = VirtualKeyService.create(prisma, projects);
      const name = `foreign-destination-${suffix}`;

      const refusal = await service
        .create({
          organizationId: ORG_CHOICE_ID,
          name,
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
      // Scoped to this key's own name rather than to the organization's
      // count: every other test in the file writes keys into the same
      // organization, so a count would only hold while this one ran first.
      expect(
        await prisma.virtualKey.count({
          where: { organizationId: ORG_CHOICE_ID, name },
        }),
      ).toBe(0);
    });

    it("refuses a project that does not exist at all", async () => {
      const service = VirtualKeyService.create(prisma, projects);

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

  describe("given a project the customer has deleted", () => {
    /** @scenario "A project that was deleted is no longer a destination" */
    it("refuses a create that names it, and writes nothing", async () => {
      const service = VirtualKeyService.create(prisma, projects);
      const name = `deleted-destination-${suffix}`;

      const refusal = await service
        .create({
          organizationId: ORG_ARCH_ID,
          name,
          actorUserId: USER_ID,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ARCH_ID }],
          traceProjectId: ARCH_DELETED_PROJECT_ID,
        })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "gateway_trace_project_unknown" });
      expect(
        await prisma.virtualKey.count({
          where: { organizationId: ORG_ARCH_ID, name },
        }),
      ).toBe(0);
    });

    /** @scenario "A key whose destination is deleted later keeps sending traces there" */
    /** @scenario "A deleted destination is badged wherever the key is read" */
    it("keeps a key pointed at a destination deleted afterwards, and says it is gone", async () => {
      const service = VirtualKeyService.create(prisma, projects);
      const repo = new VirtualKeyRepository(prisma);
      const { virtualKey } = await service.create({
        organizationId: ORG_ARCH_ID,
        name: `doomed-destination-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ARCH_ID }],
        traceProjectId: ARCH_DOOMED_PROJECT_ID,
      });

      await prisma.project.update({
        where: { id: ARCH_DOOMED_PROJECT_ID },
        data: { archivedAt: new Date() },
      });

      // The write path refuses this shape, the read path must not: the
      // deletion happened on another screen. Rerouting would scatter one
      // key's history across two projects, and failing would take its
      // traffic down. The materialiser follows the pointer as it stands.
      const vk = await repo.findById(virtualKey.id, ORG_ARCH_ID);
      const followed = vk!.traceProjectId
        ? await projects.tryGetTraceDestination(vk!.traceProjectId)
        : null;
      expect(followed?.id).toBe(ARCH_DOOMED_PROJECT_ID);

      // And the state is surfaced rather than acted on, which is the only
      // way a reader can tell: the project still answers, and the traces
      // still arrive.
      const dto = toVirtualKeySnakeDto({
        virtualKey: vk!,
        facts: await loadTraceDestinationFacts({
          projects,
          virtualKeys: [vk!],
        }),
      });
      expect(dto.trace_project_id).toBe(ARCH_DOOMED_PROJECT_ID);
      expect(dto.trace_project_archived).toBe(true);
    });
  });

  describe("given an organization whose projects have all been deleted", () => {
    /** @scenario "An organization whose projects were all deleted can still create a shared key" */
    it("creates a shared key rather than demanding it choose between none", async () => {
      const service = VirtualKeyService.create(prisma, projects);

      const { virtualKey } = await service.create({
        organizationId: ORG_GOVARCH_ID,
        name: `govarch-shared-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_GOVARCH_ID }],
      });

      // Not the older inbox, which is deleted, and not the deleted
      // application project, which is what the ambiguity refusal would have
      // told the creator to name.
      expect(virtualKey.traceProjectId).toBe(GOVARCH_LIVE_GOV_ID);
    });

    /** @scenario "A key scoped only to a deleted project cannot take it as a destination" */
    it("passes over a single project scope naming a deleted project", async () => {
      const service = VirtualKeyService.create(prisma, projects);

      const { virtualKey } = await service.create({
        organizationId: ORG_GOVARCH_ID,
        name: `govarch-scoped-deleted-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: GOVARCH_DELETED_APP_ID }],
      });

      expect(virtualKey.traceProjectId).toBe(GOVARCH_LIVE_GOV_ID);
    });
  });

  /** @scenario "The governance inbox is a home for a shared key's traces" */
  it("stores the governance project on org- and team-owned keys", async () => {
    const service = VirtualKeyService.create(prisma, projects);

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

    for (const vk of [orgKey, teamKey]) {
      expect(vk.traceProjectId).toBe(GOV_PROJECT_ID);
    }
  });

  /** @scenario "Moving a key above the project it was scoped to keeps its traces there" */
  it("keeps the destination when the key is re-scoped above its project", async () => {
    const service = VirtualKeyService.create(prisma, projects);
    const { virtualKey } = await service.create({
      organizationId: ORG_BARE_ID,
      name: `projected-${suffix}`,
      actorUserId: USER_ID,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_BARE_ID }],
    });
    expect(virtualKey.traceProjectId).toBe(PROJECT_BARE_ID);

    // This used to be refused, because the destination came from the scope
    // the edit was taking away. It comes from the key now, so the edit takes
    // nothing away and there is nothing to refuse.
    const updated = await service.update({
      id: virtualKey.id,
      organizationId: ORG_BARE_ID,
      actorUserId: USER_ID,
      name: `projected-renamed-${suffix}`,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_BARE_ID }],
    });

    expect(updated.name).toBe(`projected-renamed-${suffix}`);
    expect(updated.traceProjectId).toBe(PROJECT_BARE_ID);
    expect(updated.scopes.map((s) => s.scopeType)).toEqual(["ORGANIZATION"]);
  });

  /** @scenario "Clearing a key's destination is refused when it leaves nowhere for its traces" */
  it("refuses clearing the destination of a shared key that has projects to choose from", async () => {
    const service = VirtualKeyService.create(prisma, projects);
    const { virtualKey } = await service.create({
      organizationId: ORG_CHOICE_ID,
      name: `cleared-${suffix}`,
      actorUserId: USER_ID,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_CHOICE_ID }],
      traceProjectId: CHOICE_PROJECT_A_ID,
    });

    await expect(
      service.update({
        id: virtualKey.id,
        organizationId: ORG_CHOICE_ID,
        actorUserId: USER_ID,
        name: `cleared-renamed-${suffix}`,
        traceProjectId: null,
      }),
    ).rejects.toMatchObject({ code: "gateway_trace_project_ambiguous" });

    // The whole update rolled back: destination kept, rename included.
    const after = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: virtualKey.id },
    });
    expect(after.name).toBe(`cleared-${suffix}`);
    expect(after.traceProjectId).toBe(CHOICE_PROJECT_A_ID);
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
    const service = VirtualKeyService.create(prisma, projects);

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

  describe("when a key reaches its destination each of the ways it can", () => {
    /** @scenario "A key that names a destination stores the one it names" */
    /** @scenario "A key owned by one project stores that project as its destination" */
    it("stores the answer rather than leaving it to be worked out per read", async () => {
      const service = VirtualKeyService.create(prisma, projects);

      const named = await service.create({
        organizationId: ORG_CHOICE_ID,
        name: `stored-named-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_CHOICE_ID }],
        traceProjectId: CHOICE_PROJECT_B_ID,
      });
      const scoped = await service.create({
        organizationId: ORG_CHOICE_ID,
        name: `stored-scoped-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: CHOICE_PROJECT_A_ID }],
      });

      // Read off the rows, not off the returned objects: the column is what
      // every later read follows.
      const rows = await prisma.virtualKey.findMany({
        where: { id: { in: [named.virtualKey.id, scoped.virtualKey.id] } },
        select: { id: true, traceProjectId: true },
        orderBy: { name: "asc" },
      });
      expect(rows).toEqual([
        { id: named.virtualKey.id, traceProjectId: CHOICE_PROJECT_B_ID },
        { id: scoped.virtualKey.id, traceProjectId: CHOICE_PROJECT_A_ID },
      ]);
    });

    /** @scenario "A live destination reads back as present, not deleted" */
    it("reads a live destination back without the deleted flag", async () => {
      const service = VirtualKeyService.create(prisma, projects);
      const repo = new VirtualKeyRepository(prisma);
      const { virtualKey } = await service.create({
        organizationId: ORG_CHOICE_ID,
        name: `stored-live-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "PROJECT", scopeId: CHOICE_PROJECT_A_ID }],
      });

      const vk = await repo.findById(virtualKey.id, ORG_CHOICE_ID);
      const dto = toVirtualKeySnakeDto({
        virtualKey: vk!,
        facts: await loadTraceDestinationFacts({
          projects,
          virtualKeys: [vk!],
        }),
      });
      expect(dto.trace_project_id).toBe(CHOICE_PROJECT_A_ID);
      expect(dto.trace_project_archived).toBe(false);
    });
  });

  describe("when a key is edited after it has a destination", () => {
    /** @scenario "Changing which teams a key is scoped to leaves its destination alone" */
    it("leaves the destination where it is when the scopes change", async () => {
      const service = VirtualKeyService.create(prisma, projects);
      const { virtualKey } = await service.create({
        organizationId: ORG_CHOICE_ID,
        name: `rescoped-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_CHOICE_ID }],
        traceProjectId: CHOICE_PROJECT_A_ID,
      });

      // A scope edit that the old derivation would have answered
      // differently: one PROJECT scope naming another project used to win
      // the moment the explicit destination stopped resolving, and the
      // team scope changed which team the spend was counted under.
      const updated = await service.update({
        id: virtualKey.id,
        organizationId: ORG_CHOICE_ID,
        actorUserId: USER_ID,
        scopes: [
          { scopeType: "TEAM", scopeId: TEAM_CHOICE_ID },
          { scopeType: "PROJECT", scopeId: CHOICE_PROJECT_B_ID },
        ],
      });

      expect(updated.traceProjectId).toBe(CHOICE_PROJECT_A_ID);
    });

    /** @scenario "Naming a new destination on an update moves it, and is validated the same way" */
    it("moves the destination when one is named, and refuses one that is not live here", async () => {
      const service = VirtualKeyService.create(prisma, projects);
      const { virtualKey } = await service.create({
        organizationId: ORG_CHOICE_ID,
        name: `removed-${suffix}`,
        actorUserId: USER_ID,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_CHOICE_ID }],
        traceProjectId: CHOICE_PROJECT_A_ID,
      });

      const moved = await service.update({
        id: virtualKey.id,
        organizationId: ORG_CHOICE_ID,
        actorUserId: USER_ID,
        traceProjectId: CHOICE_PROJECT_B_ID,
      });
      expect(moved.traceProjectId).toBe(CHOICE_PROJECT_B_ID);

      const refusal = await service
        .update({
          id: virtualKey.id,
          organizationId: ORG_CHOICE_ID,
          actorUserId: USER_ID,
          traceProjectId: PROJECT_BARE_ID,
        })
        .catch((error: unknown) => error);
      expect(refusal).toMatchObject({ code: "gateway_trace_project_unknown" });

      // The refused update rolled back whole: the destination it would have
      // moved to is not where the key points.
      const after = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: virtualKey.id },
      });
      expect(after.traceProjectId).toBe(CHOICE_PROJECT_B_ID);
    });
  });
});
