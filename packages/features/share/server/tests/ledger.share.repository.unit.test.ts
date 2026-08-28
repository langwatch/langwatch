import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ShareLink } from "@langwatch/share-contract";
import { describe, expect, it, vi } from "vitest";
import { LedgerShareRepository } from "../src/repositories/ledger/ledger.share.repository";
import type { ShareRepository } from "../src/repositories/share.repository";

/**
 * ADR-092 delivery-plan PR 3 (D-PR3-10). Two properties carry this file: a
 * share write goes to exactly one of the two writers, decided per
 * organization by the cutover gate, and the view a cut-over organization
 * consumes is counted once - on the usage row that is its authority, and
 * mirrored onto the compat row that a rollback would make the authority
 * again.
 *
 * What this file asserts is the STATEMENTS the repository issues and the
 * branch it takes. What the database does with them - the conditional
 * increment losing to a cap, the unique violation that tells a first view
 * from a spent one, and the count the engine's share-link read then reports -
 * is Postgres behaviour, and a mock of it is only ever a restatement of what
 * we already believe. Those cases live in
 * `share.ledger.repository.integration.test.ts`, against a real one.
 */

const ORGANIZATION_ID = "organization_share_1";
const PROJECT_ID = "project_share_1";
const TRACE_ID = "trace_share_1";

const shareRow = (overrides: Partial<ShareLink> = {}): ShareLink =>
  ({
    id: "share_1",
    token: "tok_abc",
    resourceType: "TRACE",
    resourceId: TRACE_ID,
    threadId: null,
    projectId: PROJECT_ID,
    userId: null,
    visibility: "PUBLIC",
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as ShareLink;

/** What a conditioned `update` raises when its filter matches no row. */
const recordNotFound = () =>
  Object.assign(new Error("record not found"), { code: "P2025" });

const spyLegacy = (): ShareRepository =>
  ({
    tryFindByToken: vi.fn().mockResolvedValue(null),
    tryFindById: vi.fn().mockResolvedValue(shareRow()),
    listByResource: vi.fn().mockResolvedValue([]),
    hasActiveShareForResource: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue(shareRow({ id: "legacy_share" })),
    consumeView: vi.fn().mockResolvedValue(true),
    deleteById: vi.fn().mockResolvedValue(void 0),
    deleteByResource: vi.fn().mockResolvedValue(void 0),
    findAllTraceShareResourceIds: vi.fn().mockResolvedValue([]),
    deleteAllTraceShares: vi.fn().mockResolvedValue(void 0),
  }) as unknown as ShareRepository;

function buildRepository({
  onEngine,
  grantIds = [],
  usage,
  compat,
}: {
  onEngine: boolean;
  grantIds?: string[];
  usage?: {
    update?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
  };
  compat?: {
    findFirst?: ReturnType<typeof vi.fn>;
    findMany?: ReturnType<typeof vi.fn>;
  };
}) {
  const legacy = spyLegacy();
  const grantFindMany = vi.fn().mockResolvedValue(grantIds.map((id) => ({ id })));
  // The consume and its compat mirror run on the TRANSACTION client; the
  // root client's own write surfaces stay separate mocks so a test can
  // prove the writes never bypass the transaction.
  const grantUsage = {
    update: usage?.update ?? vi.fn().mockResolvedValue(void 0),
    create: usage?.create ?? vi.fn().mockResolvedValue(void 0),
  };
  const compatMirror = vi.fn().mockResolvedValue(void 0);
  const rootGrantUsage = {
    update: vi.fn().mockResolvedValue(void 0),
    create: vi.fn().mockResolvedValue(void 0),
  };
  const shareLink = {
    findFirst: compat?.findFirst ?? vi.fn().mockResolvedValue({ id: "share_1" }),
    findMany: compat?.findMany ?? vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(void 0),
  };
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
    run({ grantUsage, shareLink: { update: compatMirror } }),
  );
  const cutoverFindUnique = vi
    .fn()
    .mockResolvedValue(onEngine ? { status: "finalized" } : null);
  const prisma = {
    systemMigrationTenantState: { findUnique: cutoverFindUnique },
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ team: { organizationId: ORGANIZATION_ID } }),
    },
    grant: { findMany: grantFindMany },
    grantUsage: rootGrantUsage,
    shareLink,
    $transaction: transaction,
  } as unknown as PrismaClient;
  const writer = {
    attachResourceGrant: vi.fn().mockResolvedValue(void 0),
    revokeResourceGrants: vi.fn().mockResolvedValue(void 0),
  } as unknown as AuthzGrantsService;
  const authz = {
    isOnEngine: vi.fn().mockResolvedValue(onEngine),
  } as unknown as AuthzService;

  return {
    legacy,
    writer,
    grantFindMany,
    grantUsage,
    rootGrantUsage,
    compatMirror,
    shareLink,
    transaction,
    cutoverFindUnique,
    repository: LedgerShareRepository.create({
      legacy,
      prisma,
      grants: writer,
      authz,
    }),
  };
}

const createParams = {
  token: "tok_new",
  projectId: PROJECT_ID,
  resourceType: "TRACE" as const,
  resourceId: TRACE_ID,
};

describe("LedgerShareRepository", () => {
  describe("given the organization has not been cut over", () => {
    it("keeps legacy writes while routing revocations through the AuthZ capability", async () => {
      const { repository, legacy, writer } = buildRepository({
        onEngine: false,
        grantIds: ["share_1"],
      });

      await repository.create(createParams);
      await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });
      await repository.deleteByResource({
        projectId: PROJECT_ID,
        resourceType: "TRACE",
        resourceId: TRACE_ID,
      });
      await repository.deleteAllTraceShares(PROJECT_ID);
      await repository.consumeView({
        id: "share_1",
        projectId: PROJECT_ID,
        maxViews: null,
      });

      expect(legacy.create).toHaveBeenCalledWith(createParams);
      expect(legacy.deleteById).toHaveBeenCalledTimes(1);
      expect(legacy.deleteByResource).toHaveBeenCalledTimes(1);
      expect(legacy.deleteAllTraceShares).toHaveBeenCalledTimes(1);
      expect(legacy.consumeView).toHaveBeenCalledTimes(1);
      expect(writer.attachResourceGrant).not.toHaveBeenCalled();
      // The service owns the per-organization cutover decision. Calling it is
      // harmless on the legacy path and keeps that routing out of this adapter.
      expect(writer.revokeResourceGrants).toHaveBeenCalledTimes(3);
    });

    it("reads through the Prisma repository, as it does for every organization", async () => {
      const { repository, legacy } = buildRepository({ onEngine: false });

      await repository.tryFindByToken("tok_abc");
      await repository.tryFindById({ id: "share_1", projectId: PROJECT_ID });
      await repository.listByResource({
        projectId: PROJECT_ID,
        resourceType: "TRACE",
        resourceId: TRACE_ID,
      });
      await repository.hasActiveShareForResource({
        projectId: PROJECT_ID,
        resourceType: "TRACE",
        resourceId: TRACE_ID,
      });
      await repository.findAllTraceShareResourceIds(PROJECT_ID);

      expect(legacy.tryFindByToken).toHaveBeenCalledTimes(1);
      expect(legacy.tryFindById).toHaveBeenCalledTimes(1);
      expect(legacy.listByResource).toHaveBeenCalledTimes(1);
      expect(legacy.hasActiveShareForResource).toHaveBeenCalledTimes(1);
      expect(legacy.findAllTraceShareResourceIds).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the organization is cut over", () => {
    describe("when a link is minted", () => {
      it("states the fact with the link's own terms and returns the row the fold wrote", async () => {
        const { repository, legacy, writer } = buildRepository({
          onEngine: true,
        });
        const expiresAt = new Date("2026-01-01T00:00:00.000Z");

        const row = await repository.create({
          ...createParams,
          expiresAt,
          maxViews: 3,
          userId: "user_1",
        });

        expect(writer.attachResourceGrant).toHaveBeenCalledTimes(1);
        const emission = vi.mocked(writer.attachResourceGrant).mock.calls[0]?.[0];
        expect(emission).toMatchObject({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          scopeId: TRACE_ID,
          principal: { type: "anyone", id: null },
          resource: {
            token: "tok_new",
            permission: "traces:view",
            kind: "trace",
            expiresAtMs: expiresAt.getTime(),
            maxViews: 3,
            createdByUserId: "user_1",
          },
          actor: { type: "user", id: "user_1" },
        });
        // The id is minted before the write - it IS the grant id - and the
        // row read back afterwards is the one that id names.
        expect(emission?.grantId).toEqual(expect.any(String));
        expect(legacy.tryFindById).toHaveBeenCalledWith({
          id: emission?.grantId,
          projectId: PROJECT_ID,
        });
        expect(row.id).toBe("share_1");
        expect(legacy.create).not.toHaveBeenCalled();
      });

      it("names the audience an organization-visible link is for", async () => {
        const { repository, writer } = buildRepository({ onEngine: true });

        await repository.create({
          ...createParams,
          visibility: "ORGANIZATION",
        });

        expect(writer.attachResourceGrant).toHaveBeenCalledWith(
          expect.objectContaining({
            principal: { type: "organization", id: ORGANIZATION_ID },
          }),
        );
      });

      it("names the audience a project-visible link is for", async () => {
        const { repository, writer } = buildRepository({ onEngine: true });

        await repository.create({ ...createParams, visibility: "PROJECT" });

        expect(writer.attachResourceGrant).toHaveBeenCalledWith(
          expect.objectContaining({
            principal: { type: "project", id: PROJECT_ID },
          }),
        );
      });

      it("refuses to invent a row when the projection has not landed one", async () => {
        const { repository, legacy } = buildRepository({ onEngine: true });
        vi.mocked(legacy.tryFindById).mockResolvedValue(null);

        await expect(repository.create(createParams)).rejects.toThrow(
          /projection queue is stalled/,
        );
      });
    });

    describe("when a link is revoked", () => {
      it("revokes by the link's own id and deletes the compat row before returning", async () => {
        const { repository, legacy, writer } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
        });

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(writer.revokeResourceGrants).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          grantIds: ["share_1"],
          actor: { type: "system", id: null },
        });
        expect(legacy.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        // The order is load-bearing: the fact must be on the ledger before
        // the compat row goes, or a crash between the two leaves a deleted
        // link with no revocation for the fold to converge on.
        expect(
          vi.mocked(writer.revokeResourceGrants).mock.invocationCallOrder[0],
        ).toBeLessThan(vi.mocked(legacy.deleteById).mock.invocationCallOrder[0]!);
      });

      /** @scenario "Revoking a link whose grant row has not landed still records the fact" */
      it("keys the revoke on the compat row's id when the grant head has not landed", async () => {
        // The fold writes compat-before-head: the ShareLink row exists, the
        // Grant row does not. Discovering ids from the Grant table would
        // find nothing and fall back to a plain delete the fold's re-run
        // undoes — the revoked token would resolve again, permanently.
        const { repository, legacy, writer, grantFindMany } = buildRepository({
          onEngine: true,
          grantIds: [],
        });

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(writer.revokeResourceGrants).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          grantIds: ["share_1"],
          actor: { type: "system", id: null },
        });
        expect(legacy.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        // The compat head answered, so the Grant table was never needed.
        expect(grantFindMany).not.toHaveBeenCalled();
      });

      /** @scenario "A revocation never touches a resource outside the caller's project" */
      it("appends nothing for an id neither head anchors to the project", async () => {
        const { repository, legacy, writer } = buildRepository({
          onEngine: true,
          grantIds: [],
          compat: { findFirst: vi.fn().mockResolvedValue(null) },
        });

        await repository.deleteById({
          id: "share_foreign",
          projectId: PROJECT_ID,
        });

        expect(writer.revokeResourceGrants).not.toHaveBeenCalled();
        expect(legacy.deleteById).not.toHaveBeenCalled();
      });
    });

    describe("when the routing gate is stale or failing", () => {
      /** @scenario "Revocation routing never trusts a cached answer" */
      it("routes a revoke on the uncached projection read, past a stale cached answer", async () => {
        const { repository, legacy, writer, cutoverFindUnique } = buildRepository({
          onEngine: false,
        });

        // Warm the cached gate with "legacy" through a read/mint-class
        // write, then cut the organization over: the projection answers
        // true while the cached gate still holds false for its TTL.
        await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: null,
        });
        expect(legacy.consumeView).toHaveBeenCalledTimes(1);
        cutoverFindUnique.mockResolvedValue({ status: "finalized" });

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(writer.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({ grantIds: ["share_1"] }),
        );
        expect(legacy.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
      });

      /** @scenario "A failed cutover read routes a revocation toward deleting both heads" */
      it("fails a broken projection read toward the branch that deletes both heads", async () => {
        const { repository, legacy, writer, cutoverFindUnique } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
        });
        cutoverFindUnique.mockRejectedValue(new Error("projection unavailable"));

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(writer.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({ grantIds: ["share_1"] }),
        );
        expect(legacy.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
      });
    });

    describe("when every link for a resource is revoked", () => {
      it("revokes the facts and sweeps whatever compat rows are left behind", async () => {
        const { repository, legacy, writer, grantFindMany } = buildRepository({
          onEngine: true,
          grantIds: ["share_1", "share_2"],
        });

        await repository.deleteByResource({
          projectId: PROJECT_ID,
          resourceType: "TRACE",
          resourceId: TRACE_ID,
        });

        expect(grantFindMany).toHaveBeenCalledWith({
          where: {
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            scopeType: "RESOURCE",
            resourceKind: "TRACE",
            scopeId: TRACE_ID,
            revokedAt: null,
          },
          select: { id: true },
        });
        expect(writer.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({ grantIds: ["share_1", "share_2"] }),
        );
        // The sweep is what removes a link minted while the organization was
        // rolled back: it has a compat row and no fact to revoke.
        expect(legacy.deleteByResource).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          resourceType: "TRACE",
          resourceId: TRACE_ID,
        });
      });

      /** @scenario "A resource-wide revoke also names the links only the compat head can see" */
      it("includes the compat-only ids the grant head cannot see yet", async () => {
        // A ledger-minted link whose fold parked between the compat write
        // and the Grant write is visible only through its compat row; its
        // id must still reach the revoke, or the sweep deletes the row for
        // the fold's re-run to resurrect.
        const { repository, legacy, writer, shareLink } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          compat: {
            findMany: vi
              .fn()
              .mockResolvedValue([{ id: "share_1" }, { id: "share_parked" }]),
          },
        });

        await repository.deleteByResource({
          projectId: PROJECT_ID,
          resourceType: "TRACE",
          resourceId: TRACE_ID,
        });

        expect(shareLink.findMany).toHaveBeenCalledWith({
          where: {
            projectId: PROJECT_ID,
            resourceType: "TRACE",
            resourceId: TRACE_ID,
          },
          select: { id: true },
        });
        expect(writer.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({
            grantIds: ["share_1", "share_parked"],
          }),
        );
        expect(legacy.deleteByResource).toHaveBeenCalledTimes(1);
      });

      it("revokes every trace fact in the project on a bulk revoke, then sweeps", async () => {
        const { repository, legacy, writer, grantFindMany } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
        });

        await repository.deleteAllTraceShares(PROJECT_ID);

        expect(grantFindMany).toHaveBeenCalledWith({
          where: {
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            scopeType: "RESOURCE",
            resourceKind: "TRACE",
            revokedAt: null,
          },
          select: { id: true },
        });
        expect(writer.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({ grantIds: ["share_1"] }),
        );
        expect(legacy.deleteAllTraceShares).toHaveBeenCalledWith(PROJECT_ID);
      });
    });

    describe("when a view is consumed", () => {
      /** @scenario "A consumed view and its compat mirror commit together" */
      it("creates the usage row on the first view and mirrors the count in the same transaction", async () => {
        const create = vi.fn().mockResolvedValue(void 0);
        const {
          repository,
          legacy,
          compatMirror,
          transaction,
          rootGrantUsage,
          shareLink,
        } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          usage: {
            update: vi.fn().mockRejectedValue(recordNotFound()),
            create,
          },
        });

        const consumed = await repository.consumeView({
          id: "share_1",
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
        expect(legacy.consumeView).not.toHaveBeenCalled();
      });

      it("increments the usage row while the link is uncapped", async () => {
        const update = vi.fn().mockResolvedValue(void 0);
        const create = vi.fn();
        const { repository, legacy, compatMirror } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          usage: { update, create },
        });

        const consumed = await repository.consumeView({
          id: "share_1",
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
        expect(legacy.consumeView).not.toHaveBeenCalled();
      });

      /** @scenario "A view that loses the first-view race retries in a fresh transaction" */
      it("retries the conditioned increment in its own transaction after losing the create race", async () => {
        // The guarded create's unique violation aborts the transaction it
        // ran in, so the single conditioned retry must open a fresh one.
        const update = vi
          .fn()
          .mockRejectedValueOnce(recordNotFound())
          .mockResolvedValueOnce(void 0);
        const create = vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("unique violation"), { code: "P2002" }),
          );
        const { repository, transaction, compatMirror } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          usage: { update, create },
        });

        const consumed = await repository.consumeView({
          id: "share_1",
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
        const create = vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("unique violation"), { code: "P2002" }),
          );
        const { repository, compatMirror } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          usage: { update, create },
        });

        const consumed = await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 1,
        });

        expect(consumed).toBe(false);
        expect(compatMirror).not.toHaveBeenCalled();
      });

      it("fences the increment on the cap when the link is capped", async () => {
        const update = vi.fn().mockResolvedValue(void 0);
        const { repository } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          usage: { update },
        });

        await repository.consumeView({
          id: "share_1",
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

      it("counts on the compat row alone for a link the ledger never knew about", async () => {
        const create = vi.fn();
        const { repository, legacy } = buildRepository({
          onEngine: true,
          grantIds: [],
          usage: { update: vi.fn(), create },
        });

        const consumed = await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 1,
        });

        expect(consumed).toBe(true);
        expect(create).not.toHaveBeenCalled();
        expect(legacy.consumeView).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 1,
        });
      });
    });
  });
});
