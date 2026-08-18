import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, ShareLink } from "~/generated/prisma/client";
import { resetCutoverGateForTesting } from "../../authz/cutover-gate";
import type { GrantsLedgerWriter } from "../../authz/ledger";
import { LedgerShareRepository } from "../repositories/share.ledger.repository";
import type { ShareRepository } from "../repositories/share.repository";

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

const spyLegacy = (): ShareRepository =>
  ({
    findByToken: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(shareRow()),
    listByResource: vi.fn().mockResolvedValue([]),
    hasActiveShareForResource: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue(shareRow({ id: "legacy_share" })),
    consumeView: vi.fn().mockResolvedValue(true),
    deleteById: vi.fn().mockResolvedValue(undefined),
    deleteByResource: vi.fn().mockResolvedValue(undefined),
    findAllTraceShareResourceIds: vi.fn().mockResolvedValue([]),
    deleteAllTraceShares: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ShareRepository;

function buildRepository({
  onEngine,
  grantIds = [],
  usage,
}: {
  onEngine: boolean;
  grantIds?: string[];
  usage?: {
    updateMany?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
  };
}) {
  const legacy = spyLegacy();
  const grantFindMany = vi
    .fn()
    .mockResolvedValue(grantIds.map((id) => ({ id })));
  const grantUsage = {
    updateMany: usage?.updateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
    create: usage?.create ?? vi.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ team: { organizationId: ORGANIZATION_ID } }),
    },
    authzCutoverProjection: {
      findUnique: vi.fn().mockResolvedValue({ onEngine }),
    },
    grant: { findMany: grantFindMany },
    grantUsage,
  } as unknown as PrismaClient;
  const writer = {
    attachResourceGrant: vi.fn().mockResolvedValue(undefined),
    revokeResourceGrants: vi.fn().mockResolvedValue(undefined),
  } as unknown as GrantsLedgerWriter;

  return {
    legacy,
    writer,
    grantFindMany,
    grantUsage,
    repository: new LedgerShareRepository({
      legacy,
      prisma,
      writer: () => writer,
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
  beforeEach(() => {
    resetCutoverGateForTesting();
  });
  afterEach(() => {
    resetCutoverGateForTesting();
  });

  describe("given the organization has not been cut over", () => {
    it("writes every mutation through the Prisma repository, telling the ledger nothing", async () => {
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
      expect(writer.revokeResourceGrants).not.toHaveBeenCalled();
    });

    it("reads through the Prisma repository, as it does for every organization", async () => {
      const { repository, legacy } = buildRepository({ onEngine: false });

      await repository.findByToken("tok_abc");
      await repository.findById({ id: "share_1", projectId: PROJECT_ID });
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

      expect(legacy.findByToken).toHaveBeenCalledTimes(1);
      expect(legacy.findById).toHaveBeenCalledTimes(1);
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
        const emission = vi.mocked(writer.attachResourceGrant).mock
          .calls[0]?.[0];
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
        expect(legacy.findById).toHaveBeenCalledWith({
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
        vi.mocked(legacy.findById).mockResolvedValue(null);

        await expect(repository.create(createParams)).rejects.toThrow(
          /projection queue is stalled/,
        );
      });
    });

    describe("when a link is revoked", () => {
      it("revokes the grant, whose enforcement removes both heads", async () => {
        const { repository, legacy, writer, grantFindMany } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
        });

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(grantFindMany).toHaveBeenCalledWith({
          where: {
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            scopeType: "RESOURCE",
            id: "share_1",
          },
          select: { id: true },
        });
        expect(writer.revokeResourceGrants).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          grantIds: ["share_1"],
          actor: { type: "system", id: null },
        });
        expect(legacy.deleteById).not.toHaveBeenCalled();
      });

      it("deletes a link the ledger never knew about the plain way", async () => {
        const { repository, legacy, writer } = buildRepository({
          onEngine: true,
          grantIds: [],
        });

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(legacy.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        expect(writer.revokeResourceGrants).not.toHaveBeenCalled();
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
      it("creates the usage row on the first view and mirrors the count onto the compat row", async () => {
        const create = vi.fn().mockResolvedValue(undefined);
        const { repository, legacy } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          usage: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            create,
          },
        });

        const consumed = await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 2,
        });

        expect(consumed).toBe(true);
        expect(create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            grantId: "share_1",
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            viewCount: 1,
          }),
        });
        expect(legacy.consumeView).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 2,
        });
      });

      it("increments the usage row while the link is uncapped", async () => {
        const updateMany = vi.fn().mockResolvedValue({ count: 1 });
        const create = vi.fn();
        const { repository, legacy } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          usage: { updateMany, create },
        });

        const consumed = await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: null,
        });

        expect(consumed).toBe(true);
        expect(updateMany).toHaveBeenCalledWith({
          where: {
            grantId: "share_1",
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
          },
          data: expect.objectContaining({ viewCount: { increment: 1 } }),
        });
        expect(create).not.toHaveBeenCalled();
        expect(legacy.consumeView).toHaveBeenCalledTimes(1);
      });

      it("fences the increment on the cap when the link is capped", async () => {
        const updateMany = vi.fn().mockResolvedValue({ count: 1 });
        const { repository } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          usage: { updateMany },
        });

        await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 3,
        });

        expect(updateMany).toHaveBeenCalledWith({
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
          usage: { updateMany: vi.fn(), create },
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
