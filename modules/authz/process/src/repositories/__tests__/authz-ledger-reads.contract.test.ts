/**
 * @vitest-environment node
 * The reads the grants ledger and the grant writer make answer the same way on each backend:
 * the live Grant and Role heads as the projection writes them, the directory's own grants, and
 * the offboarding transaction. The memory row always runs; Postgres joins in the integration lane.
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { type Instant, Temporal, toDate } from "@langwatch/time";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "../memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzLedgerReadRepository } from "../memory/memory.authz-ledger-read.repository.ts";
import { MemoryAuthzRevocationRepository } from "../memory/memory.authz-revocation.repository.ts";
import type { GrantRowShape, RoleRowShape } from "../prisma/prisma.authz-grant.mapper.ts";
import { grantWhereFromBindingWhere } from "../prisma/prisma.authz-ledger.mapper.ts";
import { PostgresAuthzRepositories } from "../prisma/prisma.authz.repositories.ts";

type LedgerRepositories = Pick<AuthzRepositories, "grantProjection" | "revocation" | "ledgerReads">;

type LedgerFixture = Readonly<{
  repositories: LedgerRepositories;
  organizationId: string;
  user: () => Promise<string>;
  isMember: (userId: string) => Promise<boolean>;
  team: (input?: { personalFor?: string }) => Promise<string>;
  teamMember: (input: { teamId: string; userId: string }) => Promise<void>;
  group: (input: { memberIds: readonly string[] }) => Promise<string>;
  apiKey: (input: { userId: string; revoked?: boolean }) => Promise<string>;
  invite: (email: string) => Promise<void>;
  close: () => Promise<void>;
}>;

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const at = (ms: number): Instant => Temporal.Instant.fromEpochMilliseconds(ms);
const T0 = 1_760_000_000_000;
const CONTEXT = { aggregateId: "grant", tenantId: createTenantId("org_contract") };

function memoryLedgerFixture(): LedgerFixture {
  const memory = AuthzMemoryStore.create();
  const organizationId = id("org");
  memory.organizations.set(organizationId, { name: "Ledger", createdAt: at(T0) });

  return {
    repositories: {
      grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
      revocation: MemoryAuthzRevocationRepository.create({ memory }),
      ledgerReads: MemoryAuthzLedgerReadRepository.create({ memory }),
    },
    organizationId,
    user: async () => {
      const userId = id("user");
      memory.users.push({
        id: userId,
        name: "Leaver",
        email: `${userId}@example.com`,
        image: null,
      });
      memory.memberships.set(memory.membershipKey(organizationId, userId), {
        role: "MEMBER",
        disabled: false,
        membershipStamp: `stamp_${userId}`,
        pendingSsoGrantId: null,
        createdAt: at(T0),
      });
      return userId;
    },
    isMember: async (userId) => memory.isMember(organizationId, userId),
    team: async ({ personalFor } = {}) => {
      const teamId = id("team");
      memory.teams.push({
        id: teamId,
        organizationId,
        name: teamId,
        isPersonal: personalFor !== undefined,
        ownerUserId: personalFor ?? null,
      });
      return teamId;
    },
    teamMember: async ({ teamId, userId }) => {
      memory.teamMemberships.push({
        teamId,
        userId,
        role: "MEMBER",
        assignedRoleId: null,
        createdAt: at(T0),
      });
    },
    group: async ({ memberIds }) => {
      const groupId = id("group");
      memory.groups.push({
        id: groupId,
        organizationId,
        name: "G",
        slug: groupId,
        scimSource: null,
      });
      for (const userId of memberIds) memory.groupMemberships.push({ userId, groupId });
      return groupId;
    },
    apiKey: async ({ userId, revoked = false }) => {
      const apiKeyId = id("apikey");
      memory.apiKeys.push({
        id: apiKeyId,
        organizationId,
        name: apiKeyId,
        userId,
        revokedAt: revoked ? at(T0) : null,
      });
      return apiKeyId;
    },
    invite: async (email) => {
      memory.organizationInvites.push({ organizationId, email, status: "PENDING" });
    },
    close: async () => {},
  };
}

/** The integration lane's Postgres; the unit lane never sets it, so the row is skipped there. */
const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
let prisma: PrismaClient | undefined;

async function postgresLedgerFixture(): Promise<LedgerFixture> {
  prisma ??= new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma;
  const organizationId = (
    await database.organization.create({
      data: { name: "Ledger", slug: `--test-org-${id("ledger")}`, createdAt: toDate(at(T0)) },
    })
  ).id;
  const userIds: string[] = [];
  const teamIds: string[] = [];
  const inOrganization = { organizationId };

  return {
    repositories: PostgresAuthzRepositories.create({ prisma: database }),
    organizationId,
    user: async () => {
      const userId = id("user");
      await database.user.create({
        data: { id: userId, name: "Leaver", email: `${userId}@example.com` },
      });
      userIds.push(userId);
      await database.organizationUser.create({
        data: { userId, organizationId, role: "MEMBER", membershipStamp: `stamp_${userId}` },
      });
      return userId;
    },
    isMember: async (userId) =>
      (await database.organizationUser.count({ where: { userId, organizationId } })) > 0,
    team: async ({ personalFor } = {}) => {
      const teamId = id("team");
      await database.team.create({
        data: {
          id: teamId,
          name: teamId,
          slug: teamId,
          organizationId,
          isPersonal: personalFor !== undefined,
          ownerUserId: personalFor ?? null,
        },
      });
      teamIds.push(teamId);
      return teamId;
    },
    teamMember: async ({ teamId, userId }) => {
      await database.teamUser.create({ data: { teamId, userId, role: "MEMBER" } });
    },
    group: async ({ memberIds }) => {
      const groupId = id("group");
      await database.group.create({
        data: { id: groupId, organizationId, name: "G", slug: groupId },
      });
      for (const userId of memberIds) {
        await database.groupMembership.create({ data: { userId, groupId } });
      }
      return groupId;
    },
    apiKey: async ({ userId, revoked = false }) => {
      const apiKeyId = id("apikey");
      await database.apiKey.create({
        data: {
          id: apiKeyId,
          name: apiKeyId,
          lookupId: apiKeyId,
          hashedSecret: "hashed",
          organizationId,
          userId,
          revokedAt: revoked ? toDate(at(T0)) : null,
        },
      });
      return apiKeyId;
    },
    invite: async (email) => {
      await database.organizationInvite.create({
        data: { email, inviteCode: id("invite"), organizationId, teamIds: "", role: "MEMBER" },
      });
    },
    close: async () => {
      await cleanupTestRows(database, [
        ["organizationInvite", inOrganization],
        ["teamUser", { teamId: { in: teamIds } }],
        ["roleBinding", inOrganization],
        ["customRole", inOrganization],
        ["grant", inOrganization],
        ["role", inOrganization],
        ["groupMembership", { userId: { in: userIds } }],
        ["group", inOrganization],
        ["apiKey", inOrganization],
        ["team", inOrganization],
        ["organizationUser", inOrganization],
        ["organization", { id: organizationId }],
        ["user", { id: { in: userIds } }],
      ]);
    },
  };
}

const backends = [
  { name: "memory", skip: false, open: async () => memoryLedgerFixture() },
  { name: "postgres", skip: !DB_URL, open: postgresLedgerFixture },
];

afterAll(async () => {
  await prisma?.$disconnect();
});

type GrantInput = Partial<GrantRowShape> & Pick<GrantRowShape, "organizationId" | "principalId">;

function grantRow(input: GrantInput): GrantRowShape {
  return {
    id: id("grant"),
    principalType: "USER",
    roleKey: "member",
    legacyRole: null,
    source: "grants-service",
    scopeType: "ORGANIZATION",
    scopeId: input.organizationId,
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

const identityOf = (row: GrantRowShape) => ({
  principalType: row.principalType,
  principalId: row.principalId ?? "",
  roleKey: row.roleKey ?? "",
  scopeType: row.scopeType,
  scopeId: row.scopeId,
});

const attach = (fixture: LedgerFixture, row: GrantRowShape) =>
  fixture.repositories.grantProjection.append({ kind: "grant.upsert", row }, CONTEXT);
const defineRole = (fixture: LedgerFixture, row: RoleRowShape) =>
  fixture.repositories.grantProjection.append({ kind: "role.upsert", row }, CONTEXT);
const revoke = (fixture: LedgerFixture, grantIds: string[], revokedAt = at(T0 + 50_000)) =>
  fixture.repositories.revocation.enforceGrantRevocation({
    organizationId: fixture.organizationId,
    grantIds,
    reason: "revocation",
    revokedAt,
  });

/** Opens one fixture per test on this backend and closes it after. */
function openPerTest(backend: (typeof backends)[number]): () => Promise<LedgerFixture> {
  let opened: LedgerFixture | undefined;
  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });
  return async () => {
    opened = await backend.open();
    return opened;
  };
}

describe.each(backends)("given the ledger reads on the $name backend", (backend) => {
  const open = openPerTest(backend);

  describe.skipIf(backend.skip)("when the read-your-writes hold polls the Grant head", () => {
    it("sees a landed grant by id and identity, and nothing of a revoked one", async () => {
      const fixture = await open();
      const { organizationId, repositories } = fixture;
      const { ledgerReads } = repositories;
      const userId = await fixture.user();
      const live = grantRow({ organizationId, principalId: userId, occurredAt: at(T0 + 1_000) });
      const gone = grantRow({ organizationId, principalId: userId, roleKey: "admin" });
      await attach(fixture, live);
      await attach(fixture, gone);
      await revoke(fixture, [gone.id]);

      const landed = [live, gone].map((row) => ({ id: row.id, ...identityOf(row) }));
      expect(
        await ledgerReads.countLandedGrants({
          organizationId,
          grants: landed,
          occurredSince: at(T0),
        }),
      ).toBe(1);
      expect(
        await ledgerReads.countLandedGrants({
          organizationId,
          grants: landed,
          occurredSince: at(T0 + 2_000),
        }),
      ).toBe(0);
      expect(
        (
          await ledgerReads.findLiveGrantsByIdentity({
            organizationId,
            identities: [identityOf(live), identityOf(gone)],
          })
        ).map((row) => row.id),
      ).toEqual([live.id]);
      expect(await ledgerReads.findLiveGrant({ grantId: live.id })).toEqual(live);
      expect(await ledgerReads.findLiveGrant({ grantId: gone.id, organizationId })).toBeNull();
      expect(await ledgerReads.findLiveGrantRoleKey({ grantId: live.id, organizationId })).toEqual({
        roleKey: "member",
      });
      expect(
        await ledgerReads.findLiveGrantRoleKey({ grantId: live.id, organizationId: id("org") }),
      ).toBeNull();
    });

    it("confirms a resource grant only in its own project", async () => {
      const fixture = await open();
      const { organizationId, repositories } = fixture;
      const projectId = id("project");
      const link = grantRow({
        organizationId,
        principalType: "ANYONE",
        principalId: null,
        roleKey: null,
        scopeType: "RESOURCE",
        scopeId: id("trace"),
        token: id("token"),
        permission: "traces:share",
        resourceKind: "TRACE",
        projectId,
      });
      await attach(fixture, link);

      const asked = { grantId: link.id, organizationId, scopeType: "RESOURCE" as const };
      expect(await repositories.ledgerReads.hasLiveGrant({ ...asked, projectId })).toBe(true);
      expect(await repositories.ledgerReads.hasLiveGrant({ ...asked, projectId: id("p") })).toBe(
        false,
      );
      expect(await repositories.ledgerReads.hasLiveGrant({ ...asked, scopeType: "PLATFORM" })).toBe(
        false,
      );
    });
  });

  describe.skipIf(backend.skip)("when a compat filter names the grants to revoke", () => {
    it("answers the live non-platform grants the translated filter matches", async () => {
      const fixture = await open();
      const { organizationId, repositories } = fixture;
      const userId = await fixture.user();
      const roleIds = [id("role"), id("role")];
      const custom = roleIds.map((roleId) =>
        grantRow({ organizationId, principalId: userId, roleKey: `custom:${roleId}` }),
      );
      const member = grantRow({ organizationId, principalId: userId });
      for (const row of [...custom, member]) await attach(fixture, row);
      await revoke(fixture, [custom[1]!.id]);

      const translation = grantWhereFromBindingWhere(
        { userId, customRoleId: { in: roleIds } },
        organizationId,
      );
      if (translation.kind !== "translated") throw new Error("the filter did not translate");

      expect(await repositories.ledgerReads.findLiveGrantIds({ where: translation.where })).toEqual(
        [custom[0]!.id],
      );
    });
  });

  describe.skipIf(backend.skip)("when a role definition is polled", () => {
    it("reads a live role in its organization, and nothing once it is deleted", async () => {
      const fixture = await open();
      const { organizationId, repositories } = fixture;
      const { ledgerReads } = repositories;
      const kept: RoleRowShape = {
        id: id("role"),
        organizationId,
        name: "Reviewer",
        description: "Reads traces",
        permissions: ["traces:view", "traces:share"],
        kind: "custom",
        occurredAt: at(T0),
      };
      const dropped: RoleRowShape = { ...kept, id: id("role"), name: "Gone" };
      await defineRole(fixture, kept);
      await defineRole(fixture, dropped);
      await fixture.repositories.grantProjection.append(
        { kind: "role.delete", roleId: dropped.id, occurredAt: at(T0 + 1_000) },
        CONTEXT,
      );

      expect(await ledgerReads.findLiveRole({ roleId: kept.id, organizationId })).toEqual({
        name: "Reviewer",
        description: "Reads traces",
        permissions: ["traces:view", "traces:share"],
      });
      expect(await ledgerReads.hasLiveRole({ roleId: kept.id, organizationId })).toBe(true);
      expect(await ledgerReads.hasLiveRole({ roleId: dropped.id, organizationId })).toBe(false);
      expect(await ledgerReads.findLiveRole({ roleId: kept.id, organizationId: id("org") })).toBe(
        null,
      );
      expect(await ledgerReads.findLiveCustomRole({ roleId: kept.id })).toEqual({
        organizationId,
        permissions: ["traces:view", "traces:share"],
      });
      expect(await ledgerReads.findLiveCustomRole({ roleId: dropped.id })).toBeNull();
    });
  });

  describe.skipIf(backend.skip)("when the directory's own grants are asked for", () => {
    it("names only scim organization grants, live for the ids and both orderings for history", async () => {
      const fixture = await open();
      const { organizationId, repositories } = fixture;
      const [first, second] = [await fixture.user(), await fixture.user()];
      const scim = (principalId: string) =>
        grantRow({ organizationId, principalId, source: "scim" });
      const older = scim(first);
      const newer = scim(second);
      const byHand = grantRow({ organizationId, principalId: first });
      await attach(fixture, older);
      await attach(fixture, byHand);
      // createdAt is the insert's own clock: a tick apart, so "newest" names one row.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await attach(fixture, newer);
      await revoke(fixture, [older.id]);

      expect(
        await repositories.ledgerReads.findDirectoryGrantIds({
          organizationId,
          userIds: [first, second],
        }),
      ).toEqual([newer.id]);
      const history = await repositories.ledgerReads.findDirectoryGrantHistory({
        organizationId,
        limit: 5,
      });
      expect(history.attached.map((row) => row.id)).toEqual([newer.id, older.id]);
      expect(history.removed.map((row) => [row.id, row.principalId])).toEqual([[older.id, first]]);
      expect(history.removed[0]?.revokedAt?.epochMilliseconds).toBe(T0 + 50_000);
    });
  });

  describe.skipIf(backend.skip)("when a leaver's keys and personal teams are listed", () => {
    it("answers the live keys and the teams they own, nobody else's", async () => {
      const fixture = await open();
      const { organizationId, repositories } = fixture;
      const [leaver, colleague] = [await fixture.user(), await fixture.user()];
      const kept = await fixture.apiKey({ userId: leaver });
      await fixture.apiKey({ userId: leaver, revoked: true });
      await fixture.apiKey({ userId: colleague });
      const personal = await fixture.team({ personalFor: leaver });
      await fixture.team({ personalFor: colleague });
      await fixture.team();

      expect(
        await repositories.ledgerReads.findOwnedApiKeys({ userId: leaver, organizationId }),
      ).toEqual([{ id: kept, name: kept }]);
      expect(
        await repositories.ledgerReads.findPersonalTeams({ userId: leaver, organizationId }),
      ).toEqual([{ id: personal, name: personal }]);
    });
  });

  describe.skipIf(backend.skip)("when a member is offboarded", () => {
    it("ends the seat, hands over the live grant ids and clears the legacy rows", async () => {
      const fixture = await open();
      const { organizationId, repositories } = fixture;
      const leaver = await fixture.user();
      const held = grantRow({ organizationId, principalId: leaver });
      await attach(fixture, held);
      const teamId = await fixture.team();
      await fixture.teamMember({ teamId, userId: leaver });
      await fixture.group({ memberIds: [leaver] });
      await fixture.invite(`${leaver}@example.com`);
      const handedOver: string[][] = [];

      const counts = await repositories.ledgerReads.offboardUser({
        userId: leaver,
        organizationId,
        revoke: async (grantIds) => {
          handedOver.push(grantIds);
          await revoke(fixture, grantIds);
        },
        prove: async () => {},
      });

      expect(handedOver).toEqual([[held.id]]);
      expect(counts).toEqual({
        groupMemberships: 1,
        legacyTeamMemberships: 1,
        pendingInvites: 1,
        organizationMembership: true,
      });
      expect(await fixture.isMember(leaver)).toBe(false);
    });

    it("keeps the seat when a live grant survives the revoke", async () => {
      const fixture = await open();
      const { organizationId, repositories } = fixture;
      const leaver = await fixture.user();
      await attach(fixture, grantRow({ organizationId, principalId: leaver }));

      await expect(
        repositories.ledgerReads.offboardUser({
          userId: leaver,
          organizationId,
          revoke: async () => {},
          prove: async () => {},
        }),
      ).rejects.toMatchObject({ code: "offboard_incomplete" });
      expect(await fixture.isMember(leaver)).toBe(true);
    });
  });
});
