/**
 * @vitest-environment node
 * The grant heads' contract: the audit trail, the platform tier, membership stamps, the guarded
 * projection writes and the synchronous deny answer the same way on each backend. The memory
 * row always runs; Postgres joins when the integration lane sets its database.
 */
import { randomUUID } from "node:crypto";

import { PLATFORM_OPERATOR_ROLE_ID, PLATFORM_TENANT_ID } from "@langwatch/authz-contract";
import { createTenantId } from "@langwatch/eventing";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { type Instant, Temporal } from "@langwatch/time";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "../memory/authz-memory.store.ts";
import { MemoryAuthzAuditTrailRepository } from "../memory/memory.authz-audit-trail.repository.ts";
import { MemoryAuthzGrantProjectionRepository } from "../memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzMembershipStampRepository } from "../memory/memory.authz-membership-stamp.repository.ts";
import { MemoryAuthzPlatformGrantRepository } from "../memory/memory.authz-platform-grant.repository.ts";
import { MemoryAuthzRevocationRepository } from "../memory/memory.authz-revocation.repository.ts";
import { type GrantRowShape, SHARE_LINK_PERMISSION } from "../prisma/prisma.authz-grant.mapper.ts";
import { PostgresAuthzRepositories } from "../prisma/prisma.authz.repositories.ts";

type HeadRepositories = Pick<
  AuthzRepositories,
  "auditTrail" | "platformGrants" | "membershipStamps" | "grantProjection" | "revocation"
>;

type GrantPeek = {
  roleKey: string | null;
  legacyRole: string | null;
  occurredAtMs: number;
  revokedAtMs: number | null;
  revokedReason: string | null;
} | null;

type HeadsFixture = Readonly<{
  repositories: HeadRepositories;
  /** Exists on both backends, so the bootstrap fence refuses it. */
  organizationId: string;
  /** A project id the share-link compat head is written under; no row backs it. */
  projectId: string;
  member: () => Promise<{ userId: string; membershipStamp: string }>;
  disableMembership: (userId: string) => Promise<void>;
  grant: (id: string) => Promise<GrantPeek>;
  role: (id: string) => Promise<{ name: string; permissions: unknown; deleted: boolean } | null>;
  binding: (id: string) => Promise<{ role: string; customRoleId: string | null } | null>;
  customRole: (id: string) => Promise<{ name: string; permissions: unknown } | null>;
  audit: (id: string) => Promise<{ action: string; metadata: unknown } | null>;
  shareLink: (id: string) => Promise<{ token: string; visibility: string } | null>;
  close: () => Promise<void>;
}>;

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const at = (ms: number): Instant => Temporal.Instant.fromEpochMilliseconds(ms);
const T0 = 1_760_000_000_000;
/** Neither backing reads the store context; the fold hands one, so the test does too. */
const CONTEXT = { aggregateId: "grant", tenantId: createTenantId("org_contract") };

function memoryHeadsFixture(): HeadsFixture {
  const memory = AuthzMemoryStore.create();
  const organizationId = id("org");
  memory.organizations.set(organizationId, { createdAt: at(T0) });
  const projectId = id("project");

  return {
    repositories: {
      auditTrail: MemoryAuthzAuditTrailRepository.create({ memory }),
      platformGrants: MemoryAuthzPlatformGrantRepository.create({ memory }),
      membershipStamps: MemoryAuthzMembershipStampRepository.create({ memory }),
      grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
      revocation: MemoryAuthzRevocationRepository.create({ memory }),
    },
    organizationId,
    projectId,
    member: async () => {
      const userId = id("user");
      const membershipStamp = randomUUID();
      memory.memberships.set(`${organizationId}:${userId}`, {
        role: "MEMBER",
        disabled: false,
        membershipStamp,
        createdAt: at(T0),
      });
      return { userId, membershipStamp };
    },
    disableMembership: async (userId) => {
      const row = memory.memberships.get(memory.membershipKey(organizationId, userId));
      if (row) row.disabled = true;
    },
    grant: async (grantId) => {
      const row = memory.grants.find((stored) => stored.id === grantId);
      if (!row) return null;
      return {
        roleKey: row.roleKey,
        legacyRole: row.legacyRole,
        occurredAtMs: row.occurredAt.epochMilliseconds,
        revokedAtMs: row.revokedAt?.epochMilliseconds ?? null,
        revokedReason: row.revokedReason,
      };
    },
    role: async (roleId) => {
      const row = memory.roleHeads.find((stored) => stored.id === roleId);
      return row
        ? { name: row.name, permissions: row.permissions, deleted: !!row.deletedAt }
        : null;
    },
    binding: async (bindingId) => {
      const row = memory.bindings.find((stored) => stored.id === bindingId);
      return row ? { role: row.role, customRoleId: row.customRoleId } : null;
    },
    customRole: async (roleId) => {
      const row = memory.roles.find((stored) => stored.id === roleId);
      return row ? { name: row.name, permissions: row.permissions } : null;
    },
    audit: async (auditId) => {
      const row = memory.auditLogs.find((stored) => stored.id === auditId);
      return row ? { action: row.action, metadata: row.metadata } : null;
    },
    shareLink: async (linkId) => {
      const row = memory.shareLinks.find((stored) => stored.id === linkId);
      return row ? { token: row.token, visibility: row.visibility } : null;
    },
    close: async () => {},
  };
}

/** The integration lane's Postgres; the unit lane never sets it, so the row is skipped there. */
const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
let prisma: PrismaClient | undefined;

async function postgresHeadsFixture(): Promise<HeadsFixture> {
  prisma ??= new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma;
  const organization = await database.organization.create({
    data: { name: "Heads", slug: `--test-org-${id("heads")}` },
  });
  const organizationId = organization.id;
  const projectId = id("project");
  const userIds: string[] = [];

  return {
    repositories: PostgresAuthzRepositories.create({ prisma: database }),
    organizationId,
    projectId,
    member: async () => {
      const user = await database.user.create({
        data: { name: "Head", email: `${id("head")}@example.com` },
      });
      userIds.push(user.id);
      const membership = await database.organizationUser.create({
        data: { userId: user.id, organizationId, role: "MEMBER" },
      });
      return { userId: user.id, membershipStamp: membership.membershipStamp };
    },
    disableMembership: async (userId) => {
      await database.organizationUser.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { disabledAt: new Date() },
      });
    },
    grant: async (grantId) => {
      const row = await database.grant.findUnique({ where: { id: grantId } });
      if (!row) return null;
      return {
        roleKey: row.roleKey,
        legacyRole: row.legacyRole,
        occurredAtMs: row.occurredAt.getTime(),
        revokedAtMs: row.revokedAt?.getTime() ?? null,
        revokedReason: row.revokedReason,
      };
    },
    role: async (roleId) => {
      const row = await database.role.findUnique({ where: { id: roleId } });
      return row
        ? { name: row.name, permissions: row.permissions, deleted: !!row.deletedAt }
        : null;
    },
    binding: async (bindingId) => {
      const row = await database.roleBinding.findFirst({
        where: { organizationId, id: bindingId },
      });
      return row ? { role: row.role, customRoleId: row.customRoleId } : null;
    },
    customRole: async (roleId) => {
      const row = await database.customRole.findFirst({ where: { organizationId, id: roleId } });
      return row ? { name: row.name, permissions: row.permissions } : null;
    },
    audit: async (auditId) => {
      const row = await database.auditLog.findUnique({ where: { id: auditId } });
      return row ? { action: row.action, metadata: row.metadata } : null;
    },
    shareLink: async (linkId) => {
      const row = await database.shareLink.findFirst({ where: { projectId, id: linkId } });
      return row ? { token: row.token, visibility: row.visibility } : null;
    },
    close: async () => {
      await cleanupTestRows(database, [
        ["shareLink", { projectId }],
        ["roleBinding", { organizationId }],
        ["customRole", { organizationId }],
        ["grant", { principalId: { in: userIds } }],
        ["grant", { organizationId }],
        ["grant", { projectId }],
        ["role", { organizationId }],
        ["auditLog", { organizationId }],
        ["organizationUser", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: { in: userIds } }],
      ]);
    },
  };
}

const backends = [
  { name: "memory", skip: false, open: async () => memoryHeadsFixture() },
  { name: "postgres", skip: !DB_URL, open: postgresHeadsFixture },
];

afterAll(async () => {
  await prisma?.$disconnect();
});

type GrantOverrides = Partial<Omit<GrantRowShape, "organizationId" | "principalId">>;

function userGrant(
  overrides: GrantOverrides & { organizationId: string; principalId: string },
): GrantRowShape {
  return {
    id: id("grant"),
    principalType: "USER",
    roleKey: "member",
    legacyRole: null,
    source: "grants-service",
    scopeType: "TEAM",
    scopeId: id("team"),
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: at(T0),
    ...overrides,
  };
}

describe.each(backends)("given the grant heads on the $name backend", (backend) => {
  let opened: HeadsFixture | undefined;
  const open = async () => {
    opened = await backend.open();
    return opened;
  };

  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });

  describe.skipIf(backend.skip)("when an audit fact is delivered twice", () => {
    it("keeps the first row and never updates it", async () => {
      const heads = await open();
      const auditId = id("audit");
      const row = {
        id: auditId,
        createdAt: at(T0),
        userId: null,
        organizationId: heads.organizationId,
        metadata: { grantId: "grant_1" },
      };

      await heads.repositories.auditTrail.insert({ ...row, action: "authz.grants.attach" });
      await heads.repositories.auditTrail.insert({ ...row, action: "authz.grants.revoke" });

      expect(await heads.audit(auditId)).toEqual({
        action: "authz.grants.attach",
        metadata: { grantId: "grant_1" },
      });
    });
  });

  describe.skipIf(backend.skip)("when platform-operator grants are projected", () => {
    it("reads the holder's live, unexpired grants oldest first, narrowed by id", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const operator = (overrides: GrantOverrides) =>
        userGrant({
          organizationId: PLATFORM_TENANT_ID,
          principalId: userId,
          roleKey: PLATFORM_OPERATOR_ROLE_ID,
          scopeType: "PLATFORM",
          scopeId: PLATFORM_TENANT_ID,
          ...overrides,
        });
      const newer = operator({ occurredAt: at(T0 + 2_000) });
      const older = operator({ occurredAt: at(T0 + 1_000) });
      const expired = operator({ expiresAt: at(T0) });
      const revoked = operator({});
      const otherRole = operator({ roleKey: "admin" });
      for (const row of [newer, older, expired, revoked, otherRole]) {
        await heads.repositories.grantProjection.append({ kind: "grant.upsert", row }, CONTEXT);
      }
      await heads.repositories.revocation.enforceGrantRevocation({
        organizationId: PLATFORM_TENANT_ID,
        grantIds: [revoked.id],
        reason: "revocation",
      });

      const held = await heads.repositories.platformGrants.findGrants({ userId });
      expect(held.map((grant) => grant.grantId)).toEqual([older.id, newer.id]);
      expect(held[0]?.grantedAt.epochMilliseconds).toBe(T0 + 1_000);
      await expect(
        heads.repositories.platformGrants.findGrants({ grantId: newer.id }),
      ).resolves.toEqual([{ grantId: newer.id, userId, grantedAt: at(T0 + 2_000) }]);
    });
  });

  describe.skipIf(backend.skip)("when membership stamps are read", () => {
    it("reads each live membership asked for, and no disabled or absent one", async () => {
      const heads = await open();
      const live = await heads.member();
      const disabled = await heads.member();
      await heads.disableMembership(disabled.userId);

      const rows = await heads.repositories.membershipStamps.findLockedStamps({
        organizationId: heads.organizationId,
        userIds: [live.userId, disabled.userId, id("user"), live.userId],
      });

      expect(rows).toEqual([live]);
      await expect(
        heads.repositories.membershipStamps.findLockedStamps({
          organizationId: heads.organizationId,
          userIds: [],
        }),
      ).resolves.toEqual([]);
    });
  });

  describe.skipIf(backend.skip)("when a grant is written whole", () => {
    it("lands a newer write, refuses an older or equal one, and keeps the revocation mark", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const row = userGrant({ organizationId: heads.organizationId, principalId: userId });
      const write = (overrides: GrantOverrides) =>
        heads.repositories.grantProjection.append(
          { kind: "grant.upsert", row: { ...row, ...overrides } },
          CONTEXT,
        );

      await write({});
      await write({ roleKey: "viewer" });
      await write({ roleKey: "viewer", occurredAt: at(T0 - 1) });
      expect((await heads.grant(row.id))?.roleKey).toBe("member");

      await heads.repositories.revocation.enforceGrantRevocation({
        organizationId: heads.organizationId,
        grantIds: [row.id],
        reason: "revocation",
        revokedAt: at(T0 + 500),
        revokedReason: "left",
      });
      await write({ roleKey: "admin", occurredAt: at(T0 + 1_000) });

      expect(await heads.grant(row.id)).toEqual({
        roleKey: "admin",
        legacyRole: null,
        occurredAtMs: T0 + 1_000,
        revokedAtMs: T0 + 500,
        revokedReason: "left",
      });
    });

    it("fences a stamped user grant on the live membership generation", async () => {
      const heads = await open();
      const { userId, membershipStamp } = await heads.member();
      const stale = userGrant({ organizationId: heads.organizationId, principalId: userId });
      const fresh = userGrant({ organizationId: heads.organizationId, principalId: userId });
      const bootstrap = userGrant({
        organizationId: heads.organizationId,
        principalId: userId,
        roleKey: "admin",
      });

      const append = heads.repositories.grantProjection;
      await append.append(
        { kind: "grant.upsert", row: stale, membershipStamp: randomUUID() },
        CONTEXT,
      );
      await append.append({ kind: "grant.upsert", row: fresh, membershipStamp }, CONTEXT);
      await append.append(
        {
          kind: "grant.upsert",
          row: bootstrap,
          membershipStamp: randomUUID(),
          membershipBootstrap: true,
        },
        CONTEXT,
      );

      expect(await heads.grant(stale.id)).toBeNull();
      expect(await heads.grant(fresh.id)).not.toBeNull();
      expect(await heads.grant(bootstrap.id)).toBeNull();
    });

    it("admits the founding admin of an organization that does not exist yet", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const founding = userGrant({
        organizationId: id("org"),
        principalId: userId,
        roleKey: "admin",
      });
      founding.scopeType = "ORGANIZATION";
      founding.scopeId = founding.organizationId;

      await heads.repositories.grantProjection.append(
        {
          kind: "grant.upsert",
          row: founding,
          membershipStamp: randomUUID(),
          membershipBootstrap: true,
        },
        CONTEXT,
      );

      expect((await heads.grant(founding.id))?.roleKey).toBe("admin");
      await heads.repositories.grantProjection.append(
        {
          kind: "grant.revoke",
          organizationId: founding.organizationId,
          grantId: founding.id,
          reason: null,
          occurredAt: at(T0 + 1),
        },
        CONTEXT,
      );
      expect((await heads.grant(founding.id))?.revokedAtMs).toBe(T0 + 1);
    });
  });

  describe.skipIf(backend.skip)("when one field of a grant changes", () => {
    it("admits an equal timestamp, refuses an older one, and clears the legacy role", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const row = userGrant({
        organizationId: heads.organizationId,
        principalId: userId,
        legacyRole: "MEMBER",
        source: "legacy-import",
      });
      const projection = heads.repositories.grantProjection;
      await projection.append({ kind: "grant.upsert", row }, CONTEXT);

      await projection.bulkAppend?.(
        [
          { kind: "grant.setRole", grantId: row.id, roleKey: "viewer", occurredAt: at(T0) },
          { kind: "grant.setRole", grantId: row.id, roleKey: "admin", occurredAt: at(T0 - 1) },
        ],
        CONTEXT,
      );

      expect(await heads.grant(row.id)).toMatchObject({
        roleKey: "viewer",
        legacyRole: null,
        occurredAtMs: T0,
      });
    });
  });

  describe.skipIf(backend.skip)("when a grant is revoked", () => {
    it("marks it once, removes its compat binding, and ends nothing in another organization", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const row = userGrant({ organizationId: heads.organizationId, principalId: userId });
      const projection = heads.repositories.grantProjection;
      await projection.append({ kind: "grant.upsert", row }, CONTEXT);
      expect(await heads.binding(row.id)).toEqual({ role: "MEMBER", customRoleId: null });

      const revoke = (organizationId: string, ms: number) =>
        projection.append(
          {
            kind: "grant.revoke",
            organizationId,
            grantId: row.id,
            reason: `reason-${ms}`,
            occurredAt: at(ms),
          },
          CONTEXT,
        );
      await revoke(id("org"), T0 + 1);
      expect((await heads.grant(row.id))?.revokedAtMs).toBeNull();
      expect(await heads.binding(row.id)).not.toBeNull();

      await revoke(heads.organizationId, T0 + 2);
      await revoke(heads.organizationId, T0 + 3);

      expect(await heads.grant(row.id)).toMatchObject({
        revokedAtMs: T0 + 2,
        revokedReason: `reason-${T0 + 2}`,
      });
      expect(await heads.binding(row.id)).toBeNull();
    });
  });

  describe.skipIf(backend.skip)("when the synchronous deny runs", () => {
    it("marks only the named organization's live grants and keeps an earlier mark", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const first = userGrant({ organizationId: heads.organizationId, principalId: userId });
      const second = userGrant({ organizationId: heads.organizationId, principalId: userId });
      for (const row of [first, second]) {
        await heads.repositories.grantProjection.append({ kind: "grant.upsert", row }, CONTEXT);
      }
      const deny = (grantIds: string[], organizationId: string, ms: number) =>
        heads.repositories.revocation.enforceGrantRevocation({
          organizationId,
          grantIds,
          reason: "offboard",
          revokedAt: at(ms),
          revokedReason: `offboarded:${ms}`,
        });

      await deny([first.id], heads.organizationId, T0 + 10);
      await deny([first.id, second.id], id("org"), T0 + 20);
      await deny([], heads.organizationId, T0 + 30);
      await deny([first.id, second.id], heads.organizationId, T0 + 40);

      expect(await heads.grant(first.id)).toMatchObject({
        revokedAtMs: T0 + 10,
        revokedReason: `offboarded:${T0 + 10}`,
        occurredAtMs: T0,
      });
      expect((await heads.grant(second.id))?.revokedAtMs).toBe(T0 + 40);
    });
  });

  describe.skipIf(backend.skip)("when a custom role is defined, changed and deleted", () => {
    it("guards the name, follows the live head in the compat role and drops its bindings", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const { organizationId } = heads;
      const projection = heads.repositories.grantProjection;
      const roleId = id("customrole");
      const role = {
        id: roleId,
        organizationId,
        name: "Reviewer",
        description: null,
        permissions: ["traces:view"],
        kind: "custom",
        occurredAt: at(T0),
      };
      await projection.append({ kind: "role.upsert", row: role }, CONTEXT);
      const rival = { ...role, id: id("customrole"), occurredAt: at(T0 + 1) };
      await projection.append({ kind: "role.upsert", row: rival }, CONTEXT);
      await projection.append(
        {
          kind: "role.setPermissions",
          roleId,
          permissions: ["traces:view", "traces:share"],
          occurredAt: at(T0 + 2),
        },
        CONTEXT,
      );
      const holder = userGrant({
        organizationId,
        principalId: userId,
        roleKey: `custom:${roleId}`,
      });
      await projection.append({ kind: "grant.upsert", row: holder }, CONTEXT);

      expect(await heads.role(rival.id)).toBeNull();
      expect(await heads.customRole(roleId)).toEqual({
        name: "Reviewer",
        permissions: ["traces:view", "traces:share"],
      });
      expect(await heads.binding(holder.id)).toEqual({ role: "CUSTOM", customRoleId: roleId });

      await projection.append({ kind: "role.delete", roleId, occurredAt: at(T0 + 3) }, CONTEXT);

      expect(await heads.role(roleId)).toMatchObject({ deleted: true });
      expect(await heads.customRole(roleId)).toBeNull();
      expect(await heads.binding(holder.id)).toBeNull();
    });
  });

  describe.skipIf(backend.skip)("when a grant names a custom role no compat row holds", () => {
    it("lands the grant and its compat binding, as no foreign key is enforced", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const row = userGrant({
        organizationId: heads.organizationId,
        principalId: userId,
        roleKey: `custom:${id("customrole")}`,
      });

      await heads.repositories.grantProjection.append({ kind: "grant.upsert", row }, CONTEXT);

      expect(await heads.grant(row.id)).not.toBeNull();
      expect(await heads.binding(row.id)).toEqual({
        role: "CUSTOM",
        customRoleId: row.roleKey?.slice("custom:".length),
      });
    });
  });

  const shareGrant = ({ organizationId, projectId }: HeadsFixture, token = id("token")) => ({
    ...userGrant({ organizationId, principalId: "unused", roleKey: null }),
    principalType: "ANYONE" as const,
    principalId: null,
    scopeType: "RESOURCE" as const,
    scopeId: id("trace"),
    token,
    permission: SHARE_LINK_PERMISSION,
    resourceKind: "TRACE",
    projectId,
  });

  describe.skipIf(backend.skip)("when a share-link grant is projected", () => {
    it("writes the compat share link from the grant and removes it on revoke", async () => {
      const heads = await open();
      const row = shareGrant(heads);
      const projection = heads.repositories.grantProjection;
      await projection.append({ kind: "grant.upsert", row }, CONTEXT);

      expect(await heads.shareLink(row.id)).toEqual({ token: row.token, visibility: "PUBLIC" });

      await projection.append(
        {
          kind: "grant.revoke",
          organizationId: heads.organizationId,
          grantId: row.id,
          reason: null,
          occurredAt: at(T0 + 1),
        },
        CONTEXT,
      );
      expect(await heads.shareLink(row.id)).toBeNull();
    });
  });

  describe.skipIf(backend.skip)("when a grant names a token another grant holds", () => {
    it("refuses the write, and a batch carrying it writes none of its rows", async () => {
      const heads = await open();
      const holder = shareGrant(heads);
      const rival = shareGrant(heads, holder.token);
      const bystander = shareGrant(heads);
      const projection = heads.repositories.grantProjection;
      await projection.append({ kind: "grant.upsert", row: holder }, CONTEXT);

      await expect(
        projection.append({ kind: "grant.upsert", row: rival }, CONTEXT),
      ).rejects.toThrow(/Grant_token_key/);
      await expect(
        projection.bulkAppend?.(
          [
            { kind: "grant.upsert", row: bystander },
            { kind: "grant.upsert", row: rival },
          ],
          CONTEXT,
        ),
      ).rejects.toThrow(/Grant_token_key/);

      expect(await heads.grant(rival.id)).toBeNull();
      expect(await heads.grant(bystander.id)).toBeNull();
    });
  });

  describe.skipIf(backend.skip)("when a grant holds only some resource terms", () => {
    it("refuses the write", async () => {
      const heads = await open();
      const { userId } = await heads.member();
      const row = userGrant({ organizationId: heads.organizationId, principalId: userId });

      await expect(
        heads.repositories.grantProjection.append(
          { kind: "grant.upsert", row: { ...row, token: id("token") } },
          CONTEXT,
        ),
      ).rejects.toThrow(/Grant_resource_terms_check/);
      expect(await heads.grant(row.id)).toBeNull();
    });
  });
});
