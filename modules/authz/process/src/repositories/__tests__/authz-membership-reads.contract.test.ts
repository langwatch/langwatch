/**
 * @vitest-environment node
 * The reads authz makes off the membership, team and project tables answer the same way on each
 * backend: the single-sign-on admission marker on an OrganizationUser row, a legacy shared-team
 * membership, and the names a binding's scopes carry. Memory always runs; Postgres in integration.
 */
import { randomUUID } from "node:crypto";

import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { type Instant, Temporal, toDate } from "@langwatch/time";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { AuthzBindingScopeRow } from "../authz-managed-grant.repository.ts";
import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "../memory/authz-memory.store.ts";
import { MemoryAuthzAdmissionRepository } from "../memory/memory.authz-admission.repository.ts";
import { MemoryAuthzManagedGrantRepository } from "../memory/memory.authz-managed-grant.repository.ts";
import { MemoryAuthzUserStandingRepository } from "../memory/memory.authz-user-standing.repository.ts";
import { PostgresAuthzRepositories } from "../prisma/prisma.authz.repositories.ts";

type MembershipRepositories = Pick<AuthzRepositories, "admissions" | "bindings" | "userStandings">;

type MembershipFixture = Readonly<{
  repositories: MembershipRepositories;
  organizationId: string;
  organizationName: string;
  foreignOrganizationId: string;
  member: (input?: {
    pendingSsoGrantId?: string;
    disabled?: boolean;
    organizationId?: string;
  }) => Promise<string>;
  team: (input: {
    name: string;
    personalFor?: string;
    organizationId?: string;
    memberIds?: readonly string[];
  }) => Promise<string>;
  project: (input: { teamId: string; name: string; isPersonal?: boolean }) => Promise<string>;
  grant: (input: {
    userId: string;
    grantId: string;
    revoked?: boolean;
    expiresAt?: Instant;
  }) => Promise<void>;
  close: () => Promise<void>;
}>;

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const at = (ms: number): Instant => Temporal.Instant.fromEpochMilliseconds(ms);
const T0 = 1_760_000_000_000;
const FAR_FUTURE = at(4_102_444_800_000);

function memoryMembershipFixture(): MembershipFixture {
  const memory = AuthzMemoryStore.create();
  const organizationId = id("org");
  const foreignOrganizationId = id("org");
  memory.organizations.set(organizationId, { name: "Members", createdAt: at(T0) });
  memory.organizations.set(foreignOrganizationId, { name: "Foreign", createdAt: at(T0) });

  return {
    repositories: {
      admissions: MemoryAuthzAdmissionRepository.create({ memory }),
      bindings: MemoryAuthzManagedGrantRepository.create({ memory }),
      userStandings: MemoryAuthzUserStandingRepository.create({ memory }),
    },
    organizationId,
    organizationName: "Members",
    foreignOrganizationId,
    member: async ({ pendingSsoGrantId, disabled = false, organizationId: orgId } = {}) => {
      const userId = id("user");
      memory.memberships.set(memory.membershipKey(orgId ?? organizationId, userId), {
        role: "MEMBER",
        disabled,
        membershipStamp: `stamp_${userId}`,
        pendingSsoGrantId: pendingSsoGrantId ?? null,
        createdAt: at(T0),
      });
      return userId;
    },
    team: async ({ name, personalFor, organizationId: orgId, memberIds = [] }) => {
      const teamId = id("team");
      memory.teams.push({
        id: teamId,
        organizationId: orgId ?? organizationId,
        name,
        isPersonal: personalFor !== undefined,
        ownerUserId: personalFor ?? null,
      });
      for (const userId of memberIds) {
        memory.teamMemberships.push({
          teamId,
          userId,
          role: "MEMBER",
          assignedRoleId: null,
          createdAt: at(T0),
        });
      }
      return teamId;
    },
    project: async ({ teamId, name, isPersonal = false }) => {
      const projectId = id("project");
      memory.projects.push({
        id: projectId,
        teamId,
        name,
        isPersonal,
        apiKey: id("key"),
        createdAt: at(T0),
      });
      return projectId;
    },
    grant: async ({ userId, grantId, revoked = false, expiresAt }) => {
      memory.grants.push({
        id: grantId,
        organizationId,
        principalType: "USER",
        principalId: userId,
        roleKey: "member",
        legacyRole: null,
        source: "sso",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: null,
        expiresAt: expiresAt ?? null,
        maxViews: null,
        occurredAt: at(T0),
        revokedAt: revoked ? at(T0) : null,
        revokedReason: revoked ? "revocation" : null,
        createdAt: at(T0),
        updatedAt: at(T0),
      });
    },
    close: async () => {},
  };
}

/** The integration lane's Postgres; the unit lane never sets it, so the row is skipped there. */
const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
let prisma: PrismaClient | undefined;

async function postgresMembershipFixture(): Promise<MembershipFixture> {
  prisma ??= new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma;
  const organizationIds: string[] = [];
  const createOrganization = async (name: string) => {
    const created = await database.organization.create({
      data: { name, slug: `--test-org-${id("members")}`, createdAt: toDate(at(T0)) },
    });
    organizationIds.push(created.id);
    return created.id;
  };
  const organizationId = await createOrganization("Members");
  const foreignOrganizationId = await createOrganization("Foreign");
  const userIds: string[] = [];
  const teamIds: string[] = [];

  return {
    repositories: PostgresAuthzRepositories.create({ prisma: database }),
    organizationId,
    organizationName: "Members",
    foreignOrganizationId,
    member: async ({ pendingSsoGrantId, disabled = false, organizationId: orgId } = {}) => {
      const userId = id("user");
      await database.user.create({
        data: { id: userId, name: "Member", email: `${userId}@example.com` },
      });
      userIds.push(userId);
      await database.organizationUser.create({
        data: {
          userId,
          organizationId: orgId ?? organizationId,
          role: "MEMBER",
          pendingSsoGrantId: pendingSsoGrantId ?? null,
          disabledAt: disabled ? toDate(at(T0)) : null,
          createdAt: toDate(at(T0)),
        },
      });
      return userId;
    },
    team: async ({ name, personalFor, organizationId: orgId, memberIds = [] }) => {
      const teamId = id("team");
      await database.team.create({
        data: {
          id: teamId,
          name,
          slug: teamId,
          organizationId: orgId ?? organizationId,
          isPersonal: personalFor !== undefined,
          ownerUserId: personalFor ?? null,
        },
      });
      teamIds.push(teamId);
      for (const userId of memberIds) {
        await database.teamUser.create({ data: { teamId, userId, role: "MEMBER" } });
      }
      return teamId;
    },
    project: async ({ teamId, name, isPersonal = false }) => {
      const projectId = id("project");
      await database.project.create({
        data: {
          id: projectId,
          name,
          slug: projectId,
          apiKey: id("key"),
          teamId,
          language: "python",
          framework: "openai",
          isPersonal,
        },
      });
      return projectId;
    },
    grant: async ({ userId, grantId, revoked = false, expiresAt }) => {
      await database.grant.create({
        data: {
          id: grantId,
          organizationId,
          principalType: "USER",
          principalId: userId,
          roleKey: "member",
          source: "sso",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          occurredAt: toDate(at(T0)),
          expiresAt: expiresAt ? toDate(expiresAt) : null,
          revokedAt: revoked ? toDate(at(T0)) : null,
        },
      });
    },
    close: async () => {
      const inOrganizations = { organizationId: { in: organizationIds } };
      await cleanupTestRows(database, [
        ["grant", inOrganizations],
        ["teamUser", { teamId: { in: teamIds } }],
        ["project", { teamId: { in: teamIds } }],
        ["team", inOrganizations],
        ["organizationUser", inOrganizations],
        ["authzUserStanding", { userId: { in: userIds } }],
        ["organization", { id: { in: organizationIds } }],
        ["user", { id: { in: userIds } }],
      ]);
    },
  };
}

const backends = [
  { name: "memory", skip: false, open: async () => memoryMembershipFixture() },
  { name: "postgres", skip: !DB_URL, open: postgresMembershipFixture },
];

afterAll(async () => {
  await prisma?.$disconnect();
});

describe.each(backends)("given the membership reads on the $name backend", (backend) => {
  let opened: MembershipFixture | undefined;
  const open = async () => {
    opened = await backend.open();
    return opened;
  };

  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });

  describe.skipIf(backend.skip)("when a membership carries an unfinished admission", () => {
    it("reads the marker at the membership's time, and the grant once the ledger holds one", async () => {
      const { repositories, organizationId, member, grant } = await open();
      const grantId = id("grant");
      const userId = await member({ pendingSsoGrantId: grantId });
      const scope = { organizationId, userId };

      await expect(repositories.admissions.readAdmissionMarker(scope)).resolves.toEqual({
        found: true,
        grantId,
        occurredAtMs: T0,
      });
      await expect(
        repositories.admissions.readAdmissionGrant({ ...scope, grantId }),
      ).resolves.toEqual({ found: false });

      await grant({ userId, grantId });
      await expect(
        repositories.admissions.readAdmissionGrant({ ...scope, grantId }),
      ).resolves.toEqual({ found: true, revoked: false });
    });

    it.each([
      ["revoked", { revoked: true }],
      ["expired", { expiresAt: at(T0) }],
    ] as const)("refuses to complete on a %s grant and keeps the marker", async (_case, state) => {
      const { repositories, organizationId, member, grant } = await open();
      const grantId = id("grant");
      const userId = await member({ pendingSsoGrantId: grantId });
      await grant({ userId, grantId, ...state });

      await expect(
        repositories.admissions.completeAdmission({ organizationId, userId, grantId }),
      ).resolves.toBe(false);
      await expect(
        repositories.admissions.readAdmissionMarker({ organizationId, userId }),
      ).resolves.toEqual({ found: true, grantId, occurredAtMs: T0 });
    });

    it("completes once a live grant answers the marker, clearing it", async () => {
      const { repositories, organizationId, member, grant } = await open();
      const grantId = id("grant");
      const userId = await member({ pendingSsoGrantId: grantId });
      await grant({ userId, grantId, expiresAt: FAR_FUTURE });

      await expect(
        repositories.admissions.completeAdmission({ organizationId, userId, grantId }),
      ).resolves.toBe(true);
      await expect(
        repositories.admissions.readAdmissionMarker({ organizationId, userId }),
      ).resolves.toEqual({ found: false });
    });

    it("clears the marker on request only while it names that grant", async () => {
      const { repositories, organizationId, member } = await open();
      const grantId = id("grant");
      const userId = await member({ pendingSsoGrantId: grantId });

      await expect(
        repositories.admissions.clearPendingAdmission({
          organizationId,
          userId,
          grantId: id("grant"),
        }),
      ).resolves.toBe(false);
      await expect(
        repositories.admissions.clearPendingAdmission({ organizationId, userId, grantId }),
      ).resolves.toBe(true);
      await expect(
        repositories.admissions.readAdmissionMarker({ organizationId, userId }),
      ).resolves.toEqual({ found: false });
    });

    it("keeps a disabled membership's and an inactive user's marker out of the read", async () => {
      const { repositories, organizationId, member } = await open();
      const disabled = await member({ pendingSsoGrantId: id("grant"), disabled: true });
      const inactive = await member({ pendingSsoGrantId: id("grant") });
      await repositories.userStandings.recordDeactivated({ userId: inactive, at: at(T0) });

      for (const userId of [disabled, inactive]) {
        await expect(
          repositories.admissions.readAdmissionMarker({ organizationId, userId }),
        ).resolves.toEqual({ found: false });
      }
    });
  });

  describe.skipIf(backend.skip)("when members sit in shared and personal teams", () => {
    it("counts a shared team of this organization as a legacy shared-team membership", async () => {
      const { repositories, organizationId, foreignOrganizationId, member, team } = await open();
      const shared = await member();
      const personalOnly = await member();
      const elsewhere = await member();
      await team({ name: "Shared", memberIds: [shared] });
      await team({ name: "Mine", personalFor: personalOnly, memberIds: [personalOnly] });
      await team({ name: "Theirs", organizationId: foreignOrganizationId, memberIds: [elsewhere] });

      const held = async (userId: string) =>
        repositories.bindings.hasLegacySharedTeamMembership({ organizationId, userId });
      await expect(held(shared)).resolves.toBe(true);
      await expect(held(personalOnly)).resolves.toBe(false);
      await expect(held(elsewhere)).resolves.toBe(false);
    });
  });

  describe.skipIf(backend.skip)("when a binding's scopes are named", () => {
    it("names the organization, its teams and its projects, personal workspaces marked", async () => {
      const fixture = await open();
      const { repositories, organizationId, organizationName, member, team, project } = fixture;
      const owner = await member();
      const sharedTeam = await team({ name: "Shared" });
      const personalTeam = await team({ name: "Ada's workspace", personalFor: owner });
      const sharedProject = await project({ teamId: sharedTeam, name: "Shop" });
      const personalProject = await project({ teamId: sharedTeam, name: "Mine", isPersonal: true });
      const workspaceProject = await project({ teamId: personalTeam, name: "Sandbox" });

      const rows = await repositories.bindings.findScopeRows({
        organizationId,
        scopes: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "TEAM", scopeId: sharedTeam },
          { scopeType: "TEAM", scopeId: personalTeam },
          { scopeType: "PROJECT", scopeId: sharedProject },
          { scopeType: "PROJECT", scopeId: personalProject },
          { scopeType: "PROJECT", scopeId: workspaceProject },
        ],
      });

      expect(sortScopeRows(rows)).toEqual(
        sortScopeRows([
          {
            type: "ORGANIZATION",
            id: organizationId,
            name: organizationName,
            personalWorkspaceName: null,
          },
          { type: "TEAM", id: sharedTeam, name: "Shared", personalWorkspaceName: null },
          {
            type: "TEAM",
            id: personalTeam,
            name: "Ada's workspace",
            personalWorkspaceName: "Ada's workspace",
          },
          { type: "PROJECT", id: sharedProject, name: "Shop", personalWorkspaceName: null },
          { type: "PROJECT", id: personalProject, name: "Mine", personalWorkspaceName: "Shared" },
          {
            type: "PROJECT",
            id: workspaceProject,
            name: "Sandbox",
            personalWorkspaceName: "Ada's workspace",
          },
        ]),
      );
    });

    it("names no scope that belongs to another organization", async () => {
      const { repositories, organizationId, foreignOrganizationId, team, project } = await open();
      const foreignTeam = await team({ name: "Theirs", organizationId: foreignOrganizationId });
      const foreignProject = await project({ teamId: foreignTeam, name: "Theirs" });

      await expect(
        repositories.bindings.findScopeRows({
          organizationId,
          scopes: [
            { scopeType: "ORGANIZATION", scopeId: foreignOrganizationId },
            { scopeType: "TEAM", scopeId: foreignTeam },
            { scopeType: "PROJECT", scopeId: foreignProject },
          ],
        }),
      ).resolves.toEqual([]);
    });
  });
});

function sortScopeRows(rows: readonly AuthzBindingScopeRow[]): AuthzBindingScopeRow[] {
  return rows.toSorted((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
}
