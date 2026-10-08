/**
 * Who a team is left with once group-delivered administration is counted.
 *
 * A Developer seat gets nothing through a group (ADR-143), so a Developer in
 * an admin group must not be the administrator a last-admin guard says a team
 * still has.
 *
 * Spec: specs/members/developer-seat.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import {
  computeEffectiveAdminUserIds,
  isUserAdminViaGroup,
} from "../effective-team-admins";
import { TeamService } from "../team.service";

wireDefaultTestApp();

describe("effective team admins through a group", () => {
  const ns = `team-group-admins-${nanoid(8)}`;

  const teamSlug = `--test-team-${ns}`;
  let organizationId: string;
  let teamId: string;
  let memberUserId: string;
  let developerUserId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Group Admins Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: "Shared Team", slug: teamSlug, organizationId },
    });
    teamId = team.id;

    const [member, developer] = await Promise.all([
      prisma.user.create({
        data: { email: `gmember-${ns}@example.com`, name: "Group Member" },
      }),
      prisma.user.create({
        data: { email: `gdev-${ns}@example.com`, name: "Group Developer" },
      }),
    ]);
    memberUserId = member.id;
    developerUserId = developer.id;

    await prisma.organizationUser.createMany({
      data: [
        {
          userId: memberUserId,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
        {
          userId: developerUserId,
          organizationId,
          role: OrganizationUserRole.DEVELOPER,
        },
      ],
    });

    const group = await prisma.group.create({
      data: { name: "Team admins", slug: `--test-group-${ns}`, organizationId },
    });
    await prisma.groupMembership.createMany({
      data: [
        { userId: memberUserId, groupId: group.id },
        { userId: developerUserId, groupId: group.id },
      ],
    });
    await seedRoleBinding(prisma, {
      organizationId,
      groupId: group.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    });
  });

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["grant", { organizationId }],
      ["roleBinding", { organizationId }],
      ["groupMembership", { group: { organizationId } }],
      ["group", { organizationId }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["user", { email: { contains: ns } }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("when a Member and a Developer sit in the same admin group", () => {
    /** @scenario A Developer never sees a shared project */
    it("counts the Member as an admin and not the Developer", async () => {
      const admins = await computeEffectiveAdminUserIds({
        tx: prisma,
        organizationId,
        teamId,
      });

      expect(admins.has(memberUserId)).toBe(true);
      expect(admins.has(developerUserId)).toBe(false);
    });

    it("lists the Member on the team and not the Developer", async () => {
      const teams = await new TeamService({ prisma }).getTeamsWithRoleBindings({
        organizationId,
      });

      const listed = (
        teams.find((team) => team.slug === teamSlug)?.directMembers ?? []
      ).map((m) => m.userId);
      expect(listed).toContain(memberUserId);
      expect(listed).not.toContain(developerUserId);
    });

    it("answers the same for one person asked directly", async () => {
      await expect(
        isUserAdminViaGroup({
          tx: prisma,
          organizationId,
          teamId,
          userId: memberUserId,
        }),
      ).resolves.toBe(true);
      await expect(
        isUserAdminViaGroup({
          tx: prisma,
          organizationId,
          teamId,
          userId: developerUserId,
        }),
      ).resolves.toBe(false);
    });
  });
});
