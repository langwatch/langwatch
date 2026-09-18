/**
 * @vitest-environment node
 *
 * When a personal workspace goes, and what happens if its owner comes back.
 *
 * Refusing to archive a personal workspace directly is only defensible because
 * there is one moment when it does go, and `PERSONAL_TEAM_ARCHIVE_REFUSAL` names
 * it: these workspaces "disappear with the member's access to the organization".
 * Nothing made that true. Removing a membership took the `OrganizationUser` row
 * and every role binding with it and left the team and project behind, owned by
 * somebody who is no longer a member and still holding their one slot per
 * (organization, owner).
 *
 * Which is why the two halves are tested together. Archiving alone would brick
 * the slot: the partial unique index enforcing it covers archived rows, while
 * every lookup filters `archivedAt: null`, so a re-invited member's provisioning
 * would find nothing and then fail to create a replacement. `ensure()` has to
 * recognise its own archived workspace and revive it, binding included, because
 * removing the membership deleted the one that made it reachable.
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import { hasProjectPermission } from "~/server/app-layer/authz/permission-adapters";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { PersonalWorkspaceService } from "../../../../../ee/governance/services/personalWorkspace.service";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "../../../app-layer/presets";
import { prisma } from "../../../db";
import { PromptTagRepository } from "../../../prompt-config/repositories/prompt-tag.repository";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const ns = `pw-lifecycle-${nanoid(8)}`;
const adminEmail = `${ns}-admin@example.com`;
const leaverEmail = `${ns}-leaver@example.com`;

let organizationId: string;
let adminUserId: string;
let leaverUserId: string;
let workspaceService: PersonalWorkspaceService;
let personalTeamId: string;
let personalProjectId: string;
let groupId: string;

const callerAsAdmin = () =>
  appRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: adminUserId, name: "Org Admin", email: adminEmail },
        expires: "1",
      } as any,
    }),
  );

const ensureLeaverWorkspace = () =>
  workspaceService.ensure({
    userId: leaverUserId,
    organizationId,
    displayName: "Leaver",
    displayEmail: leaverEmail,
  });

const workspaceRows = () =>
  prisma.team.findUnique({
    where: { id: personalTeamId },
    select: {
      archivedAt: true,
      projects: { select: { id: true, archivedAt: true } },
    },
  });

describe("given a member with a personal workspace in an organization", () => {
  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: "Org Admin", email: adminEmail },
    });
    adminUserId = admin.id;
    const leaver = await prisma.user.create({
      data: { name: "Leaver", email: leaverEmail },
    });
    leaverUserId = leaver.id;

    const organization = await prisma.organization.create({
      data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    await prisma.organizationUser.create({
      data: {
        userId: adminUserId,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.organizationUser.create({
      data: {
        userId: leaverUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await seedRoleBinding(prisma, {
      userId: adminUserId,
      organizationId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    });

    workspaceService = new PersonalWorkspaceService(prisma);
    const workspace = await ensureLeaverWorkspace();
    personalTeamId = workspace.team.id;
    personalProjectId = workspace.project.id;

    const group = await prisma.group.create({
      data: {
        organizationId,
        name: `Removal group ${ns}`,
        slug: `removal-group-${ns}`,
        members: { create: [{ userId: leaverUserId }] },
      },
    });
    groupId = group.id;
    await seedRoleBinding(prisma, {
      groupId,
      organizationId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    });

    // A real organization service against the test database: `createTestApp`
    // defaults to a NullOrganizationRepository that resolves without writing,
    // and every assertion below is about what the removal left behind.
    await resetApp();
    resetAuthzGrantsCommandsForTests();
    globalForApp.__langwatch_app = createTestApp({
      _eventSourcing: createAuthzTestEventSourcing(prisma),
      organizations: new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        new PromptTagRepository(prisma),
      ),
    });
  });

  afterAll(async () => {
    await resetApp();
    await cleanupTestRows(prisma, [
      ["project", { teamId: personalTeamId }],
      ["teamUser", { teamId: personalTeamId }],
      ["grant", { organizationId }],
      ["roleBinding", { organizationId }],
      ["groupMembership", { groupId }],
      ["group", { id: groupId }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
    ]);
    const created = [adminUserId, leaverUserId].filter(Boolean);
    if (created.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: created } } });
    }
  });

  describe("when an admin removes that member from the organization", () => {
    beforeAll(async () => {
      await callerAsAdmin().organization.deleteMember({
        organizationId,
        userId: leaverUserId,
      });
    });

    /** @scenario Removing a member takes their personal workspace with them */
    it("archives the workspace team", async () => {
      await expect(workspaceRows()).resolves.toMatchObject({
        archivedAt: expect.any(Date),
      });
    });

    /** @scenario Removing a member takes their personal workspace with them */
    it("archives its project with it", async () => {
      const rows = await workspaceRows();
      expect(rows?.projects).toEqual([
        { id: personalProjectId, archivedAt: expect.any(Date) },
      ]);
    });

    /** @scenario Removing a member takes their personal workspace with them */
    it("removes the member from every organization group during offboarding", async () => {
      await expect(
        prisma.groupMembership.findUnique({
          where: { userId_groupId: { userId: leaverUserId, groupId } },
        }),
      ).resolves.toBeNull();
    });

    it("keeps the shared group binding for the group's remaining members", async () => {
      await expect(
        prisma.grant.findFirst({
          where: {
            organizationId,
            principalType: "GROUP",
            principalId: groupId,
            revokedAt: null,
          },
          select: { id: true },
        }),
      ).resolves.toMatchObject({ id: expect.any(String) });
    });

    it("leaves nothing an admin still has to clean up", async () => {
      // The whole point of archiving here: no live personal workspace remains in
      // the organization for a user who is no longer in it.
      await expect(
        prisma.team.findFirst({
          where: {
            organizationId,
            ownerUserId: leaverUserId,
            isPersonal: true,
            archivedAt: null,
          },
        }),
      ).resolves.toBeNull();
    });

    describe("when that member joins the organization again", () => {
      beforeAll(async () => {
        await prisma.organizationUser.create({
          data: {
            userId: leaverUserId,
            organizationId,
            role: OrganizationUserRole.MEMBER,
          },
        });
      });

      /** @scenario Inviting a removed member back gives them their workspace again */
      it("hands back the same workspace rather than a new one", async () => {
        // Not merely "a workspace exists": the same team and project ids, which
        // is the difference between reviving the slot and having quietly
        // sidestepped the uniqueness that made this hard.
        await expect(ensureLeaverWorkspace()).resolves.toMatchObject({
          created: false,
          team: { id: personalTeamId },
          project: { id: personalProjectId },
        });
      });

      /** @scenario Inviting a removed member back gives them their workspace again */
      it("gives them back the access to reach it", async () => {
        await ensureLeaverWorkspace();

        // Removing the membership deleted the owner's admin binding along with
        // every other one, so a revival that only cleared `archivedAt` would
        // hand back a workspace they cannot open.
        await expect(
          hasProjectPermission(
            {
              prisma,
              session: {
                user: {
                  id: leaverUserId,
                  name: "Leaver",
                  email: leaverEmail,
                },
                expires: "1",
              } as any,
            },
            personalProjectId,
            "datasets:create",
          ),
        ).resolves.toBe(true);
      });
    });
  });
});
