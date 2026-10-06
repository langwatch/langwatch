/**
 * @vitest-environment node
 * The reads every decision, listing and the legacy import make answer the same way on each
 * backend: the grant heads as the projection writes them, and the membership, lineage and
 * principal tables beside them. The memory row always runs; Postgres joins in the integration lane.
 */
import { randomUUID } from "node:crypto";

import type { OrganizationRole } from "@langwatch/authorization";
import type { TeamUserRole } from "@langwatch/authz-contract";
import { createTenantId } from "@langwatch/eventing";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { type Instant, Temporal, toDate } from "@langwatch/time";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "../memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzListingRepository } from "../memory/memory.authz-listing.repository.ts";
import { MemoryAuthzMigrationRepository } from "../memory/memory.authz-migration.repository.ts";
import { MemoryAuthzReadRepository } from "../memory/memory.authz-read.repository.ts";
import { MemoryAuthzRevocationRepository } from "../memory/memory.authz-revocation.repository.ts";
import {
  type GrantRowShape,
  type RoleRowShape,
  SHARE_LINK_PERMISSION,
} from "../prisma/prisma.authz-grant.mapper.ts";
import { PostgresAuthzRepositories } from "../prisma/prisma.authz.repositories.ts";

type ReadRepositories = Pick<
  AuthzRepositories,
  "grantProjection" | "revocation" | "read" | "listing" | "migration"
>;

type ReadsFixture = Readonly<{
  repositories: ReadRepositories;
  organizationId: string;
  /** A second organization, for every tenancy fence. */
  foreignOrganizationId: string;
  user: (input?: {
    organizationId?: string;
    role?: OrganizationRole;
    member?: boolean;
  }) => Promise<string>;
  disableMembership: (userId: string) => Promise<void>;
  team: (organizationId?: string) => Promise<string>;
  project: (input: { teamId: string; apiKey?: string }) => Promise<string>;
  teamMember: (input: {
    teamId: string;
    userId: string;
    role: TeamUserRole;
    assignedRoleId?: string;
  }) => Promise<void>;
  group: (input: { memberIds: readonly string[]; organizationId?: string }) => Promise<string>;
  apiKey: (input: { userId: string | null }) => Promise<string>;
  close: () => Promise<void>;
}>;

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const at = (ms: number): Instant => Temporal.Instant.fromEpochMilliseconds(ms);
const T0 = 1_760_000_000_000;
const CONTEXT = { aggregateId: "grant", tenantId: createTenantId("org_contract") };

function memoryReadsFixture(): ReadsFixture {
  const memory = AuthzMemoryStore.create();
  const organizationId = id("org");
  const foreignOrganizationId = id("org");
  memory.organizations.set(organizationId, { createdAt: at(T0) });
  memory.organizations.set(foreignOrganizationId, { createdAt: at(T0) });

  return {
    repositories: {
      grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
      revocation: MemoryAuthzRevocationRepository.create({ memory }),
      read: MemoryAuthzReadRepository.create({ memory }),
      listing: MemoryAuthzListingRepository.create({ memory }),
      migration: MemoryAuthzMigrationRepository.create({ memory }),
    },
    organizationId,
    foreignOrganizationId,
    user: async ({
      organizationId: orgId = organizationId,
      role = "MEMBER",
      member = true,
    } = {}) => {
      const userId = id("user");
      memory.users.push({
        id: userId,
        name: "Reader",
        email: `${userId}@example.com`,
        image: null,
      });
      if (member) {
        memory.memberships.set(`${orgId}:${userId}`, {
          role,
          disabled: false,
          membershipStamp: `stamp_${userId}`,
          createdAt: at(T0 + 1_000),
        });
      }
      return userId;
    },
    disableMembership: async (userId) => {
      const row = memory.memberships.get(memory.membershipKey(organizationId, userId));
      if (row) row.disabled = true;
    },
    team: async (orgId = organizationId) => {
      const teamId = id("team");
      memory.teams.push({ id: teamId, organizationId: orgId });
      return teamId;
    },
    project: async ({ teamId, apiKey = id("key") }) => {
      const projectId = id("project");
      memory.projects.push({ id: projectId, teamId, apiKey, createdAt: at(T0 + 2_000) });
      return projectId;
    },
    teamMember: async ({ teamId, userId, role, assignedRoleId = null }) => {
      memory.teamMemberships.push({ teamId, userId, role, assignedRoleId, createdAt: at(T0) });
    },
    group: async ({ memberIds, organizationId: orgId = organizationId }) => {
      const groupId = id("group");
      memory.groups.push({
        id: groupId,
        organizationId: orgId,
        name: "Readers",
        slug: groupId,
        scimSource: null,
      });
      for (const userId of memberIds) memory.groupMemberships.push({ userId, groupId });
      return groupId;
    },
    apiKey: async ({ userId }) => {
      const apiKeyId = id("apikey");
      memory.apiKeys.push({ id: apiKeyId, organizationId, name: "Reader key", userId });
      return apiKeyId;
    },
    close: async () => {},
  };
}

/** The integration lane's Postgres; the unit lane never sets it, so the row is skipped there. */
const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
let prisma: PrismaClient | undefined;

async function postgresReadsFixture(): Promise<ReadsFixture> {
  prisma ??= new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma;
  const createOrganization = async () =>
    (
      await database.organization.create({
        data: { name: "Reads", slug: `--test-org-${id("reads")}`, createdAt: toDate(at(T0)) },
      })
    ).id;
  const organizationId = await createOrganization();
  const foreignOrganizationId = await createOrganization();
  const organizationIds = [organizationId, foreignOrganizationId];
  const userIds: string[] = [];
  const teamIds: string[] = [];

  return {
    repositories: PostgresAuthzRepositories.create({ prisma: database }),
    organizationId,
    foreignOrganizationId,
    user: async ({
      organizationId: orgId = organizationId,
      role = "MEMBER",
      member = true,
    } = {}) => {
      const userId = id("user");
      await database.user.create({
        data: { id: userId, name: "Reader", email: `${userId}@example.com` },
      });
      userIds.push(userId);
      if (member) {
        await database.organizationUser.create({
          data: {
            userId,
            organizationId: orgId,
            role,
            membershipStamp: `stamp_${userId}`,
            createdAt: toDate(at(T0 + 1_000)),
          },
        });
      }
      return userId;
    },
    disableMembership: async (userId) => {
      await database.organizationUser.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { disabledAt: new Date() },
      });
    },
    team: async (orgId = organizationId) => {
      const teamId = id("team");
      await database.team.create({
        data: { id: teamId, name: "Readers", slug: teamId, organizationId: orgId },
      });
      teamIds.push(teamId);
      return teamId;
    },
    project: async ({ teamId, apiKey = id("key") }) => {
      const projectId = id("project");
      await database.project.create({
        data: {
          id: projectId,
          name: "Reads",
          slug: projectId,
          apiKey,
          teamId,
          language: "python",
          framework: "openai",
          createdAt: toDate(at(T0 + 2_000)),
        },
      });
      return projectId;
    },
    teamMember: async ({ teamId, userId, role, assignedRoleId = null }) => {
      await database.teamUser.create({
        data: { teamId, userId, role, assignedRoleId, createdAt: toDate(at(T0)) },
      });
    },
    group: async ({ memberIds, organizationId: orgId = organizationId }) => {
      const groupId = id("group");
      await database.group.create({
        data: { id: groupId, organizationId: orgId, name: "Readers", slug: groupId },
      });
      for (const userId of memberIds) {
        await database.groupMembership.create({ data: { userId, groupId } });
      }
      return groupId;
    },
    apiKey: async ({ userId }) => {
      const apiKeyId = id("apikey");
      await database.apiKey.create({
        data: {
          id: apiKeyId,
          name: "Reader key",
          lookupId: apiKeyId,
          hashedSecret: "hashed",
          organizationId,
          userId,
        },
      });
      return apiKeyId;
    },
    close: async () => {
      const inOrganizations = { organizationId: { in: organizationIds } };
      await cleanupTestRows(database, [
        ["shareLink", { project: { teamId: { in: teamIds } } }],
        ["grantUsage", inOrganizations],
        ["roleBinding", inOrganizations],
        ["teamUser", { teamId: { in: teamIds } }],
        ["customRole", inOrganizations],
        ["grant", inOrganizations],
        ["role", inOrganizations],
        ["groupMembership", { userId: { in: userIds } }],
        ["group", inOrganizations],
        ["apiKey", inOrganizations],
        ["project", { teamId: { in: teamIds } }],
        ["team", inOrganizations],
        ["organizationUser", inOrganizations],
        ["organization", { id: { in: organizationIds } }],
        ["user", { id: { in: userIds } }],
      ]);
    },
  };
}

const backends = [
  { name: "memory", skip: false, open: async () => memoryReadsFixture() },
  { name: "postgres", skip: !DB_URL, open: postgresReadsFixture },
];

afterAll(async () => {
  await prisma?.$disconnect();
});

type GrantInput = Partial<GrantRowShape> &
  Pick<GrantRowShape, "organizationId" | "principalType" | "principalId" | "scopeType" | "scopeId">;

function grantRow(input: GrantInput): GrantRowShape {
  return {
    id: id("grant"),
    roleKey: "member",
    legacyRole: null,
    source: "grants-service",
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: at(T0),
    ...input,
  };
}

function roleRow(
  input: Partial<RoleRowShape> & Pick<RoleRowShape, "organizationId">,
): RoleRowShape {
  return {
    id: id("role"),
    name: id("name"),
    description: null,
    permissions: ["traces:view"],
    kind: "custom",
    occurredAt: at(T0),
    ...input,
  };
}

const byId = <Row extends { id: string }>(rows: readonly Row[]) =>
  [...rows].toSorted((a, b) => (a.id < b.id ? -1 : 1));

const attach = (fixture: ReadsFixture, row: GrantRowShape) =>
  fixture.repositories.grantProjection.append({ kind: "grant.upsert", row }, CONTEXT);
const defineRole = (fixture: ReadsFixture, row: RoleRowShape) =>
  fixture.repositories.grantProjection.append({ kind: "role.upsert", row }, CONTEXT);
const revoke = (fixture: ReadsFixture, grantId: string) =>
  fixture.repositories.grantProjection.append(
    {
      kind: "grant.revoke",
      organizationId: fixture.organizationId,
      grantId,
      reason: "revocation",
      occurredAt: at(T0 + 50_000),
    },
    CONTEXT,
  );

/** Opens one fixture per test on this backend and closes it after. */
function openPerTest(backend: (typeof backends)[number]): () => Promise<ReadsFixture> {
  let opened: ReadsFixture | undefined;
  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });
  return async () => {
    opened = await backend.open();
    return opened;
  };
}

describe.each(backends)("given the decision reads on the $name backend", (backend) => {
  const open = openPerTest(backend);

  describe.skipIf(backend.skip)("when a member's grants are collected for a decision", () => {
    it("reads the live binding-tier grants with their ends, and nothing once the seat is disabled", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const userId = await fixture.user();
      const teamId = await fixture.team();
      const forUser = (input: Partial<GrantRowShape>) =>
        grantRow({
          organizationId,
          principalType: "USER",
          principalId: userId,
          scopeType: "TEAM",
          scopeId: teamId,
          ...input,
        });
      const team = forUser({ roleKey: "admin", expiresAt: at(T0 + 9_000) });
      const organization = forUser({ scopeType: "ORGANIZATION", scopeId: organizationId });
      const revoked = forUser({ roleKey: "viewer" });
      for (const row of [
        team,
        organization,
        revoked,
        forUser({ roleKey: "lite-member" }),
        forUser({ organizationId: fixture.foreignOrganizationId }),
      ]) {
        await attach(fixture, row);
      }
      await revoke(fixture, revoked.id);

      const bindings = await fixture.repositories.read.findUserBindings({ userId, organizationId });
      expect(bindings).toHaveLength(2);
      expect(bindings).toEqual(
        expect.arrayContaining([
          {
            roleKey: "admin",
            scopeType: "TEAM",
            scopeId: teamId,
            viaGroupId: null,
            expiresAtMs: T0 + 9_000,
          },
          {
            roleKey: "member",
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            viaGroupId: null,
          },
        ]),
      );
      await expect(
        fixture.repositories.read.findOrganizationMembership({ userId, organizationId }),
      ).resolves.toEqual({ role: "MEMBER", disabled: false });

      await fixture.disableMembership(userId);
      await expect(
        fixture.repositories.read.findUserBindings({ userId, organizationId }),
      ).resolves.toEqual([]);
      await expect(
        fixture.repositories.read.findOrganizationMembership({ userId, organizationId }),
      ).resolves.toEqual({ role: "MEMBER", disabled: true });
      await expect(
        fixture.repositories.read.findOrganizationMembership({
          userId: id("user"),
          organizationId,
        }),
      ).resolves.toBeNull();
    });

    it("reads a group's grants stamped with the group, for this organization's groups only", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const userId = await fixture.user();
      const groupId = await fixture.group({ memberIds: [userId] });
      const foreignGroupId = await fixture.group({
        memberIds: [userId],
        organizationId: fixture.foreignOrganizationId,
      });
      for (const principalId of [groupId, foreignGroupId]) {
        await attach(
          fixture,
          grantRow({
            organizationId,
            principalType: "GROUP",
            principalId,
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
          }),
        );
      }

      await expect(
        fixture.repositories.read.findGroupBindings({ userId, organizationId }),
      ).resolves.toEqual([
        {
          roleKey: "member",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          viaGroupId: groupId,
        },
      ]);
    });
  });

  describe.skipIf(backend.skip)("when an API key's grants and roles are read", () => {
    it("reads its bindings, its owner, and a private role only while the key alone holds it", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const ownerId = await fixture.user();
      const apiKeyId = await fixture.apiKey({ userId: ownerId });
      const serviceKeyId = await fixture.apiKey({ userId: null });
      const privateRole = roleRow({ organizationId, kind: "system_api_key" });
      const sharedPrivateRole = roleRow({ organizationId, kind: "system_api_key" });
      const customRole = roleRow({ organizationId, permissions: ["datasets:view"] });
      const deletedRole = roleRow({ organizationId });
      for (const role of [privateRole, sharedPrivateRole, customRole, deletedRole]) {
        await defineRole(fixture, role);
      }
      await fixture.repositories.grantProjection.append(
        { kind: "role.delete", roleId: deletedRole.id, occurredAt: at(T0 + 1) },
        CONTEXT,
      );
      const forKey = (principalId: string, roleId: string) =>
        grantRow({
          organizationId,
          principalType: "API_KEY",
          principalId,
          roleKey: `custom:${roleId}`,
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        });
      await attach(fixture, forKey(apiKeyId, privateRole.id));
      await attach(fixture, forKey(apiKeyId, sharedPrivateRole.id));
      await attach(fixture, forKey(serviceKeyId, sharedPrivateRole.id));

      const bindings = await fixture.repositories.read.findApiKeyBindings({
        apiKeyId,
        organizationId,
      });
      expect(bindings.map((binding) => binding.roleKey).toSorted()).toEqual(
        [`custom:${privateRole.id}`, `custom:${sharedPrivateRole.id}`].toSorted(),
      );
      await expect(fixture.repositories.read.findApiKeyOwner(apiKeyId)).resolves.toEqual({
        userId: ownerId,
      });
      await expect(fixture.repositories.read.findApiKeyOwner(serviceKeyId)).resolves.toEqual({
        userId: null,
      });
      await expect(fixture.repositories.read.findApiKeyOwner(id("apikey"))).resolves.toBeNull();

      const allRoleIds = [privateRole.id, sharedPrivateRole.id, customRole.id, deletedRole.id];
      const asKey = await fixture.repositories.read.findCustomRolePermissions({
        organizationId,
        principal: { type: "apiKey", id: apiKeyId },
        customRoleIds: allRoleIds,
      });
      expect(byId(asKey)).toEqual(
        byId([
          { id: privateRole.id, permissions: ["traces:view"] },
          { id: customRole.id, permissions: ["datasets:view"] },
        ]),
      );
      await expect(
        fixture.repositories.read.findCustomRolePermissions({
          organizationId,
          principal: { type: "user", id: ownerId },
          customRoleIds: allRoleIds,
        }),
      ).resolves.toEqual([{ id: customRole.id, permissions: ["datasets:view"] }]);
      await expect(
        fixture.repositories.read.findCustomRolePermissions({
          organizationId: fixture.foreignOrganizationId,
          principal: { type: "user", id: ownerId },
          customRoleIds: allRoleIds,
        }),
      ).resolves.toEqual([]);
    });
  });

  describe.skipIf(backend.skip)("when a share link is presented", () => {
    it("reads the live link the token and resource match, with its counted views", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const teamId = await fixture.team();
      const projectId = await fixture.project({ teamId });
      const link = (input: Partial<GrantRowShape>) =>
        grantRow({
          organizationId,
          principalType: "ANYONE",
          principalId: null,
          roleKey: null,
          source: "share-link",
          scopeType: "RESOURCE",
          scopeId: "trace_1",
          token: id("token"),
          permission: SHARE_LINK_PERMISSION,
          resourceKind: "TRACE",
          projectId,
          maxViews: 5,
          ...input,
        });
      const live = link({ expiresAt: at(T0 + 60_000) });
      const revoked = link({});
      const otherTrace = link({ scopeId: "trace_2" });
      for (const row of [live, revoked, otherTrace]) await attach(fixture, row);
      await revoke(fixture, revoked.id);
      await fixture.repositories.migration.seedResourceGrantUsage({
        organizationId,
        seeds: [{ grantId: live.id, projectId, viewCount: 3 }],
      });
      const tokens = [live.token, revoked.token, otherTrace.token].flatMap((token) =>
        token ? [token] : [],
      );

      const expected = {
        resourceType: "TRACE",
        resourceId: "trace_1",
        projectId,
        visibility: "PUBLIC",
        expiresAt: at(T0 + 60_000),
        maxViews: 5,
        viewCount: 3,
      };
      await expect(
        fixture.repositories.read.findShareLinks({
          projectId,
          tokens,
          links: [{ kind: "trace", id: "trace_1" }],
        }),
      ).resolves.toEqual([expected]);
      await expect(
        fixture.repositories.read.findShareLinks({
          projectId,
          tokens,
          links: [{ kind: "trace", id: "trace_1" }],
          organizationId: fixture.foreignOrganizationId,
        }),
      ).resolves.toEqual([]);
      await expect(
        fixture.repositories.read.findShareLinks({
          projectId,
          tokens: [],
          links: [{ kind: "trace", id: "trace_1" }],
        }),
      ).resolves.toEqual([]);
      await expect(fixture.repositories.read.findProjectLineage({ projectId })).resolves.toEqual({
        teamId,
        organizationId,
      });
      await expect(fixture.repositories.read.findTeamOrganization({ teamId })).resolves.toEqual({
        organizationId,
      });
      await expect(
        fixture.repositories.read.findProjectLineage({ projectId: id("project") }),
      ).resolves.toBeNull();
      await expect(
        fixture.repositories.read.findTeamOrganization({ teamId: id("team") }),
      ).resolves.toBeNull();
    });
  });
});

describe.each(backends)("given the access listings on the $name backend", (backend) => {
  const open = openPerTest(backend);

  describe.skipIf(backend.skip)("when the access surface lists an organization's bindings", () => {
    it("lists live legacy-shaped grants in business-time order, decorated, without departed members", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const userId = await fixture.user();
      const departedId = await fixture.user({ member: false });
      const groupId = await fixture.group({ memberIds: [] });
      const apiKeyId = await fixture.apiKey({ userId: null });
      const teamId = await fixture.team();
      const role = roleRow({ organizationId, name: "Auditor", occurredAt: at(T0 + 5) });
      await defineRole(fixture, role);
      const base = { organizationId, scopeType: "TEAM" as const, scopeId: teamId };
      const custom = grantRow({
        ...base,
        id: "grant_a",
        principalType: "USER",
        principalId: userId,
        roleKey: `custom:${role.id}`,
        legacyRole: null,
        occurredAt: at(T0 + 30),
      });
      const viaGroup = grantRow({
        ...base,
        id: "grant_c",
        principalType: "GROUP",
        principalId: groupId,
        roleKey: "viewer",
        occurredAt: at(T0 + 10),
      });
      const viaKey = grantRow({
        ...base,
        id: "grant_b",
        principalType: "API_KEY",
        principalId: apiKeyId,
        roleKey: "admin",
        occurredAt: at(T0 + 10),
        expiresAt: at(T0 + 99),
      });
      const departed = grantRow({ ...base, principalType: "USER", principalId: departedId });
      const dormant = grantRow({
        ...base,
        principalType: "USER",
        principalId: userId,
        roleKey: "lite-member",
      });
      const ids = (prefix: string) => ({ id: `${prefix}_${randomUUID().slice(0, 8)}` });
      for (const row of [custom, viaGroup, viaKey, departed, dormant]) {
        await attach(fixture, { ...row, ...ids(row.id) });
      }

      const listed = await fixture.repositories.listing.findOrganizationBindings({
        organizationId,
      });
      expect(
        listed.map((binding) => ({
          principal: binding.userId ?? binding.groupId ?? binding.apiKeyId,
          role: binding.role,
          customRoleId: binding.customRoleId,
          scopeType: binding.scopeType,
          scopeId: binding.scopeId,
          createdAt: binding.createdAt.getTime(),
          expiresAt: binding.expiresAt?.getTime() ?? null,
          user: binding.user?.id ?? null,
          group: binding.group ? { ...binding.group } : null,
          apiKey: binding.apiKey ? { ...binding.apiKey } : null,
          customRole: binding.customRole?.name ?? null,
        })),
      ).toEqual([
        {
          principal: viaKey.principalId,
          role: "ADMIN",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: teamId,
          createdAt: T0 + 10,
          expiresAt: T0 + 99,
          user: null,
          group: null,
          apiKey: { id: apiKeyId, name: "Reader key" },
          customRole: null,
        },
        {
          principal: groupId,
          role: "VIEWER",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: teamId,
          createdAt: T0 + 10,
          expiresAt: null,
          user: null,
          group: { id: groupId, name: "Readers", scimSource: null },
          apiKey: null,
          customRole: null,
        },
        {
          principal: userId,
          role: "CUSTOM",
          customRoleId: role.id,
          scopeType: "TEAM",
          scopeId: teamId,
          createdAt: T0 + 30,
          expiresAt: null,
          user: userId,
          group: null,
          apiKey: null,
          customRole: "Auditor",
        },
      ]);

      const departedOwn = await fixture.repositories.listing.findUserBindings({
        organizationId,
        userId: departedId,
      });
      expect(departedOwn.map((binding) => [binding.role, binding.user?.id])).toEqual([
        ["MEMBER", departedId],
      ]);
      const scoped = await fixture.repositories.listing.findScopeBindings({
        organizationId,
        scopeType: "TEAM",
        scopeIds: [teamId],
      });
      expect(scoped).toHaveLength(3);
      const own = await fixture.repositories.listing.findUserAndGroupBindings({
        organizationId,
        userId,
        groupIds: [groupId],
      });
      expect(own.map((binding) => binding.role)).toEqual(["VIEWER", "CUSTOM"]);
      const ofGroup = await fixture.repositories.listing.findGroupBindings({
        organizationId,
        groupId,
      });
      expect(ofGroup.map((binding) => binding.groupId)).toEqual([groupId]);
      const ofKey = await fixture.repositories.listing.findApiKeyBindings({
        organizationId,
        apiKeyIds: [apiKeyId],
      });
      expect(ofKey.map((binding) => binding.apiKeyId)).toEqual([apiKeyId]);
    });

    it("lists a team's current members with their roles, keyed by team", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const userId = await fixture.user();
      const departedId = await fixture.user({ member: false });
      const teamId = await fixture.team();
      const emptyTeamId = await fixture.team();
      const role = roleRow({ organizationId });
      await defineRole(fixture, role);
      for (const [principalId, roleKey] of [
        [userId, `custom:${role.id}`],
        [departedId, "member"],
      ] as const) {
        await attach(
          fixture,
          grantRow({
            organizationId,
            principalType: "USER",
            principalId,
            roleKey,
            scopeType: "TEAM",
            scopeId: teamId,
            occurredAt: at(T0 + 7),
          }),
        );
      }

      const members = await fixture.repositories.listing.findTeamMemberBindings({
        organizationId,
        teamIds: [teamId, emptyTeamId],
      });
      expect([...members.keys()].toSorted()).toEqual([teamId, emptyTeamId].toSorted());
      expect(members.get(emptyTeamId)).toEqual([]);
      const [member, ...rest] = members.get(teamId) ?? [];
      expect(rest).toEqual([]);
      expect({
        userId: member?.userId,
        role: member?.role,
        customRoleId: member?.customRoleId,
        createdAt: member?.createdAt.getTime(),
        user: member ? { id: member.user.id, name: member.user.name } : null,
        customRole: member?.customRole?.id,
      }).toEqual({
        userId,
        role: "CUSTOM",
        customRoleId: role.id,
        createdAt: T0 + 7,
        user: { id: userId, name: "Reader" },
        customRole: role.id,
      });
    });

    it("synthesizes a workspace from own and group grants, and none through a Developer's group", async () => {
      const fixture = await open();
      const { organizationId, foreignOrganizationId } = fixture;
      const userId = await fixture.user();
      const developer = await fixture.user({ role: "DEVELOPER" });
      const groupId = await fixture.group({ memberIds: [userId, developer] });
      const teamId = await fixture.team();
      const role = roleRow({ organizationId, description: "Reads" });
      await defineRole(fixture, role);
      const grants = [
        grantRow({
          organizationId,
          principalType: "USER",
          principalId: userId,
          roleKey: `custom:${role.id}`,
          scopeType: "TEAM",
          scopeId: teamId,
          occurredAt: at(T0 + 1),
        }),
        grantRow({
          organizationId,
          principalType: "GROUP",
          principalId: groupId,
          roleKey: "admin",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          occurredAt: at(T0 + 2),
        }),
        grantRow({
          organizationId,
          principalType: "USER",
          principalId: developer,
          roleKey: "member",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          occurredAt: at(T0 + 3),
        }),
      ];
      for (const row of grants) await attach(fixture, row);

      const synthesized = await fixture.repositories.listing.findBindingsForSynthesis({
        orgIds: [organizationId, foreignOrganizationId],
        userId,
      });
      expect(
        synthesized.map((binding) => ({
          ...binding,
          customRole: binding.customRole?.name ?? null,
        })),
      ).toEqual([
        {
          organizationId,
          scopeType: "TEAM",
          scopeId: teamId,
          role: "CUSTOM",
          customRoleId: role.id,
          customRole: role.name,
        },
        {
          organizationId,
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          role: "ADMIN",
          customRoleId: null,
          customRole: null,
        },
      ]);
      await expect(
        fixture.repositories.listing.findBindingsForSynthesis({
          orgIds: [organizationId],
          userId: developer,
        }),
      ).resolves.toEqual([]);
    });

    it("lists user-created roles newest first and reads any live role's permissions", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const older = roleRow({ organizationId, occurredAt: at(T0 + 1) });
      const newer = roleRow({ organizationId, occurredAt: at(T0 + 2), description: "Newer" });
      const system = roleRow({ organizationId, kind: "system_api_key" });
      const deleted = roleRow({ organizationId });
      for (const row of [older, newer, system, deleted]) await defineRole(fixture, row);
      await fixture.repositories.grantProjection.append(
        { kind: "role.delete", roleId: deleted.id, occurredAt: at(T0 + 3) },
        CONTEXT,
      );

      const roles = await fixture.repositories.listing.findUserCreatedRoles({ organizationId });
      expect(
        roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          kind: role.kind,
          organizationId: role.organizationId,
          createdAt: role.createdAt.getTime(),
          hasUpdatedAt: role.updatedAt instanceof Date,
        })),
      ).toEqual(
        [newer, older].map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          kind: "custom",
          organizationId,
          createdAt: role.occurredAt.epochMilliseconds,
          hasUpdatedAt: true,
        })),
      );
      const permissions = await fixture.repositories.listing.findRolePermissionRows({
        organizationId,
        roleIds: [system.id, deleted.id, older.id],
      });
      expect(byId(permissions)).toEqual(
        byId([system, older].map(({ id, name, permissions }) => ({ id, name, permissions }))),
      );
    });
  });
});

describe.each(backends)("given the legacy import reads on the $name backend", (backend) => {
  const open = openPerTest(backend);

  describe.skipIf(backend.skip)("when the legacy import reads an organization", () => {
    it("reads its members, teams, groups and projects as the legacy tables hold them", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const memberId = await fixture.user({ role: "ADMIN" });
      const externalId = await fixture.user({ role: "EXTERNAL" });
      const teamId = await fixture.team();
      const foreignTeamId = await fixture.team(fixture.foreignOrganizationId);
      const projectId = await fixture.project({ teamId });
      await fixture.project({ teamId, apiKey: "" });
      await fixture.project({ teamId: foreignTeamId });
      await fixture.teamMember({ teamId, userId: memberId, role: "ADMIN" });
      await fixture.teamMember({ teamId: foreignTeamId, userId: memberId, role: "VIEWER" });
      const groupId = await fixture.group({ memberIds: [memberId] });
      await fixture.group({
        memberIds: [externalId],
        organizationId: fixture.foreignOrganizationId,
      });
      const { migration } = fixture.repositories;

      await expect(migration.findOrganizationCreatedAtMs({ organizationId })).resolves.toBe(T0);
      await expect(
        migration.findOrganizationCreatedAtMs({ organizationId: id("org") }),
      ).resolves.toBeNull();
      const members = await migration.findOrganizationMembers({ organizationId });
      expect([...members].toSorted((a, b) => (a.userId < b.userId ? -1 : 1))).toEqual(
        [
          { userId: memberId, role: "ADMIN" },
          { userId: externalId, role: "EXTERNAL" },
        ]
          .toSorted((a, b) => (a.userId < b.userId ? -1 : 1))
          .map((member) => ({
            ...member,
            createdAtMs: T0 + 1_000,
            membershipStamp: `stamp_${member.userId}`,
          })),
      );
      await expect(migration.findExternalMemberFacts({ organizationId })).resolves.toEqual([
        { userId: externalId, createdAtMs: T0 + 1_000 },
      ]);
      await expect(migration.findLegacyTeamRows({ organizationId })).resolves.toEqual([
        { userId: memberId, teamId, role: "ADMIN", customRoleId: null, createdAtMs: T0 },
      ]);
      await expect(migration.findGroupMemberships({ organizationId })).resolves.toEqual([
        { userId: memberId, groupId },
      ]);
      await expect(migration.findProjectCredentialFacts({ organizationId })).resolves.toEqual([
        { projectId, createdAtMs: T0 + 2_000 },
      ]);
    });

    it("reads the heads, their compat rows and the share budgets the projection wrote", async () => {
      const fixture = await open();
      const { organizationId } = fixture;
      const userId = await fixture.user();
      const teamId = await fixture.team();
      const projectId = await fixture.project({ teamId });
      const role = roleRow({ organizationId, description: "Imports" });
      const deleted = roleRow({ organizationId });
      for (const row of [role, deleted]) await defineRole(fixture, row);
      await fixture.repositories.grantProjection.append(
        { kind: "role.delete", roleId: deleted.id, occurredAt: at(T0 + 1) },
        CONTEXT,
      );
      const binding = grantRow({
        organizationId,
        principalType: "USER",
        principalId: userId,
        roleKey: `custom:${role.id}`,
        scopeType: "TEAM",
        scopeId: teamId,
      });
      const revoked = grantRow({
        organizationId,
        principalType: "USER",
        principalId: userId,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      });
      const link = grantRow({
        organizationId,
        principalType: "ANYONE",
        principalId: null,
        roleKey: null,
        source: "share-link",
        scopeType: "RESOURCE",
        scopeId: "trace_1",
        token: id("token"),
        permission: SHARE_LINK_PERMISSION,
        resourceKind: "TRACE",
        projectId,
        maxViews: 4,
      });
      for (const row of [binding, revoked, link]) await attach(fixture, row);
      await revoke(fixture, revoked.id);
      const { migration } = fixture.repositories;
      const seed = (viewCount: number, input: { organizationId?: string } = {}) =>
        migration.seedResourceGrantUsage({
          organizationId: input.organizationId ?? organizationId,
          seeds: [{ grantId: link.id, projectId, viewCount }],
        });
      await seed(2);
      await seed(1);
      await seed(9, { organizationId: fixture.foreignOrganizationId });

      const heads = await migration.findGrantHeadRows({ organizationId });
      expect(byId(heads)).toEqual(
        byId(
          [binding, revoked].map((row) => ({
            id: row.id,
            principalType: "USER",
            principalId: userId,
            roleKey: row.roleKey,
            legacyRole: null,
            source: "grants-service",
            scopeType: row.scopeType,
            scopeId: row.scopeId,
            revoked: row === revoked,
          })),
        ),
      );
      const roleHeads = await migration.findRoleHeads({ organizationId });
      expect(byId(roleHeads)).toEqual(
        byId(
          [role, deleted].map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            permissions: row.permissions,
            kind: "custom",
            deleted: row === deleted,
          })),
        ),
      );
      const strip = <Row extends { createdAtMs: number }>({ createdAtMs, ...row }: Row) => {
        expect(createdAtMs).toBeGreaterThan(T0);
        return row;
      };
      const legacyBindings = await migration.findLegacyBindingRows({ organizationId });
      expect(legacyBindings.map(strip)).toEqual([
        {
          id: binding.id,
          userId,
          groupId: null,
          apiKeyId: null,
          role: "CUSTOM",
          customRoleId: role.id,
          scopeType: "TEAM",
          scopeId: teamId,
        },
      ]);
      const legacyRoles = await migration.findLegacyRoleRows({ organizationId });
      expect(legacyRoles.map(strip)).toEqual([
        {
          id: role.id,
          name: role.name,
          description: "Imports",
          permissions: ["traces:view"],
          kind: "custom",
        },
      ]);
      const shareLinks = await migration.findShareLinkRows({ organizationId });
      expect(shareLinks.map(strip)).toEqual([
        {
          id: link.id,
          token: link.token,
          resourceType: "TRACE",
          resourceId: "trace_1",
          projectId,
          userId: null,
          visibility: "PUBLIC",
          expiresAtMs: null,
          maxViews: 4,
          viewCount: 0,
        },
      ]);
      await expect(migration.findResourceGrantRows({ organizationId })).resolves.toEqual([
        {
          grantId: link.id,
          source: "share-link",
          token: link.token,
          resourceKind: "TRACE",
          resourceId: "trace_1",
          projectId,
          principalType: "ANYONE",
          principalId: null,
          expiresAtMs: null,
          maxViews: 4,
          viewCount: 2,
        },
      ]);
    });
  });
});
