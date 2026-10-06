/**
 * @vitest-environment node
 * The contract every authz backend answers the same way, run against each
 * backend the package can reach. The memory tier always runs; Postgres
 * joins as a second row when this package declares that datastore.
 */
import { randomUUID } from "node:crypto";

import { STORED_PRINCIPAL_KIND } from "@langwatch/authz-contract";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nowInstant, Temporal } from "@langwatch/time";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { AuthzManagedGrantRepository } from "../authz-managed-grant.repository.ts";
import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "../memory/authz-memory.store.ts";
import { MemoryAuthzAdmissionRepository } from "../memory/memory.authz-admission.repository.ts";
import { MemoryAuthzAuditTrailRepository } from "../memory/memory.authz-audit-trail.repository.ts";
import { MemoryAuthzCutoverRepository } from "../memory/memory.authz-cutover.repository.ts";
import { MemoryAuthzEpochRepository } from "../memory/memory.authz-epoch.repository.ts";
import { MemoryAuthzGrantProjectionRepository } from "../memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzLedgerReadRepository } from "../memory/memory.authz-ledger-read.repository.ts";
import { MemoryAuthzListingRepository } from "../memory/memory.authz-listing.repository.ts";
import { MemoryAuthzManagedGrantRepository } from "../memory/memory.authz-managed-grant.repository.ts";
import { MemoryAuthzMembershipStampRepository } from "../memory/memory.authz-membership-stamp.repository.ts";
import { MemoryAuthzMigrationRepository } from "../memory/memory.authz-migration.repository.ts";
import { MemoryAuthzPlatformGrantRepository } from "../memory/memory.authz-platform-grant.repository.ts";
import { MemoryAuthzReadRepository } from "../memory/memory.authz-read.repository.ts";
import { MemoryAuthzRevocationRepository } from "../memory/memory.authz-revocation.repository.ts";
import { MemoryAuthzSessionVersionRepository } from "../memory/memory.authz-session-version.repository.ts";
import { MemoryAuthzUserStandingRepository } from "../memory/memory.authz-user-standing.repository.ts";
import { PrismaAuthzManagedGrantRepository } from "../prisma/prisma.authz-managed-grant.repository.ts";

const ORGANIZATION_ID = "org_contract";
const USER_ID = "user_contract";

type Backend = Readonly<{
  name: string;
  create: () => AuthzRepositories & { store: AuthzMemoryStore };
}>;

const backends: readonly Backend[] = [
  {
    name: "memory",
    create: () => {
      const memory = AuthzMemoryStore.create();

      return {
        store: memory,
        bindings: MemoryAuthzManagedGrantRepository.create({ memory }),
        cutover: MemoryAuthzCutoverRepository.create({ memory }),
        admissions: MemoryAuthzAdmissionRepository.create({ memory }),
        userStandings: MemoryAuthzUserStandingRepository.create({ memory }),
        epoch: MemoryAuthzEpochRepository.create({ memory }),
        sessionVersions: MemoryAuthzSessionVersionRepository.create({ memory }),
        auditTrail: MemoryAuthzAuditTrailRepository.create({ memory }),
        platformGrants: MemoryAuthzPlatformGrantRepository.create({ memory }),
        membershipStamps: MemoryAuthzMembershipStampRepository.create({ memory }),
        grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
        revocation: MemoryAuthzRevocationRepository.create({ memory }),
        read: MemoryAuthzReadRepository.create({ memory }),
        listing: MemoryAuthzListingRepository.create({ memory }),
        migration: MemoryAuthzMigrationRepository.create({ memory }),
        ledgerReads: MemoryAuthzLedgerReadRepository.create({ memory }),
      };
    },
  },
];

describe.each(backends)("given the $name authz backend", (backend) => {
  describe("when no row has been written", () => {
    it("reads no cutover for an organization", async () => {
      const { cutover } = backend.create();

      await expect(cutover.findCutover({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
    });

    it("reads no admission marker for a membership", async () => {
      const { admissions } = backend.create();

      await expect(
        admissions.readAdmissionMarker({ organizationId: ORGANIZATION_ID, userId: USER_ID }),
      ).resolves.toEqual({ found: false });
    });

    it("reads no bindings for a user", async () => {
      const { bindings } = backend.create();

      await expect(
        bindings.hasBindingsForUser({ organizationId: ORGANIZATION_ID, userId: USER_ID }),
      ).resolves.toBe(false);
    });

    it("finds no binding by id", async () => {
      const { bindings } = backend.create();

      await expect(
        bindings.findBinding({ organizationId: ORGANIZATION_ID, bindingId: "rb_missing" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a finalized cutover has been written", () => {
    it("reads the status and the business time back", async () => {
      const repositories = backend.create();
      const occurredAt = Temporal.Instant.from("2026-08-18T09:00:00.000Z");
      repositories.store.cutovers.set(ORGANIZATION_ID, {
        organizationId: ORGANIZATION_ID,
        status: "finalized",
        occurredAt,
      });

      await expect(
        repositories.cutover.findCutover({ organizationId: ORGANIZATION_ID }),
      ).resolves.toEqual({ status: "finalized", occurredAt });
    });

    it("keeps another organization's cutover absent", async () => {
      const repositories = backend.create();
      repositories.store.cutovers.set(ORGANIZATION_ID, {
        organizationId: ORGANIZATION_ID,
        status: "finalized",
        occurredAt: null,
      });

      await expect(
        repositories.cutover.findCutover({ organizationId: "org_other" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a binding has been written", () => {
    it("reads it back by id and by user", async () => {
      const repositories = backend.create();
      const binding = {
        id: "rb_1",
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        groupId: null,
        apiKeyId: null,
        role: "MEMBER" as const,
        customRoleId: null,
        scopeType: "ORGANIZATION" as const,
        scopeId: ORGANIZATION_ID,
      };
      repositories.store.bindings.push({ ...binding, createdAt: nowInstant() });

      await expect(
        repositories.bindings.findBinding({
          organizationId: ORGANIZATION_ID,
          bindingId: "rb_1",
        }),
      ).resolves.toEqual(binding);
      await expect(
        repositories.bindings.hasBindingsForUser({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
        }),
      ).resolves.toBe(true);
      await expect(
        repositories.bindings.findDirectUserBindings({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          bindingIds: ["rb_1"],
        }),
      ).resolves.toEqual([binding]);
    });
  });

  describe("when user's and identity's facts reach the standing table", () => {
    const at = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms);

    /** @scenario A deactivated user is inactive to authz until reactivated */
    it("holds a deactivated user inactive, and active again once reactivated", async () => {
      const { userStandings } = backend.create();

      await userStandings.recordDeactivated({ userId: USER_ID, at: at(10) });
      await expect(userStandings.findInactiveUserIds({ userIds: [USER_ID] })).resolves.toEqual([
        USER_ID,
      ]);

      await userStandings.recordReactivated({ userId: USER_ID, at: at(20) });
      await expect(userStandings.findInactiveUserIds({ userIds: [USER_ID] })).resolves.toEqual([]);
    });

    /** @scenario A redelivered user fact changes nothing */
    it("ignores a redelivered or older fact", async () => {
      const { userStandings } = backend.create();

      await userStandings.recordDeactivated({ userId: USER_ID, at: at(10) });
      await userStandings.recordReactivated({ userId: USER_ID, at: at(20) });
      await userStandings.recordDeactivated({ userId: USER_ID, at: at(10) });

      await expect(userStandings.findInactiveUserIds({ userIds: [USER_ID] })).resolves.toEqual([]);
    });

    /** @scenario A deactivation and a reactivation stamped at the same instant leave the user inactive */
    it.each([
      ["reactivation first", ["reactivated", "deactivated"]],
      ["deactivation first", ["deactivated", "reactivated"]],
    ] as const)("holds the user inactive on a tie, %s", async (_order, facts) => {
      const { userStandings } = backend.create();

      for (const fact of facts) {
        const input = { userId: USER_ID, at: at(10) };
        await (fact === "deactivated"
          ? userStandings.recordDeactivated(input)
          : userStandings.recordReactivated(input));
      }

      await expect(userStandings.findInactiveUserIds({ userIds: [USER_ID] })).resolves.toEqual([
        USER_ID,
      ]);
    });

    /** @scenario An erased user stays inactive */
    it("keeps an erased user inactive through a later reactivation", async () => {
      const { userStandings } = backend.create();

      await userStandings.recordErased({ userId: USER_ID, at: at(10) });
      await userStandings.recordErased({ userId: USER_ID, at: at(10) });
      await userStandings.recordReactivated({ userId: USER_ID, at: at(20) });

      await expect(userStandings.findInactiveUserIds({ userIds: [USER_ID] })).resolves.toEqual([
        USER_ID,
      ]);
    });
  });

  describe("when the epoch is bumped", () => {
    it("counts up from absent", async () => {
      const repositories = backend.create();
      const epoch = MemoryAuthzEpochRepository.create({ memory: repositories.store });

      await expect(epoch.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBeNull();
      await epoch.bump({ organizationId: ORGANIZATION_ID });
      await epoch.bump({ organizationId: ORGANIZATION_ID });
      await expect(epoch.findEpoch({ organizationId: ORGANIZATION_ID })).resolves.toBe(2);
    });
  });
});

type HolderKind = "user" | "group" | "team" | "apiKey";

/** One organization on one backend, seeded with the facts a role's holders are read from. */
type HolderFixture = Readonly<{
  bindings: AuthzManagedGrantRepository;
  organizationId: string;
  member: () => Promise<string>;
  outsider: () => Promise<string>;
  team: (memberIds: readonly string[]) => Promise<string>;
  grant: (input: {
    principal: { type: HolderKind; id: string };
    roleKey: string;
    revoked?: boolean;
  }) => Promise<void>;
  close: () => Promise<void>;
}>;

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

function memoryHolderFixture(): HolderFixture {
  const memory = AuthzMemoryStore.create();
  const organizationId = id("org");

  return {
    bindings: MemoryAuthzManagedGrantRepository.create({ memory }),
    organizationId,
    member: async () => {
      const userId = id("user");
      memory.memberships.set(`${organizationId}:${userId}`, {
        role: "MEMBER",
        disabled: false,
        membershipStamp: randomUUID(),
        pendingSsoGrantId: null,
        createdAt: nowInstant(),
      });
      return userId;
    },
    outsider: async () => id("user"),
    team: async (memberIds) => {
      const teamId = id("team");
      memory.teams.push({
        id: teamId,
        organizationId,
        name: "Grants",
        isPersonal: false,
        ownerUserId: null,
      });
      for (const userId of memberIds) {
        memory.teamMemberships.push({
          teamId,
          userId,
          role: "MEMBER",
          assignedRoleId: null,
          createdAt: nowInstant(),
        });
      }
      return teamId;
    },
    grant: async ({ principal, roleKey, revoked = false }) => {
      memory.grants.push({
        id: id("grant"),
        organizationId,
        principalType: STORED_PRINCIPAL_KIND[principal.type],
        principalId: principal.id,
        roleKey,
        legacyRole: null,
        source: "grants-service",
        scopeType: "PROJECT",
        scopeId: id("project"),
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: null,
        expiresAt: null,
        maxViews: null,
        occurredAt: nowInstant(),
        revokedAt: revoked ? nowInstant() : null,
        revokedReason: null,
        createdAt: nowInstant(),
        updatedAt: nowInstant(),
      });
    },
    close: async () => {},
  };
}

/** The integration lane's Postgres; the unit lane never sets it, so the row is skipped there. */
const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
let prisma: PrismaClient | undefined;

async function postgresHolderFixture(): Promise<HolderFixture> {
  prisma ??= new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma;
  const organization = await database.organization.create({
    data: { name: "Holders", slug: `--test-org-${id("holders")}` },
  });
  const organizationId = organization.id;
  const userIds: string[] = [];
  const user = async () => {
    const created = await database.user.create({
      data: { name: "Holder", email: `${id("holder")}@example.com` },
    });
    userIds.push(created.id);
    return created.id;
  };

  return {
    bindings: PrismaAuthzManagedGrantRepository.create({ database }),
    organizationId,
    member: async () => {
      const userId = await user();
      await database.organizationUser.create({ data: { userId, organizationId, role: "MEMBER" } });
      return userId;
    },
    outsider: user,
    team: async (memberIds) => {
      const team = await database.team.create({
        data: { name: "Holders", slug: `--test-team-${id("team")}`, organizationId },
      });
      for (const userId of memberIds) {
        await database.teamUser.create({ data: { userId, teamId: team.id, role: "MEMBER" } });
      }
      return team.id;
    },
    grant: async ({ principal, roleKey, revoked = false }) => {
      await database.grant.create({
        data: {
          id: id("grant"),
          organizationId,
          principalType: STORED_PRINCIPAL_KIND[principal.type],
          principalId: principal.id,
          roleKey,
          source: "grants-service",
          scopeType: "PROJECT",
          scopeId: id("project"),
          occurredAt: new Date(),
          revokedAt: revoked ? new Date() : null,
        },
      });
    },
    close: async () => {
      await cleanupTestRows(database, [
        ["grant", { organizationId }],
        ["teamUser", { team: { organizationId } }],
        ["team", { organizationId }],
        ["organizationUser", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: { in: userIds } }],
      ]);
    },
  };
}

const holderBackends = [
  { name: "memory", skip: false, open: async () => memoryHolderFixture() },
  { name: "postgres", skip: !DB_URL, open: postgresHolderFixture },
];

afterAll(async () => {
  await prisma?.$disconnect();
});

describe.each(holderBackends)("given a role's holders on the $name backend", (backend) => {
  let opened: HolderFixture | undefined;
  const open = async () => {
    opened = await backend.open();
    return opened;
  };

  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });

  const holdersOf = async (
    { bindings, organizationId }: HolderFixture,
    { roleId, limit = 10 }: { roleId: string; limit?: number },
  ) =>
    (await bindings.findRoleHolderPrincipals({ organizationId, roleId, limit }))
      .map((principal) => `${principal.type}:${principal.id}`)
      .toSorted();

  describe.skipIf(backend.skip)(
    "when the role is granted directly, to a group and to a team",
    () => {
      it("reads each live principal of that role, and none revoked or of another role", async () => {
        const fixture = await open();
        const { member, team, grant } = fixture;
        const ada = await member();
        const teamId = await team([ada]);
        await grant({ principal: { type: "user", id: ada }, roleKey: "custom:role_r" });
        await grant({ principal: { type: "group", id: "group_eng" }, roleKey: "custom:role_r" });
        await grant({ principal: { type: "team", id: teamId }, roleKey: "custom:role_r" });
        await grant({ principal: { type: "apiKey", id: "key_1" }, roleKey: "custom:role_r" });
        await grant({
          principal: { type: "user", id: "user_gone" },
          roleKey: "custom:role_r",
          revoked: true,
        });
        await grant({ principal: { type: "user", id: "user_other" }, roleKey: "custom:role_r2" });

        await expect(holdersOf(fixture, { roleId: "role_r" })).resolves.toEqual(
          ["apiKey:key_1", "group:group_eng", `team:${teamId}`, `user:${ada}`].toSorted(),
        );
      });

      it("reads a principal granted the role more than once only once", async () => {
        const fixture = await open();
        const ada = await fixture.member();
        await fixture.grant({ principal: { type: "user", id: ada }, roleKey: "custom:role_r" });
        await fixture.grant({ principal: { type: "user", id: ada }, roleKey: "custom:role_r" });

        await expect(holdersOf(fixture, { roleId: "role_r" })).resolves.toEqual([`user:${ada}`]);
      });

      it("counts the limit in distinct principals, not grant rows", async () => {
        const fixture = await open();
        for (const userId of ["user_a", "user_a", "user_a", "user_b", "user_c"]) {
          await fixture.grant({
            principal: { type: "user", id: userId },
            roleKey: "custom:role_r",
          });
        }

        const capped = await holdersOf(fixture, { roleId: "role_r", limit: 2 });

        expect(capped).toHaveLength(2);
        expect(new Set(capped).size).toBe(2);
        await expect(holdersOf(fixture, { roleId: "role_r", limit: 3 })).resolves.toEqual([
          "user:user_a",
          "user:user_b",
          "user:user_c",
        ]);
      });
    },
  );

  describe.skipIf(backend.skip)(
    "when a team holds members and someone outside the organization",
    () => {
      it("reads only the team's current organization members", async () => {
        const { member, outsider, team, bindings, organizationId } = await open();
        const ada = await member();
        const bo = await member();
        const stranger = await outsider();
        const teamId = await team([ada, stranger]);
        await team([bo]);

        await expect(
          bindings.findTeamMembers({ organizationId, teamIds: [teamId] }),
        ).resolves.toEqual([{ teamId, userId: ada }]);
      });
    },
  );
});
