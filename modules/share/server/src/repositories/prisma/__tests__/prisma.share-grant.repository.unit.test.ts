import { describe, expect, it, vi } from "vitest";
import { PrismaShareGrantRepository } from "../prisma.share-grant.repository.ts";

/**
 * ADR-092 (D-PR3-10). A cut-over view is counted once — on the usage row that
 * is its authority, mirrored onto the compat row a rollback would restore.
 * Both writes ride ONE transaction; neither may reach the root client.
 */

const ORGANIZATION_ID = "organization_share_1";
const PROJECT_ID = "project_share_1";

type GrantDatabase = Parameters<typeof PrismaShareGrantRepository.create>[0]["prisma"];

/** What a conditioned `update` raises when its filter matches no row. */
const recordNotFound = () => Object.assign(new Error("record not found"), { code: "P2025" });
const uniqueViolation = () => Object.assign(new Error("unique violation"), { code: "P2002" });

function buildRepository(usage: {
  update?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
}) {
  // The consume and its compat mirror run on the TRANSACTION client; the
  // root client's own write surfaces stay separate mocks so a test can
  // prove the writes never bypass the transaction.
  const grantUsage = {
    update: usage.update ?? vi.fn().mockResolvedValue(void 0),
    create: usage.create ?? vi.fn().mockResolvedValue(void 0),
  };
  const compatMirror = vi.fn().mockResolvedValue(void 0);
  const rootGrantUsage = {
    update: vi.fn().mockResolvedValue(void 0),
    create: vi.fn().mockResolvedValue(void 0),
  };
  const shareLink = {
    findFirst: vi.fn().mockResolvedValue({ id: "share_1" }),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(void 0),
  };
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
    run({ grantUsage, shareLink: { update: compatMirror } }),
  );
  const prisma = {
    project: {
      findUnique: vi.fn().mockResolvedValue({ team: { organizationId: ORGANIZATION_ID } }),
    },
    grant: { findMany: vi.fn().mockResolvedValue([]) },
    grantUsage: rootGrantUsage,
    shareLink,
    $transaction: transaction,
  } as unknown as GrantDatabase;

  return {
    grantUsage,
    rootGrantUsage,
    compatMirror,
    shareLink,
    transaction,
    repository: PrismaShareGrantRepository.create({ prisma }),
  };
}

describe("PrismaShareGrantRepository", () => {
  describe("when a view is consumed", () => {
    /** @scenario "A consumed view and its compat mirror commit together" */
    it("creates the usage row on the first view and mirrors the count in the same transaction", async () => {
      const create = vi.fn().mockResolvedValue(void 0);
      const { repository, compatMirror, transaction, rootGrantUsage, shareLink } = buildRepository({
        update: vi.fn().mockRejectedValue(recordNotFound()),
        create,
      });

      const consumed = await repository.consumeUsage({
        grantId: "share_1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        maxViews: 2,
      });

      expect(consumed).toBe(true);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          grantId: "share_1",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          viewCount: 1,
        }),
      });
      expect(compatMirror).toHaveBeenCalledWith({
        where: {
          id: "share_1",
          projectId: PROJECT_ID,
          viewCount: { lt: 2 },
        },
        data: { viewCount: { increment: 1 } },
      });
      // Neither write may bypass the transaction: a crash between the
      // consume and the mirror is exactly the drift this pins out.
      expect(rootGrantUsage.update).not.toHaveBeenCalled();
      expect(rootGrantUsage.create).not.toHaveBeenCalled();
      expect(shareLink.update).not.toHaveBeenCalled();
    });

    it("increments the usage row while the link is uncapped", async () => {
      const update = vi.fn().mockResolvedValue(void 0);
      const create = vi.fn();
      const { repository, compatMirror } = buildRepository({ update, create });

      const consumed = await repository.consumeUsage({
        grantId: "share_1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        maxViews: null,
      });

      expect(consumed).toBe(true);
      expect(update).toHaveBeenCalledWith({
        where: {
          grantId: "share_1",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
        },
        data: expect.objectContaining({ viewCount: { increment: 1 } }),
      });
      expect(create).not.toHaveBeenCalled();
      expect(compatMirror).toHaveBeenCalledWith({
        where: { id: "share_1", projectId: PROJECT_ID },
        data: { viewCount: { increment: 1 } },
      });
    });

    /** @scenario "A view that loses the first-view race retries in a fresh transaction" */
    it("retries the conditioned increment in its own transaction after losing the create race", async () => {
      // The guarded create's unique violation aborts the transaction it
      // ran in, so the single conditioned retry must open a fresh one.
      const update = vi
        .fn()
        .mockRejectedValueOnce(recordNotFound())
        .mockResolvedValueOnce(void 0);
      const create = vi.fn().mockRejectedValue(uniqueViolation());
      const { repository, transaction, compatMirror } = buildRepository({ update, create });

      const consumed = await repository.consumeUsage({
        grantId: "share_1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        maxViews: 2,
      });

      expect(consumed).toBe(true);
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledTimes(2);
      expect(compatMirror).toHaveBeenCalledTimes(1);
    });

    it("mirrors nothing when the retry finds the cap already spent", async () => {
      const update = vi.fn().mockRejectedValue(recordNotFound());
      const create = vi.fn().mockRejectedValue(uniqueViolation());
      const { repository, compatMirror } = buildRepository({ update, create });

      const consumed = await repository.consumeUsage({
        grantId: "share_1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        maxViews: 1,
      });

      expect(consumed).toBe(false);
      expect(compatMirror).not.toHaveBeenCalled();
    });

    it("fences the increment on the cap when the link is capped", async () => {
      const update = vi.fn().mockResolvedValue(void 0);
      const { repository } = buildRepository({ update });

      await repository.consumeUsage({
        grantId: "share_1",
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        maxViews: 3,
      });

      expect(update).toHaveBeenCalledWith({
        where: {
          grantId: "share_1",
          organizationId: ORGANIZATION_ID,
          // The project is part of the row's tenancy, not decoration: a
          // consume must never count against another project's row.
          projectId: PROJECT_ID,
          viewCount: { lt: 3 },
        },
        data: expect.objectContaining({ viewCount: { increment: 1 } }),
      });
    });
  });

  describe("when the grant ids for a resource are read", () => {
    it("fences every read on the organization and the project", async () => {
      const { repository, prismaGrant } = buildGrantReader();

      await repository.findAllResourceGrantIds({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        resourceKind: "TRACE",
        resourceId: "trace_1",
      });

      expect(prismaGrant.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORGANIZATION_ID,
          revokedAt: null,
          projectId: PROJECT_ID,
          scopeType: "RESOURCE",
          resourceKind: "TRACE",
          scopeId: "trace_1",
        },
        select: { id: true },
      });
    });
  });
});

function buildGrantReader() {
  const grant = { findMany: vi.fn().mockResolvedValue([]) };
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue(null) },
    grant,
    grantUsage: { update: vi.fn(), create: vi.fn() },
    shareLink: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  } as unknown as GrantDatabase;

  return { prismaGrant: grant, repository: PrismaShareGrantRepository.create({ prisma }) };
}
