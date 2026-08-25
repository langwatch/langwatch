/** @vitest-environment node */

/**
 * The store that applies the write projection's statements.
 *
 * This is where every safety property of the authorization read model lives —
 * the `occurredAt` guards, the columns a redelivered `attached` may NOT
 * restate, and the compat heads the legacy resolver still reads. It had no
 * tests at all, which is how the compat writes came to be deleted without
 * anything noticing.
 *
 * A unit test, and named one: Prisma is a stub, so nothing here opens a
 * socket. The raw-SQL guards are asserted as SQL because that is what they
 * are; whether Postgres honours them is the integration lane's question.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { GrantProjectionWrite } from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsWrite.projection";
import { MIGRATION_OWNED_SOURCES } from "../../authz-engine.facts";
import { PrismaAuthzGrantsWriteRepository } from "../authz-grants-write.prisma.repository";

const ORG = "org_acme";

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant_1",
    organizationId: ORG,
    principalType: "USER",
    principalId: "user_1",
    roleKey: "admin",
    legacyRole: null,
    source: "grants-service",
    scopeType: "TEAM",
    scopeId: "team_1",
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: new Date(1_700_000_000_000),
    ...overrides,
  } as never;
}

function build() {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const prisma = {
    grant: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(grantRow()),
    },
    role: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    roleBinding: {
      upsert: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customRole: {
      upsert: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    shareLink: {
      upsert: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    groupMembership: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (ops: unknown[]) =>
      ops.map(() => ({ count: 1 })),
    ),
  } as never;
  const mocks = prisma as unknown as {
    grant: { updateMany: Mock; findUnique: Mock };
    roleBinding: { upsert: Mock; updateMany: Mock; deleteMany: Mock };
    customRole: { upsert: Mock; updateMany: Mock; deleteMany: Mock };
    shareLink: { upsert: Mock; updateMany: Mock; deleteMany: Mock };
    groupMembership: { updateMany: Mock };
  };
  return {
    prisma: mocks,
    executeRaw,
    repository: new PrismaAuthzGrantsWriteRepository(prisma),
  };
}

/** The SQL the raw upserts emit, flattened to one comparable string. */
function sqlFrom(executeRaw: Mock): string {
  const strings = executeRaw.mock.calls[0]?.[0] as unknown as string[];
  return strings.join("?").replace(/\s+/g, " ");
}

describe("PrismaAuthzGrantsWriteRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a write that states the whole row", () => {
    // Two writes can share a millisecond — a whole attach batch is stamped
    // with one `occurredAtMs` — and a full-row write restates every column.
    // Admitting it on equality lets a redelivered `attached` revert a
    // same-millisecond `role_changed` and put `legacyRole` back, which is a
    // privilege escalation, not a lost update.
    /** @scenario "A redelivered grant event cannot revert a newer one" */
    it("refuses an equal timestamp, not just an older one", async () => {
      const { repository, executeRaw } = build();

      await repository.append({
        kind: "grant.upsert",
        row: grantRow(),
      } as GrantProjectionWrite);

      const sql = sqlFrom(executeRaw);
      expect(sql).toContain('"Grant"."occurredAt" < EXCLUDED."occurredAt"');
      expect(sql).not.toContain(
        '"Grant"."occurredAt" <= EXCLUDED."occurredAt"',
      );
    });

    /** A re-applied attach must never un-revoke a grant: the row's own
     *  revocation is not that event's to state.
     *  @scenario "A redelivered grant event cannot revert a newer one" */
    it("leaves revokedAt out of the columns it restates", async () => {
      const { repository, executeRaw } = build();

      await repository.append({
        kind: "grant.upsert",
        row: grantRow(),
      } as GrantProjectionWrite);

      const updateClause = sqlFrom(executeRaw).split("DO UPDATE SET")[1] ?? "";
      expect(updateClause).not.toContain('"revokedAt"');
      expect(updateClause).not.toContain('"revokedReason"');
    });
  });

  describe("given a write that states one field", () => {
    /** A field-setting write touches only what it names, so applying it on
     *  equality cannot revert anything — and refusing would drop a genuine
     *  same-millisecond change. */
    it("admits an equal timestamp", async () => {
      const { repository, prisma } = build();

      await repository.append({
        kind: "grant.setRole",
        grantId: "grant_1",
        roleKey: "custom:cr_ops",
        occurredAt: new Date(5),
      } as GrantProjectionWrite);

      expect(prisma.grant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ occurredAt: { lte: new Date(5) } }),
        }),
      );
    });

    /**
     * The imported `role` column has to go when the role is reassigned. The
     * legacy resolver reads it when a custom role's permission list is empty,
     * so an ADMIN import reassigned to a new custom role would keep answering
     * ADMIN.
     *
     * @scenario "A reassigned role does not keep the role it was imported with"
     */
    it("clears the imported legacy role rather than carrying it", async () => {
      const { repository, prisma } = build();

      await repository.append({
        kind: "grant.setRole",
        grantId: "grant_1",
        roleKey: "custom:cr_ops",
        occurredAt: new Date(5),
      } as GrantProjectionWrite);

      expect(prisma.grant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ legacyRole: null }),
        }),
      );
    });
  });

  describe("given a group membership write", () => {
    /** @scenario "The first removal is the one that counts" */
    it("refuses to move an earlier removal's timestamp", async () => {
      const { prisma, repository } = build();

      await repository.append({
        kind: "groupMembership.remove",
        membershipId: "groupmember_1",
        reason: "removed again",
        occurredAt: new Date(1_800_000_000_000),
      });

      // `removedAt: null` in the WHERE is the whole guarantee: when access
      // ended is a fact, and a second removal must not restate it. Without
      // it, an admin repeating themselves on Friday would rewrite an audit
      // answer that says Tuesday.
      expect(prisma.groupMembership.updateMany).toHaveBeenCalledWith({
        where: {
          id: "groupmember_1",
          removedAt: null,
          occurredAt: { lte: new Date(1_800_000_000_000) },
        },
        data: {
          removedAt: new Date(1_800_000_000_000),
          removedReason: "removed again",
          occurredAt: new Date(1_800_000_000_000),
        },
      });
    });

    /** @scenario "Restating a membership cannot un-end it" */
    it("never states an ending on the insert, so a redelivery cannot revive one", async () => {
      const { executeRaw, repository } = build();

      await repository.append({
        kind: "groupMembership.upsert",
        row: {
          id: "groupmember_1",
          groupId: "group_1",
          userId: "user_1",
          occurredAt: new Date(1_700_000_000_000),
        },
      });

      const sql = sqlFrom(executeRaw);
      // Neither the inserted columns nor the update list may name the
      // ending. `removedAt` appears in this statement exactly once — inside
      // the live-pair GUARD, which reads it and never writes it.
      const setClause = sql.slice(sql.indexOf("DO UPDATE SET"));
      expect(setClause).not.toContain("removedAt");
      expect(setClause).not.toContain("removedReason");
      expect(sql.match(/"removedAt"/g)).toHaveLength(1);
      expect(sql).toContain('live."removedAt" IS NULL');
      // And it guards on the rows it points at still existing, so a replay
      // after a group deletion converges instead of failing the foreign key.
      expect(sql).toContain('EXISTS (SELECT 1 FROM "Group"');
      expect(sql).toContain('EXISTS (SELECT 1 FROM "User"');
    });
  });

  describe("given the legacy heads the resolver still reads", () => {
    /** @scenario "A grant written to the projection is readable on the legacy head" */
    it("writes the compat binding alongside the grant", async () => {
      const { repository, prisma } = build();

      await repository.append({
        kind: "grant.upsert",
        row: grantRow(),
      } as GrantProjectionWrite);

      expect(prisma.roleBinding.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, id: "grant_1" },
        }),
      );
    });

    // The authoritative row is MARKED and the compat row is REMOVED. The
    // legacy tables have nowhere to record "ended", so a surviving row would
    // leave the legacy resolver answering yes to access that has ended.
    /** @scenario "A revoked grant is gone from the legacy head" */
    it("removes the compat binding when the grant is revoked", async () => {
      const { repository, prisma } = build();

      await repository.append({
        kind: "grant.revoke",
        grantId: "grant_1",
        reason: "offboarded",
        occurredAt: new Date(9),
      } as GrantProjectionWrite);

      expect(prisma.roleBinding.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORG, id: "grant_1" },
      });
    });

    // A redelivered older `attached` loses the occurredAt guard on the
    // authoritative row, which stays revoked. The compat head must follow the
    // authoritative row, not the event: rebuilding the binding from the event
    // would resurrect access the revoke deleted. So a re-read revoked row
    // removes the compat binding rather than upserting it.
    /** @scenario "A redelivered attach after a revoke leaves no compat binding" */
    it("removes the compat binding when the re-read grant is revoked", async () => {
      const { repository, prisma, executeRaw } = build();
      // The guard matched no row (0): this older attach lost to a newer state.
      executeRaw.mockResolvedValue(0);
      // The authoritative row it lost to is revoked.
      // `grantRow()` is typed `never` for the mock signatures it feeds, which
      // is not spreadable; widen it here where the spread needs an object.
      prisma.grant.findUnique.mockResolvedValue({
        ...(grantRow() as Record<string, unknown>),
        revokedAt: new Date(5),
      });

      await repository.append({
        kind: "grant.upsert",
        row: grantRow(),
      } as GrantProjectionWrite);

      expect(prisma.roleBinding.upsert).not.toHaveBeenCalled();
      expect(prisma.roleBinding.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORG, id: "grant_1" },
      });
    });

    // When the guard wins (the common path), the event's own row is the
    // authoritative state, so no re-read is issued — the compat binding is
    // written straight from the event.
    it("skips the re-read when the guard won and writes compat from the event", async () => {
      const { repository, prisma } = build();

      await repository.append({
        kind: "grant.upsert",
        row: grantRow(),
      } as GrantProjectionWrite);

      expect(prisma.grant.findUnique).not.toHaveBeenCalled();
      expect(prisma.roleBinding.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, id: "grant_1" },
        }),
      );
    });

    /**
     * `Grant` is the authority and the compat head is a view of it. A unique
     * or foreign-key conflict on the view must not fail the authoritative
     * write, because a throw here parks the aggregate's whole queue lane.
     */
    it("steps over a conflict on the view rather than parking the lane", async () => {
      const { repository, prisma } = build();
      prisma.roleBinding.upsert.mockRejectedValue(
        Object.assign(new Error("duplicate"), { code: "P2002" }),
      );

      await expect(
        repository.append({
          kind: "grant.upsert",
          row: grantRow(),
        } as GrantProjectionWrite),
      ).resolves.toBeUndefined();
    });

    /** Anything that is not a conflict is a real failure and still raises. */
    it("raises a failure that is not a conflict", async () => {
      const { repository, prisma } = build();
      prisma.roleBinding.upsert.mockRejectedValue(new Error("connection lost"));

      await expect(
        repository.append({
          kind: "grant.upsert",
          row: grantRow(),
        } as GrantProjectionWrite),
      ).rejects.toThrow("connection lost");
    });
  });

  describe("given a migration-sourced grant fact", () => {
    // ADR-110: nothing legacy changes before an organization finalizes. An
    // adopted binding converges onto the row it was read from — an update —
    // while a derived fact (a team membership, the org floor) matches no
    // row and must not be given one. Update-only is what makes both true.
    /** @scenario "Nothing legacy changes before an organization finalizes" */
    // All four owned sources take the update-only path: the three-stage
    // rollout's rows are this migration's too, and a check regressed to
    // `source === "migration"` would silently resume minting bindings for
    // them.
    it.each(
      MIGRATION_OWNED_SOURCES,
    )("updates the compat binding in place and never creates one (%s)", async (source) => {
      const { repository, prisma } = build();

      await repository.append({
        kind: "grant.upsert",
        row: grantRow({ source }),
      } as GrantProjectionWrite);

      expect(prisma.roleBinding.upsert).not.toHaveBeenCalled();
      expect(prisma.roleBinding.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, id: "grant_1" },
        }),
      );
    });

    /** @scenario "Nothing legacy changes before an organization finalizes" */
    it("updates the compat share link in place and never creates one", async () => {
      const { repository, prisma } = build();

      await repository.append({
        kind: "grant.upsert",
        row: grantRow({
          source: "migration",
          principalType: "ANYONE",
          principalId: null,
          roleKey: null,
          scopeType: "RESOURCE",
          scopeId: "trace_1",
          token: "token_1",
          permission: "traces:view",
          resourceKind: "TRACE",
          projectId: "project_1",
        }),
      } as GrantProjectionWrite);

      expect(prisma.shareLink.upsert).not.toHaveBeenCalled();
      expect(prisma.shareLink.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "project_1", id: "grant_1" },
        }),
      );
    });

    /** A live write keeps the create path: only the migration is dark. */
    it("still creates compat rows for live-write sources", async () => {
      const { repository, prisma } = build();

      await repository.append({
        kind: "grant.upsert",
        row: grantRow({ source: "grants-service" }),
      } as GrantProjectionWrite);

      expect(prisma.roleBinding.upsert).toHaveBeenCalled();
      expect(prisma.roleBinding.updateMany).not.toHaveBeenCalled();
    });
  });
});
