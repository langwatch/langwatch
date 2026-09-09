import type { AuthzApi } from "@langwatch/authz-contract";
import { Temporal } from "@langwatch/time";
import type { ShareLink } from "@langwatch/share-contract";
import { describe, expect, it, vi } from "vitest";
import { LedgerShareRepository } from "../ledger.share.repository.ts";
import type { ShareGrantRepository } from "../../share-grant.repository.ts";
import type { ShareRepository } from "../../share.repository.ts";

/**
 * ADR-092 delivery-plan PR 3 (D-PR3-10). One property carries this file: a
 * share write goes to exactly one of the two writers, decided per organization
 * by the cutover gate. What the database does with a consumed view is pinned on
 * the grant head and, against a real Postgres, in the integration suite here.
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

const spyHead = (compatIds: string[], anchored: boolean): ShareRepository =>
  ({
    findByToken: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(shareRow()),
    existsById: vi.fn().mockResolvedValue(anchored),
    findAllByResource: vi.fn().mockResolvedValue([]),
    countActiveForResource: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(shareRow({ id: "legacy_share" })),
    consumeView: vi.fn().mockResolvedValue(true),
    findAllIdsByResource: vi.fn().mockResolvedValue(compatIds.map((id) => id)),
    deleteById: vi.fn().mockResolvedValue(void 0),
    deleteByResource: vi.fn().mockResolvedValue(void 0),
    findAllTraceShareResourceIds: vi.fn().mockResolvedValue([]),
    deleteAllTraceShares: vi.fn().mockResolvedValue(void 0),
  }) as unknown as ShareRepository;

function buildRepository({
  onEngine,
  grantIds = [],
  compatIds = [],
  anchored = true,
}: {
  onEngine: boolean;
  grantIds?: string[];
  compatIds?: string[];
  anchored?: boolean;
}) {
  const head = spyHead(compatIds, anchored);
  const grants = {
    findAllResourceGrantIds: vi.fn().mockResolvedValue(grantIds),
    consumeUsage: vi.fn().mockResolvedValue(true),
  } as unknown as ShareGrantRepository;
  const projects = { tryGetOrganizationId: vi.fn().mockResolvedValue(ORGANIZATION_ID) };
  const authz = {
    isOnEngine: vi.fn().mockResolvedValue(onEngine),
    attachResourceGrant: vi.fn().mockResolvedValue(void 0),
    revokeResourceGrants: vi.fn().mockResolvedValue(void 0),
  } as unknown as AuthzApi;

  return {
    head,
    grants,
    authz,
    projects,
    repository: LedgerShareRepository.create({ head, grants, authz, projects }),
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
    it("keeps compat-head writes while routing revocations through the AuthZ capability", async () => {
      const { repository, head, authz } = buildRepository({
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

      expect(head.create).toHaveBeenCalledWith(createParams);
      expect(head.deleteById).toHaveBeenCalledTimes(1);
      expect(head.deleteByResource).toHaveBeenCalledTimes(1);
      expect(head.deleteAllTraceShares).toHaveBeenCalledTimes(1);
      expect(head.consumeView).toHaveBeenCalledTimes(1);
      expect(authz.attachResourceGrant).not.toHaveBeenCalled();
      // The service owns the per-organization cutover decision. Calling it is
      // harmless on the legacy path and keeps that routing out of this adapter.
      expect(authz.revokeResourceGrants).toHaveBeenCalledTimes(3);
    });

    it("reads through the compat head, as it does for every organization", async () => {
      const { repository, head } = buildRepository({ onEngine: false });

      await repository.findByToken("tok_abc");
      await repository.findById({ id: "share_1", projectId: PROJECT_ID });
      await repository.findAllByResource({
        projectId: PROJECT_ID,
        resourceType: "TRACE",
        resourceId: TRACE_ID,
      });
      await repository.countActiveForResource({
        projectId: PROJECT_ID,
        resourceType: "TRACE",
        resourceId: TRACE_ID,
      });
      await repository.findAllTraceShareResourceIds(PROJECT_ID);

      expect(head.findByToken).toHaveBeenCalledTimes(1);
      expect(head.findById).toHaveBeenCalledTimes(1);
      expect(head.findAllByResource).toHaveBeenCalledTimes(1);
      expect(head.countActiveForResource).toHaveBeenCalledTimes(1);
      expect(head.findAllTraceShareResourceIds).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the organization is cut over", () => {
    describe("when a link is minted", () => {
      it("states the fact with the link's own terms and returns the row the fold wrote", async () => {
        const { repository, head, authz } = buildRepository({ onEngine: true });
        const expiresAt = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

        const row = await repository.create({
          ...createParams,
          expiresAt,
          maxViews: 3,
          userId: "user_1",
        });

        expect(authz.attachResourceGrant).toHaveBeenCalledTimes(1);
        const emission = vi.mocked(authz.attachResourceGrant).mock.calls[0]?.[0];
        expect(emission).toMatchObject({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          scopeId: TRACE_ID,
          principal: { type: "anyone", id: null },
          resource: {
            token: "tok_new",
            permission: "traces:view",
            kind: "trace",
            expiresAtMs: expiresAt.epochMilliseconds,
            maxViews: 3,
            createdByUserId: "user_1",
          },
          actor: { type: "user", id: "user_1" },
        });
        // The id is minted before the write - it IS the grant id - and the
        // row read back afterwards is the one that id names.
        expect(emission?.grantId).toEqual(expect.any(String));
        expect(head.findById).toHaveBeenCalledWith({
          id: emission?.grantId,
          projectId: PROJECT_ID,
        });
        expect(row.id).toBe("share_1");
        expect(head.create).not.toHaveBeenCalled();
      });

      it("names the audience an organization-visible link is for", async () => {
        const { repository, authz } = buildRepository({ onEngine: true });

        await repository.create({
          ...createParams,
          visibility: "ORGANIZATION",
        });

        expect(authz.attachResourceGrant).toHaveBeenCalledWith(
          expect.objectContaining({
            principal: { type: "organization", id: ORGANIZATION_ID },
          }),
        );
      });

      it("names the audience a project-visible link is for", async () => {
        const { repository, authz } = buildRepository({ onEngine: true });

        await repository.create({ ...createParams, visibility: "PROJECT" });

        expect(authz.attachResourceGrant).toHaveBeenCalledWith(
          expect.objectContaining({
            principal: { type: "project", id: PROJECT_ID },
          }),
        );
      });

      it("refuses to invent a row when the projection has not landed one", async () => {
        const { repository, head } = buildRepository({ onEngine: true });
        vi.mocked(head.findById).mockResolvedValue(null);

        await expect(repository.create(createParams)).rejects.toThrow(
          /projection queue is stalled/,
        );
      });
    });

    describe("when a link is revoked", () => {
      it("revokes by the link's own id and deletes the compat row before returning", async () => {
        const { repository, head, authz } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
        });

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(authz.revokeResourceGrants).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          grantIds: ["share_1"],
          actor: { type: "system", id: null },
        });
        expect(head.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        // The order is load-bearing: the fact must be on the ledger before
        // the compat row goes, or a crash between the two leaves a deleted
        // link with no revocation for the fold to converge on.
        expect(vi.mocked(authz.revokeResourceGrants).mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(head.deleteById).mock.invocationCallOrder[0]!,
        );
      });

      /** @scenario "Revoking a link whose grant row has not landed still records the fact" */
      it("keys the revoke on the compat row's id when the grant head has not landed", async () => {
        // The fold writes compat-before-head: the ShareLink row exists, the
        // Grant row does not. Discovering ids from the Grant table would
        // find nothing and fall back to a plain delete the fold's re-run
        // undoes — the revoked token would resolve again, permanently.
        const { repository, head, authz, grants } = buildRepository({
          onEngine: true,
          grantIds: [],
        });

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(authz.revokeResourceGrants).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          grantIds: ["share_1"],
          actor: { type: "system", id: null },
        });
        expect(head.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        // The compat head answered, so the Grant table was never needed.
        expect(grants.findAllResourceGrantIds).not.toHaveBeenCalled();
      });

      /** @scenario "A revocation never touches a resource outside the caller's project" */
      it("appends nothing for an id neither head anchors to the project", async () => {
        const { repository, head, authz } = buildRepository({
          onEngine: true,
          grantIds: [],
          anchored: false,
        });

        await repository.deleteById({
          id: "share_foreign",
          projectId: PROJECT_ID,
        });

        expect(authz.revokeResourceGrants).not.toHaveBeenCalled();
        expect(head.deleteById).not.toHaveBeenCalled();
      });
    });

    describe("when the routing gate is stale or failing", () => {
      /** @scenario "Revocation routing never trusts a cached answer" */
      it("routes a revoke past a cutover gate still answering legacy", async () => {
        const { repository, head, authz } = buildRepository({ onEngine: false });

        // The mint-class path reads the cached gate and routes to the compat
        // head; the revoke that follows must not inherit that answer.
        await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: null,
        });
        expect(head.consumeView).toHaveBeenCalledTimes(1);

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(authz.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({ grantIds: ["share_1"] }),
        );
        expect(head.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
      });

      /** @scenario "A failed cutover read routes a revocation toward deleting both heads" */
      it("fails a broken cutover read toward the branch that deletes both heads", async () => {
        const { repository, head, authz } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
        });
        vi.mocked(authz.isOnEngine).mockRejectedValue(new Error("projection unavailable"));

        await repository.deleteById({ id: "share_1", projectId: PROJECT_ID });

        expect(authz.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({ grantIds: ["share_1"] }),
        );
        expect(head.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
      });
    });

    describe("when every link for a resource is revoked", () => {
      it("revokes the facts and sweeps whatever compat rows are left behind", async () => {
        const { repository, head, authz, grants } = buildRepository({
          onEngine: true,
          grantIds: ["share_1", "share_2"],
        });

        await repository.deleteByResource({
          projectId: PROJECT_ID,
          resourceType: "TRACE",
          resourceId: TRACE_ID,
        });

        expect(grants.findAllResourceGrantIds).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          resourceKind: "TRACE",
          resourceId: TRACE_ID,
        });
        expect(authz.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({ grantIds: ["share_1", "share_2"] }),
        );
        // The sweep is what removes a link minted while the organization was
        // rolled back: it has a compat row and no fact to revoke.
        expect(head.deleteByResource).toHaveBeenCalledWith({
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
        const { repository, head, authz } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
          compatIds: ["share_1", "share_parked"],
        });

        await repository.deleteByResource({
          projectId: PROJECT_ID,
          resourceType: "TRACE",
          resourceId: TRACE_ID,
        });

        expect(head.findAllIdsByResource).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          resourceType: "TRACE",
          resourceId: TRACE_ID,
        });
        expect(authz.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({
            grantIds: ["share_1", "share_parked"],
          }),
        );
        expect(head.deleteByResource).toHaveBeenCalledTimes(1);
      });

      it("revokes every trace fact in the project on a bulk revoke, then sweeps", async () => {
        const { repository, head, authz, grants } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
        });

        await repository.deleteAllTraceShares(PROJECT_ID);

        expect(grants.findAllResourceGrantIds).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          resourceKind: "TRACE",
        });
        expect(authz.revokeResourceGrants).toHaveBeenCalledWith(
          expect.objectContaining({ grantIds: ["share_1"] }),
        );
        expect(head.deleteAllTraceShares).toHaveBeenCalledWith(PROJECT_ID);
      });
    });

    describe("when a view is consumed", () => {
      it("consumes on the grant head the link's usage row belongs to", async () => {
        const { repository, head, grants } = buildRepository({
          onEngine: true,
          grantIds: ["share_1"],
        });

        const consumed = await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 2,
        });

        expect(consumed).toBe(true);
        expect(grants.consumeUsage).toHaveBeenCalledWith({
          grantId: "share_1",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          maxViews: 2,
        });
        expect(head.consumeView).not.toHaveBeenCalled();
      });

      it("counts on the compat row alone for a link the ledger never knew about", async () => {
        const { repository, head, grants } = buildRepository({
          onEngine: true,
          grantIds: [],
        });

        const consumed = await repository.consumeView({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 1,
        });

        expect(consumed).toBe(true);
        expect(grants.consumeUsage).not.toHaveBeenCalled();
        expect(head.consumeView).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 1,
        });
      });
    });
  });
});
