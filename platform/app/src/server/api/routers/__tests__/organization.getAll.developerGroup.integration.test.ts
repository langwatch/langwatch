/**
 * @vitest-environment node
 *
 * ADR-143: a Developer seat is granted nothing through a group or an
 * organisation-wide binding. The engine enforces that; this pins the
 * workspace listing (`organization.getAll`) to the same rule, so a Developer
 * sitting in a group bound to a shared team is not shown that team, and a
 * group holding the organisation admin role does not promote their seat.
 */

import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { KSUID_RESOURCES } from "~/utils/constants";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "../../../app-layer/presets";
import { traced } from "../../../app-layer/tracing";
import { prisma } from "../../../db";
import { PromptTagRepository } from "../../../prompt-config/repositories/prompt-tag.repository";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("organization.getAll for a Developer in a group", () => {
  const ns = `dev-group-${nanoid(8)}`;
  const emails = {
    developer: `developer-${ns}@test.com`,
    member: `member-${ns}@test.com`,
  };
  let organizationId: string;
  let sharedTeamId: string;
  let developerCaller: ReturnType<typeof appRouter.createCaller>;
  let memberCaller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Developer Group Org", slug: `--test-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "Shared", slug: `shared-${ns}`, organizationId },
    });
    sharedTeamId = team.id;

    const developer = await prisma.user.create({
      data: { email: emails.developer, name: "Developer" },
    });
    const member = await prisma.user.create({
      data: { email: emails.member, name: "Member" },
    });
    await prisma.organizationUser.createMany({
      data: [
        {
          userId: developer.id,
          organizationId,
          role: OrganizationUserRole.DEVELOPER,
        },
        {
          userId: member.id,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      ],
    });

    const teamGroup = await prisma.group.create({
      data: {
        id: generate(KSUID_RESOURCES.GROUP).toString(),
        name: `Team group ${ns}`,
        slug: `team-group-${ns}`,
        organizationId,
      },
    });
    const adminGroup = await prisma.group.create({
      data: {
        id: generate(KSUID_RESOURCES.GROUP).toString(),
        name: `Admin group ${ns}`,
        slug: `admin-group-${ns}`,
        organizationId,
      },
    });
    await prisma.groupMembership.createMany({
      data: [
        { userId: developer.id, groupId: teamGroup.id },
        { userId: member.id, groupId: teamGroup.id },
        { userId: developer.id, groupId: adminGroup.id },
      ],
    });
    await seedRoleBinding(prisma, {
      id: `rb-team-${nanoid(8)}`,
      organizationId,
      groupId: teamGroup.id,
      role: TeamUserRole.MEMBER,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: sharedTeamId,
    });
    await seedRoleBinding(prisma, {
      id: `rb-admin-${nanoid(8)}`,
      organizationId,
      groupId: adminGroup.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    });

    resetAuthzGrantsCommandsForTests();
    globalForApp.__langwatch_app = createTestApp({
      _eventSourcing: createAuthzTestEventSourcing(prisma),
      organizations: traced(
        new OrganizationService(
          new PrismaOrganizationRepository(prisma),
          new PromptTagRepository(prisma),
        ),
        "OrganizationService",
      ),
    });

    developerCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: developer.id }, expires: "1" },
      }),
    );
    memberCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: member.id }, expires: "1" },
      }),
    );
  });

  afterAll(async () => {
    await resetApp();
    resetAuthzGrantsCommandsForTests();
    await cleanupTestRows(prisma, [
      ["groupMembership", { group: { organizationId } }],
      ["grant", { organizationId }],
      ["roleBinding", { organizationId }],
      ["group", { organizationId }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { email: { in: Object.values(emails) } }],
    ]);
  });

  describe("when the Developer lists their workspace", () => {
    /** @scenario A Developer never sees a shared project */
    it("omits the shared team the group is bound to", async () => {
      const result = await developerCaller.organization.getAll({});
      const org = result.find((o) => o.id === organizationId);

      expect(org?.teams.map((t) => t.id)).not.toContain(sharedTeamId);
    });

    it("keeps the Developer seat despite the group's organisation admin role", async () => {
      const result = await developerCaller.organization.getAll({});
      const org = result.find((o) => o.id === organizationId);

      expect(org?.members[0]?.role).toBe(OrganizationUserRole.DEVELOPER);
    });
  });

  describe("when a Member in the same group lists their workspace", () => {
    it("shows the shared team with the group's role", async () => {
      const result = await memberCaller.organization.getAll({});
      const team = result
        .find((o) => o.id === organizationId)
        ?.teams.find((t) => t.id === sharedTeamId);

      expect(team?.members).toEqual([
        expect.objectContaining({ role: TeamUserRole.MEMBER }),
      ]);
    });
  });
});
