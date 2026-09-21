/**
 * @vitest-environment node
 * @integration
 *
 * Who a project is called when it appears as a contributor, resolved against
 * the real tenancy rows rather than a fixture: a personal workspace is one
 * person and is named by them, a shared project is named by itself.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { resolveCallerProjectScope } from "../resolveCallerProjectScope";

const ns = nanoid(8);

let organization: Organization;
let sharedTeam: Team;
let callerUserId: string;
/** The caller's own workspace, whose only member carries a display name. */
let namedWorkspaceId: string;
/** A workspace whose only member has an email address and no name. */
let unnamedWorkspaceId: string;
/** A personal workspace nobody is a member of. */
let memberlessWorkspaceId: string;
/** A workspace whose membership row points at a user that no longer exists. */
let orphanedWorkspaceId: string;
/** A project belonging to the whole team rather than to one person. */
let sharedProjectId: string;
let personalTeamIds: string[];

async function createProject({
  name,
  teamId,
  isPersonal,
  ownerUserId,
}: {
  name: string;
  teamId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
}) {
  return prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name,
      slug: `--test-${nanoid(6)}-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: `sk-lw-${nanoid(48)}`,
      teamId,
      isPersonal,
      ownerUserId,
    },
  });
}

async function createPersonalWorkspace({
  name,
  member,
}: {
  name: string;
  member: { id: string; join: boolean };
}) {
  const team = await prisma.team.create({
    data: {
      name,
      slug: `--test-team-${nanoid(6)}-${ns}`,
      organizationId: organization.id,
      isPersonal: true,
      ownerUserId: member.id,
    },
  });
  if (member.join) {
    await prisma.teamUser.create({
      data: { userId: member.id, teamId: team.id, role: TeamUserRole.ADMIN },
    });
  }
  const project = await createProject({
    name,
    teamId: team.id,
    isPersonal: true,
    ownerUserId: member.id,
  });
  return { teamId: team.id, projectId: project.id };
}

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: `scope-${ns}`, slug: `--test-org-${ns}` },
  });
  sharedTeam = await prisma.team.create({
    data: {
      name: `scope-${ns}`,
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });

  const caller = await prisma.user.create({
    data: { name: "Riley Chase", email: `caller-${ns}@example.com` },
  });
  callerUserId = caller.id;
  const unnamed = await prisma.user.create({
    data: { name: null, email: `unnamed-${ns}@example.com` },
  });
  const absent = await prisma.user.create({
    data: { name: "Nobody Home", email: `absent-${ns}@example.com` },
  });
  await prisma.organizationUser.createMany({
    data: [caller.id, unnamed.id, absent.id].map((userId) => ({
      userId,
      organizationId: organization.id,
      role: OrganizationUserRole.ADMIN,
    })),
  });
  // Org-wide admin, so every project below is genuinely readable and the map
  // is exercised over all of them rather than over the one the caller owns.
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: organization.id,
      userId: callerUserId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organization.id,
    },
  });

  const named = await createPersonalWorkspace({
    name: "Riley Chase's workspace",
    member: { id: caller.id, join: true },
  });
  namedWorkspaceId = named.projectId;
  const withoutName = await createPersonalWorkspace({
    name: "Unnamed workspace",
    member: { id: unnamed.id, join: true },
  });
  unnamedWorkspaceId = withoutName.projectId;
  const memberless = await createPersonalWorkspace({
    name: "Abandoned workspace",
    member: { id: absent.id, join: false },
  });
  memberlessWorkspaceId = memberless.projectId;
  // No foreign keys in the schema, so this membership row simply dangles,
  // the way a real one does after its user row is deleted.
  const orphaned = await createPersonalWorkspace({
    name: "Orphaned workspace",
    member: { id: `user_gone_${ns}`, join: true },
  });
  orphanedWorkspaceId = orphaned.projectId;
  personalTeamIds = [
    named.teamId,
    withoutName.teamId,
    memberless.teamId,
    orphaned.teamId,
  ];

  const shared = await createProject({
    name: "Gateway",
    teamId: sharedTeam.id,
    isPersonal: false,
    ownerUserId: null,
  });
  sharedProjectId = shared.id;
});

afterAll(async () => {
  const orgUsers = await prisma.organizationUser
    .findMany({ where: { organizationId: organization.id } })
    .catch(() => []);
  const teams = await prisma.team
    .findMany({ where: { organizationId: organization.id } })
    .catch(() => []);
  const teamIds = teams.map((team) => team.id);
  await cleanupTestRows(prisma, [
    ["roleBinding", { organizationId: organization.id }],
    ["teamUser", { teamId: { in: teamIds } }],
    ["project", { teamId: { in: teamIds } }],
    ["organizationUser", { organizationId: organization.id }],
    ["user", { id: { in: orgUsers.map((orgUser) => orgUser.userId) } }],
    ["team", { id: { in: teamIds } }],
    ["organization", { id: organization.id }],
  ]);
});

describe("Feature: the caller's project scope", () => {
  describe("given personal workspaces and a shared project in one organization", () => {
    /** @scenario "A personal workspace resolves to the person who owns it" */
    it("names each workspace by its person and the shared project by itself", async () => {
      const scope = await resolveCallerProjectScope({
        userId: callerUserId,
        organizationId: organization.id,
        prisma,
      });

      expect(scope.projects[namedWorkspaceId]).toMatchObject({
        contributorLabel: "Riley Chase",
        isPersonal: true,
        isLinkable: false,
      });
      expect(scope.projects[sharedProjectId]).toMatchObject({
        contributorLabel: "Gateway",
        isPersonal: false,
        isLinkable: true,
      });
      // The slug is what a linked name opens, so it travels with the label.
      expect(scope.projects[sharedProjectId]?.slug).toBeTruthy();
    });

    /** @scenario "A person with no display name is named by their email address" */
    it("falls back to the email address when a person has no name", async () => {
      const scope = await resolveCallerProjectScope({
        userId: callerUserId,
        organizationId: organization.id,
        prisma,
      });

      expect(scope.projects[unnamedWorkspaceId]?.contributorLabel).toBe(
        `unnamed-${ns}@example.com`,
      );
    });

    /** @scenario "A personal workspace nobody is a member of keeps its own name" */
    it("falls back to the workspace's own name, still unlinked, when it has no member", async () => {
      const scope = await resolveCallerProjectScope({
        userId: callerUserId,
        organizationId: organization.id,
        prisma,
      });

      expect(scope.projects[memberlessWorkspaceId]).toMatchObject({
        contributorLabel: "Abandoned workspace",
        isLinkable: false,
      });
    });

    /** @scenario "A membership row that outlives its user still resolves the scope" */
    it("names the workspace by itself when its membership row outlives its user", async () => {
      const scope = await resolveCallerProjectScope({
        userId: callerUserId,
        organizationId: organization.id,
        prisma,
      });

      expect(scope.projects[orphanedWorkspaceId]).toMatchObject({
        contributorLabel: "Orphaned workspace",
        isLinkable: false,
      });
    });

    /** @scenario "Members are read for personal teams alone" */
    it("asks for members once, and only for the personal teams", async () => {
      const findMany = vi.spyOn(prisma.teamUser, "findMany");

      try {
        await resolveCallerProjectScope({
          userId: callerUserId,
          organizationId: organization.id,
          prisma,
        });

        const scopeCalls = findMany.mock.calls.filter(
          (call) =>
            (call[0]?.where?.teamId as { in?: string[] } | undefined)?.in !==
            undefined,
        );
        expect(scopeCalls).toHaveLength(1);
        const asked = (
          scopeCalls[0]![0]!.where!.teamId as { in: string[] }
        ).in.slice();
        expect(asked.sort()).toEqual([...personalTeamIds].sort());
      } finally {
        findMany.mockRestore();
      }
    });
  });
});
