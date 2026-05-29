/**
 * @vitest-environment node
 *
 * Scope-aware RBAC for the VirtualKey write paths. Real Postgres test
 * container, no mocks. Every persona is an OrganizationUser.role=MEMBER
 * carrying ONLY an explicit CUSTOM RoleBinding at a specific scope — so a
 * pass here can never come from the legacy TeamUserRole.ADMIN short-circuit
 * (the @no-short-circuit invariant in the feature file).
 *
 * Contract:
 *   - create authorizes virtualKeys:manage on EVERY requested scope
 *     (upward cascade: a broader grant covers narrower scopes).
 *   - update / rotate / delete authorize the op permission on AT LEAST ONE
 *     of the key's existing scopes.
 *
 * Spec: specs/ai-gateway/governance/vk-scope-rbac.feature
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../../db";
import { appRouter } from "../../root";
import type { Permission } from "../../rbac";
import { createInnerTRPCContext } from "../../trpc";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";

type Caller = ReturnType<typeof appRouter.createCaller>;

describe("virtualKeys — scope-aware RBAC", () => {
  const ns = `vkrbac-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const TEAM_PLATFORM = `team-platform-${ns}`;
  const TEAM_DATA_SCI = `team-datasci-${ns}`;
  const PROJECT_DEMO = `proj-demo-${ns}`;
  const PROJECT_ML_PROD = `proj-mlprod-${ns}`;
  const OWNER_ID = `usr-owner-${ns}`;

  let seq = 0;

  /**
   * Seed an org MEMBER whose only grant is a CUSTOM RoleBinding carrying
   * `permissions` at each of `scopes`. Returns a tRPC caller for them.
   */
  async function seedUser(
    perms: Permission[],
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[],
  ): Promise<Caller> {
    const uid = `usr-${ns}-${seq++}`;
    const email = `${uid}@example.com`;
    await prisma.user.create({ data: { id: uid, email, name: uid } });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: uid,
        role: OrganizationUserRole.MEMBER,
      },
    });
    const roleId = `crole-${uid}`;
    await prisma.customRole.create({
      data: {
        id: roleId,
        organizationId: ORG_ID,
        name: roleId,
        permissions: perms,
      },
    });
    for (const scope of scopes) {
      await prisma.roleBinding.create({
        data: {
          organizationId: ORG_ID,
          userId: uid,
          role: TeamUserRole.CUSTOM,
          customRoleId: roleId,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
        },
      });
    }
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: uid, email, name: uid },
          expires: new Date(Date.now() + 3_600_000).toISOString(),
        } as any,
      }),
    );
  }

  /**
   * Seed an org MEMBER whose visibility comes purely from membership rows
   * (OrganizationUser + TeamUser), with NO RoleBinding and NO
   * virtualKeys:view grant. Proves list visibility is membership-based,
   * not permission-based.
   */
  async function seedTeamMember(teamIds: string[]): Promise<Caller> {
    const uid = `usr-mem-${ns}-${seq++}`;
    const email = `${uid}@example.com`;
    await prisma.user.create({ data: { id: uid, email, name: uid } });
    await prisma.organizationUser.create({
      data: {
        organizationId: ORG_ID,
        userId: uid,
        role: OrganizationUserRole.MEMBER,
      },
    });
    for (const teamId of teamIds) {
      await prisma.teamUser.create({
        data: { userId: uid, teamId, role: TeamUserRole.MEMBER },
      });
    }
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: uid, email, name: uid },
          expires: new Date(Date.now() + 3_600_000).toISOString(),
        } as any,
      }),
    );
  }

  async function seedVk(
    name: string,
    scopes: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[],
  ): Promise<string> {
    const id = `vk-${ns}-${name}`;
    await prisma.virtualKey.create({
      data: {
        id,
        organizationId: ORG_ID,
        name,
        hashedSecret: `hash-${id}`,
        displayPrefix: "vk-lw-SEED",
        createdById: OWNER_ID,
        config: {},
        scopes: { create: scopes },
      },
    });
    return id;
  }

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG_ID, name: ns, slug: ORG_ID },
    });
    await prisma.user.create({
      data: { id: OWNER_ID, email: `owner-${ns}@example.com`, name: OWNER_ID },
    });
    for (const [tid, slug] of [
      [TEAM_PLATFORM, `platform-${ns}`],
      [TEAM_DATA_SCI, `datasci-${ns}`],
    ] as const) {
      await prisma.team.create({
        data: { id: tid, name: tid, slug, organizationId: ORG_ID },
      });
    }
    for (const [pid, tid, slug] of [
      [PROJECT_DEMO, TEAM_PLATFORM, `demo-${ns}`],
      [PROJECT_ML_PROD, TEAM_DATA_SCI, `mlprod-${ns}`],
    ] as const) {
      await prisma.project.create({
        data: {
          id: pid,
          name: pid,
          slug,
          teamId: tid,
          language: "en",
          framework: "openai",
          apiKey: `key-${slug}`,
        },
      });
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.project.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  const ORG = RoleBindingScopeType.ORGANIZATION;
  const TEAM = RoleBindingScopeType.TEAM;
  const PROJECT = RoleBindingScopeType.PROJECT;

  describe("given create authorizes virtualKeys:manage per requested scope", () => {
    /** @scenario Creating an ORG-scoped VK requires virtualKeys:manage at ORGANIZATION scope */
    it("allows an ORG-manage holder to create an ORG-scoped VK", async () => {
      const alice = await seedUser(["virtualKeys:manage"], [{ scopeType: ORG, scopeId: ORG_ID }]);
      const res = await alice.virtualKeys.create({
        organizationId: ORG_ID,
        name: "alice-org",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });
      expect(res.virtualKey.scopes).toEqual([
        expect.objectContaining({ scopeType: "ORGANIZATION", scopeId: ORG_ID }),
      ]);
    });

    /** @scenario Creating an ORG-scoped VK without org:manage on virtualKeys is rejected */
    it("rejects an ORG-scoped create from a team-only manage holder", async () => {
      const bob = await seedUser(["virtualKeys:manage"], [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }]);
      await expect(
        bob.virtualKeys.create({
          organizationId: ORG_ID,
          name: "bob-org",
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining(`virtualKeys:manage at ORGANIZATION:${ORG_ID}`),
      });
    });

    /** @scenario Creating a TEAM-scoped VK requires virtualKeys:manage at that team */
    it("allows a team-manage holder to create a TEAM-scoped VK", async () => {
      const carol = await seedUser(["virtualKeys:manage"], [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }]);
      const res = await carol.virtualKeys.create({
        organizationId: ORG_ID,
        name: "carol-team",
        scopes: [{ scopeType: "TEAM", scopeId: TEAM_PLATFORM }],
      });
      expect(res.virtualKey.id).toBeTruthy();
    });

    /** @scenario User with TEAM "platform" perm cannot create a VK in TEAM "data-sci" */
    it("rejects creating a VK in a team the caller does not manage", async () => {
      const carol = await seedUser(["virtualKeys:manage"], [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }]);
      await expect(
        carol.virtualKeys.create({
          organizationId: ORG_ID,
          name: "carol-cross",
          scopes: [{ scopeType: "TEAM", scopeId: TEAM_DATA_SCI }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    /** @scenario Creating a PROJECT-scoped VK requires virtualKeys:manage at that project (or upward) */
    it("allows a project-manage holder to create a PROJECT-scoped VK", async () => {
      const dave = await seedUser(["virtualKeys:manage"], [{ scopeType: PROJECT, scopeId: PROJECT_DEMO }]);
      const res = await dave.virtualKeys.create({
        organizationId: ORG_ID,
        name: "dave-proj",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_DEMO }],
      });
      expect(res.virtualKey.id).toBeTruthy();
    });
  });

  describe("given the upward cascade (broader grant covers narrower scopes)", () => {
    /** @scenario virtualKeys:manage at ORGANIZATION scope allows creating VKs at any narrower scope */
    it("lets an ORG-manage holder create at team, project, and org scopes", async () => {
      const eve = await seedUser(["virtualKeys:manage"], [{ scopeType: ORG, scopeId: ORG_ID }]);
      for (const scope of [
        { scopeType: "TEAM" as const, scopeId: TEAM_PLATFORM },
        { scopeType: "PROJECT" as const, scopeId: PROJECT_DEMO },
        { scopeType: "ORGANIZATION" as const, scopeId: ORG_ID },
      ]) {
        const res = await eve.virtualKeys.create({
          organizationId: ORG_ID,
          name: `eve-${scope.scopeType}`,
          scopes: [scope],
        });
        expect(res.virtualKey.id).toBeTruthy();
      }
    });

    /** @scenario virtualKeys:manage at TEAM scope allows creating VKs at projects within that team */
    it("lets a team-manage holder create at projects within the team but not outside", async () => {
      const frank = await seedUser(["virtualKeys:manage"], [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }]);
      const ok = await frank.virtualKeys.create({
        organizationId: ORG_ID,
        name: "frank-in-team",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_DEMO }],
      });
      expect(ok.virtualKey.id).toBeTruthy();
      await expect(
        frank.virtualKeys.create({
          organizationId: ORG_ID,
          name: "frank-out-team",
          scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ML_PROD }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given a multi-scope create needs manage on every scope", () => {
    /** @scenario Creating a VK with multiple scopes requires manage on EACH scope (intersection of grants) */
    it("rejects when the caller manages only one of the requested scopes", async () => {
      const grace = await seedUser(["virtualKeys:manage"], [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }]);
      await expect(
        grace.virtualKeys.create({
          organizationId: ORG_ID,
          name: "grace-multi",
          scopes: [
            { scopeType: "TEAM", scopeId: TEAM_PLATFORM },
            { scopeType: "TEAM", scopeId: TEAM_DATA_SCI },
          ],
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining(`virtualKeys:manage at TEAM:${TEAM_DATA_SCI}`),
      });
    });

    /** @scenario User with manage at both teams can create the cross-team VK */
    it("allows the cross-team create when the caller manages both teams", async () => {
      const henry = await seedUser(
        ["virtualKeys:manage"],
        [
          { scopeType: TEAM, scopeId: TEAM_PLATFORM },
          { scopeType: TEAM, scopeId: TEAM_DATA_SCI },
        ],
      );
      const res = await henry.virtualKeys.create({
        organizationId: ORG_ID,
        name: "henry-multi",
        scopes: [
          { scopeType: "TEAM", scopeId: TEAM_PLATFORM },
          { scopeType: "TEAM", scopeId: TEAM_DATA_SCI },
        ],
      });
      expect(res.virtualKey.scopes).toHaveLength(2);
    });
  });

  describe("given organizationId must own every requested scope", () => {
    /** @scenario A create cannot bind a scope from a different org than its organizationId */
    it("rejects a create whose organizationId differs from a team scope's org", async () => {
      // Caller legitimately manages TEAM_PLATFORM in ORG_ID, so the
      // per-scope manage gate passes — only the org-ownership check stops
      // the cross-org write.
      const caller = await seedUser(["virtualKeys:manage"], [
        { scopeType: TEAM, scopeId: TEAM_PLATFORM },
      ]);
      await expect(
        caller.virtualKeys.create({
          organizationId: `org-foreign-${ns}`,
          name: "cross-org-create",
          scopes: [{ scopeType: "TEAM", scopeId: TEAM_PLATFORM }],
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("scope_org_mismatch"),
      });
    });

    /** @scenario An ORGANIZATION scope must equal the organizationId */
    it("rejects a create whose ORGANIZATION scope differs from organizationId", async () => {
      const caller = await seedUser(["virtualKeys:manage"], [
        { scopeType: ORG, scopeId: ORG_ID },
      ]);
      await expect(
        caller.virtualKeys.create({
          organizationId: `org-foreign-${ns}`,
          name: "cross-org-orgscope",
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("scope_org_mismatch"),
      });
    });
  });

  describe("given update / rotate / delete authorize the op-perm on one existing scope", () => {
    /** @scenario Updating a VK requires virtualKeys:update at one of the VK's scopes */
    it("allows an update-holder on the VK's team to rename it", async () => {
      const vkId = await seedVk("update-target", [{ scopeType: "PROJECT", scopeId: PROJECT_DEMO }]);
      const ian = await seedUser(["virtualKeys:update"], [{ scopeType: PROJECT, scopeId: PROJECT_DEMO }]);
      const res = await ian.virtualKeys.update({
        organizationId: ORG_ID,
        id: vkId,
        name: "renamed",
      });
      expect(res.name).toBe("renamed");
    });

    /** @scenario Rotating a VK requires virtualKeys:rotate */
    it("allows a rotate-holder on the VK's team to rotate it", async () => {
      const vkId = await seedVk("rotate-target", [{ scopeType: "TEAM", scopeId: TEAM_PLATFORM }]);
      const jane = await seedUser(["virtualKeys:rotate"], [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }]);
      const before = await prisma.virtualKey.findUniqueOrThrow({ where: { id: vkId } });
      const res = await jane.virtualKeys.rotate({ organizationId: ORG_ID, id: vkId });
      expect(res.secret).toBeTruthy();
      const after = await prisma.virtualKey.findUniqueOrThrow({ where: { id: vkId } });
      expect(after.revision).toBeGreaterThan(before.revision);
    });

    /** @scenario Deleting a VK requires virtualKeys:delete at one of the VK's scopes */
    it("rejects a delete from a view-only holder", async () => {
      const vkId = await seedVk("delete-target", [{ scopeType: "TEAM", scopeId: TEAM_PLATFORM }]);
      const karen = await seedUser(["virtualKeys:view"], [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }]);
      await expect(
        karen.virtualKeys.revoke({ organizationId: ORG_ID, id: vkId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given list visibility intersects the caller's membership set", () => {
    /** @scenario A user sees VKs whose scopes intersect their membership set */
    it("includes org + own-team VKs and excludes a sibling team's VK", async () => {
      const vkOrg = await seedVk("list-org", [
        { scopeType: "ORGANIZATION", scopeId: ORG_ID },
      ]);
      const vkPlatform = await seedVk("list-platform", [
        { scopeType: "TEAM", scopeId: TEAM_PLATFORM },
      ]);
      const vkDataSci = await seedVk("list-datasci", [
        { scopeType: "TEAM", scopeId: TEAM_DATA_SCI },
      ]);
      const olive = await seedTeamMember([TEAM_PLATFORM]);
      const ids = (await olive.virtualKeys.list({ organizationId: ORG_ID })).map(
        (vk) => vk.id,
      );
      expect(ids).toContain(vkOrg);
      expect(ids).toContain(vkPlatform);
      expect(ids).not.toContain(vkDataSci);
    });

    it("returns NOT_FOUND on get for a key outside the caller's membership", async () => {
      const vkDataSci = await seedVk("get-datasci", [
        { scopeType: "TEAM", scopeId: TEAM_DATA_SCI },
      ]);
      const olive = await seedTeamMember([TEAM_PLATFORM]);
      await expect(
        olive.virtualKeys.get({ organizationId: ORG_ID, id: vkDataSci }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("given the no-short-circuit invariant", () => {
    /** @scenario New VK routes work for a non-ADMIN user with explicit perm grants */
    it("lets a MEMBER with only a project-scoped manage grant create a VK", async () => {
      const noShortcut = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: PROJECT, scopeId: PROJECT_DEMO }],
      );
      const res = await noShortcut.virtualKeys.create({
        organizationId: ORG_ID,
        name: "no-shortcut",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_DEMO }],
      });
      expect(res.virtualKey.id).toBeTruthy();
    });
  });
});
