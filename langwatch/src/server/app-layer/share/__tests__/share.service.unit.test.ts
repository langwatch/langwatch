import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import {
  ShareLinkExhaustedError,
  ShareLinkExpiredError,
  ShareLinkForbiddenError,
  ShareLinkNotFoundError,
  TraceSharingDisabledError,
} from "../errors";
import type {
  ShareRepository,
  ShareWithProject,
} from "../repositories/share.repository";
import {
  ShareService,
  type ShareServiceDeps,
  type ShareViewer,
} from "../share.service";

const ORG_ID = "org_1";
const PROJECT_ID = "project_1";

function buildShare(overrides: Partial<ShareWithProject> = {}): ShareWithProject {
  return {
    id: "share_1",
    token: "tok_abc",
    resourceType: "TRACE",
    resourceId: "trace_a",
    threadId: null,
    projectId: PROJECT_ID,
    userId: null,
    visibility: "PUBLIC",
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    project: {
      traceSharingEnabled: true,
      team: {
        organizationId: ORG_ID,
        organization: { traceSharingEnabled: true },
      },
    },
    ...overrides,
  } as ShareWithProject;
}

function buildViewer(overrides: Partial<ShareViewer> = {}): ShareViewer {
  return {
    isOrgMember: vi.fn().mockResolvedValue(false),
    isProjectMember: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("ShareService", () => {
  let repo: ShareRepository;
  let pinnedTraces: Pick<PinnedTraceService, "autoUnpin" | "autoPin">;
  let deps: ShareServiceDeps;
  let service: ShareService;

  beforeEach(() => {
    repo = {
      findByToken: vi.fn(),
      findById: vi.fn(),
      listByResource: vi.fn(),
      hasActiveShareForResource: vi.fn().mockResolvedValue(false),
      create: vi.fn(),
      consumeView: vi.fn().mockResolvedValue(true),
      deleteById: vi.fn(),
      deleteByResource: vi.fn(),
      findAllTraceShareResourceIds: vi.fn(),
      deleteAllTraceShares: vi.fn(),
    } as unknown as ShareRepository;
    pinnedTraces = {
      autoUnpin: vi.fn().mockResolvedValue(undefined),
      autoPin: vi.fn().mockResolvedValue(undefined),
    };
    deps = {
      isTraceSharingEnabled: vi.fn().mockResolvedValue(true),
    };
    service = new ShareService(repo, pinnedTraces as PinnedTraceService, deps);
  });

  describe("resolveForViewer view accounting", () => {
    /**
     * `maxViews` means distinct viewings, not HTTP requests. Without this a
     * single-view link dies the moment its recipient presses refresh, which is
     * not what an operator means by "one view". Authorization still re-runs in
     * full on every request — only the counting is deduped. See ADR-057.
     */
    describe("given the same viewer re-opens a link inside the window", () => {
      beforeEach(() => {
        vi.mocked(repo.findByToken).mockResolvedValue(buildShare());
      });

      it("does not consume another view", async () => {
        deps.viewDedupe = { isNewViewing: vi.fn().mockResolvedValue(false) };

        await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
          viewerKey: "viewer_1",
        });

        expect(repo.consumeView).not.toHaveBeenCalled();
      });

      /** @scenario A viewer refreshing a single-view link keeps access */
      it("still resolves a link their own earlier view already spent", async () => {
        deps.viewDedupe = { isNewViewing: vi.fn().mockResolvedValue(false) };
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ maxViews: 1, viewCount: 1 }),
        );

        await expect(
          service.resolveForViewer({
            token: "tok_abc",
            viewer: buildViewer(),
            viewerKey: "viewer_1",
          }),
        ).resolves.toMatchObject({ id: "share_1" });
      });
    });

    describe("given a viewer opening a link for the first time", () => {
      /** @scenario A different viewer cannot reuse someone else's viewing */
      it("consumes a view", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(buildShare());
        deps.viewDedupe = { isNewViewing: vi.fn().mockResolvedValue(true) };

        await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
          viewerKey: "viewer_1",
        });

        expect(repo.consumeView).toHaveBeenCalledTimes(1);
      });
    });

    describe("given no viewer key (dedupe unavailable)", () => {
      it("counts every request, the stricter behaviour", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(buildShare());
        deps.viewDedupe = { isNewViewing: vi.fn().mockResolvedValue(false) };

        await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(deps.viewDedupe.isNewViewing).not.toHaveBeenCalled();
        expect(repo.consumeView).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("resolveForViewer", () => {
    describe("given no share matches the token", () => {
      it("throws not-found", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(null);

        await expect(
          service.resolveForViewer({ token: "tok_nope", viewer: buildViewer() }),
        ).rejects.toThrow(ShareLinkNotFoundError);
      });
    });

    describe("given the sharing kill switch (org AND project)", () => {
      /**
       * Effective sharing = org AND project. Off at either level makes the link
       * resolve like a bad token. Covers the org-disable half of "Disabling
       * trace sharing for the organization disables it everywhere".
       */
      /** @scenario A link is resolvable only while both org and project allow sharing */
      /** @scenario Disabling trace sharing for the organization disables it everywhere */
      it("throws not-found when the ORGANIZATION disabled sharing", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({
            project: {
              traceSharingEnabled: true,
              team: {
                organizationId: ORG_ID,
                organization: { traceSharingEnabled: false },
              },
            },
          }),
        );

        await expect(
          service.resolveForViewer({ token: "tok_abc", viewer: buildViewer() }),
        ).rejects.toThrow(ShareLinkNotFoundError);
      });

      it("throws the same not-found as a bad token when the PROJECT disabled sharing", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({
            project: {
              traceSharingEnabled: false,
              team: {
                organizationId: ORG_ID,
                organization: { traceSharingEnabled: true },
              },
            },
          }),
        );

        await expect(
          service.resolveForViewer({ token: "tok_abc", viewer: buildViewer() }),
        ).rejects.toThrow(ShareLinkNotFoundError);
      });

      it("resolves when BOTH the org and the project allow sharing", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(buildShare());

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(share.id).toBe("share_1");
      });
    });

    describe("given the link expired in the past", () => {
      /** @scenario A timed link stops resolving after its expiry */
      it("throws expired and does not consume a view", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ expiresAt: new Date(Date.now() - 1000) }),
        );

        await expect(
          service.resolveForViewer({ token: "tok_abc", viewer: buildViewer() }),
        ).rejects.toThrow(ShareLinkExpiredError);
        expect(repo.consumeView).not.toHaveBeenCalled();
      });
    });

    describe("given a public link", () => {
      /** @scenario A public link resolves for an anonymous viewer */
      /** @scenario A link with no expiry and no view cap resolves indefinitely */
      it("grants an anonymous viewer and consumes one view", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(buildShare());

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(share.id).toBe("share_1");
        expect(repo.consumeView).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: null,
        });
      });
    });

    describe("given an organization-scoped link", () => {
      it("denies a non-member", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ visibility: "ORGANIZATION" }),
        );

        await expect(
          service.resolveForViewer({
            token: "tok_abc",
            viewer: buildViewer({ isOrgMember: vi.fn().mockResolvedValue(false) }),
          }),
        ).rejects.toThrow(ShareLinkForbiddenError);
        expect(repo.consumeView).not.toHaveBeenCalled();
      });

      /** @scenario An organization link requires a member of the same organization */
      it("grants a member of that organization", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ visibility: "ORGANIZATION" }),
        );
        const isOrgMember = vi.fn().mockResolvedValue(true);

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer({ isOrgMember }),
        });

        expect(share.id).toBe("share_1");
        expect(isOrgMember).toHaveBeenCalledWith(ORG_ID);
      });
    });

    describe("given a project-scoped link", () => {
      /** @scenario A project link requires a member of the same project */
      it("grants a member of that project", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ visibility: "PROJECT" }),
        );
        const isProjectMember = vi.fn().mockResolvedValue(true);

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer({ isProjectMember }),
        });

        expect(share.id).toBe("share_1");
        expect(isProjectMember).toHaveBeenCalledWith(PROJECT_ID);
      });

      it("denies a non-member", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ visibility: "PROJECT" }),
        );

        await expect(
          service.resolveForViewer({ token: "tok_abc", viewer: buildViewer() }),
        ).rejects.toThrow(ShareLinkForbiddenError);
      });
    });

    describe("given a single-view link", () => {
      /** @scenario A single-view link resolves exactly once */
      it("grants the first view through the atomic consume", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ maxViews: 1, viewCount: 0 }),
        );

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(share.id).toBe("share_1");
        expect(repo.consumeView).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 1,
        });
      });

      it("throws exhausted once the view was already spent, without a write attempt", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ maxViews: 1, viewCount: 1 }),
        );

        await expect(
          service.resolveForViewer({ token: "tok_abc", viewer: buildViewer() }),
        ).rejects.toThrow(ShareLinkExhaustedError);
        expect(repo.consumeView).not.toHaveBeenCalled();
      });

      describe("when a simultaneous open won the race for the last view", () => {
        /**
         * The read said a view remained, but the atomic conditional UPDATE
         * matched zero rows because another request consumed it in between.
         * The loser must be denied — check-then-increment would have admitted
         * both viewers through a single-view link.
         */
        /** @scenario Simultaneous opens cannot beat the view cap */
        it("throws exhausted when the atomic consume reports no view left", async () => {
          vi.mocked(repo.findByToken).mockResolvedValue(
            buildShare({ maxViews: 1, viewCount: 0 }),
          );
          vi.mocked(repo.consumeView).mockResolvedValue(false);

          await expect(
            service.resolveForViewer({ token: "tok_abc", viewer: buildViewer() }),
          ).rejects.toThrow(ShareLinkExhaustedError);
        });
      });
    });
  });

  describe("createShare", () => {
    /** @scenario Creating a share link for a trace mints a high-entropy token */
    it("mints an unprefixed 32-char high-entropy token and auto-pins the trace", async () => {
      vi.mocked(repo.create).mockImplementation(
        async (params) => ({ ...params, id: "share_1" }) as never,
      );

      await service.createShare({
        projectId: PROJECT_ID,
        resourceType: "TRACE",
        resourceId: "trace_a",
      });

      const created = vi.mocked(repo.create).mock.calls[0]![0];
      expect(created.token).toMatch(/^[0-9A-Za-z]{32}$/);
      expect(pinnedTraces.autoPin).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        traceId: "trace_a",
      });
    });

    describe("when the project disabled trace sharing", () => {
      it("refuses to mint a link", async () => {
        vi.mocked(deps.isTraceSharingEnabled).mockResolvedValue(false);

        await expect(
          service.createShare({
            projectId: PROJECT_ID,
            resourceType: "TRACE",
            resourceId: "trace_a",
          }),
        ).rejects.toThrow(TraceSharingDisabledError);
        expect(repo.create).not.toHaveBeenCalled();
      });
    });

    describe("when sharing a trace", () => {
      /**
       * Thread sharing is parked: a THREAD-typed link has no renderable
       * payload, so no code path may bind a link to a conversation until the
       * aggregate can carry one. See ADR-057's follow-ups.
       */
      /** @scenario A share link covers the trace alone */
      it("never binds the link to a conversation", async () => {
        vi.mocked(repo.create).mockImplementation(
          async (params) => ({ ...params, id: "share_1" }) as never,
        );

        await service.createShare({
          projectId: PROJECT_ID,
          resourceType: "TRACE",
          resourceId: "trace_a",
        });

        expect(vi.mocked(repo.create).mock.calls[0]![0]).not.toHaveProperty(
          "threadId",
        );
      });
    });

    it("rolls the link back when auto-pinning fails", async () => {
      vi.mocked(repo.create).mockResolvedValue({ id: "share_1" } as never);
      vi.mocked(pinnedTraces.autoPin).mockRejectedValue(new Error("boom"));

      await expect(
        service.createShare({
          projectId: PROJECT_ID,
          resourceType: "TRACE",
          resourceId: "trace_a",
        }),
      ).rejects.toThrow("boom");

      expect(repo.deleteById).toHaveBeenCalledWith({
        id: "share_1",
        projectId: PROJECT_ID,
      });
    });

    describe("when the rollback delete ALSO fails", () => {
      it("propagates the original pin error, not the rollback error", async () => {
        vi.mocked(repo.create).mockResolvedValue({ id: "share_1" } as never);
        vi.mocked(pinnedTraces.autoPin).mockRejectedValue(
          new Error("pin failed"),
        );
        vi.mocked(repo.deleteById).mockRejectedValue(
          new Error("rollback failed"),
        );

        // The caller must see the real cause (pin failed), never the masking
        // rollback error. The rollback failure is logged, not thrown.
        await expect(
          service.createShare({
            projectId: PROJECT_ID,
            resourceType: "TRACE",
            resourceId: "trace_a",
          }),
        ).rejects.toThrow("pin failed");
      });
    });
  });

  describe("revokeById", () => {
    describe("when other links still cover the trace", () => {
      it("revokes the link but keeps the trace pinned", async () => {
        vi.mocked(repo.findById).mockResolvedValue(buildShare());
        vi.mocked(repo.hasActiveShareForResource).mockResolvedValue(true);

        await service.revokeById({ id: "share_1", projectId: PROJECT_ID });

        expect(repo.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        expect(pinnedTraces.autoUnpin).not.toHaveBeenCalled();
      });
    });

    describe("when it was the trace's last link", () => {
      /** @scenario A revoked link stops resolving */
      it("revokes the link and auto-unpins the trace", async () => {
        vi.mocked(repo.findById).mockResolvedValue(buildShare());
        vi.mocked(repo.hasActiveShareForResource).mockResolvedValue(false);

        await service.revokeById({ id: "share_1", projectId: PROJECT_ID });

        expect(pinnedTraces.autoUnpin).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          traceId: "trace_a",
        });
      });
    });

    describe("when the link belongs to another project", () => {
      it("does nothing — the lookup is project-scoped, so it returns null", async () => {
        // findById is scoped by projectId now, so a cross-tenant id never
        // resolves; the service just no-ops on the null.
        vi.mocked(repo.findById).mockResolvedValue(null);

        await service.revokeById({ id: "share_1", projectId: PROJECT_ID });

        expect(repo.findById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        expect(repo.deleteById).not.toHaveBeenCalled();
      });
    });
  });

  describe("revokeAllTraceShares", () => {
    describe("regression: source=share pins must be cleared when bulk-revoking", () => {
      /**
       * Disabling trace sharing via project settings calls `revokeAllTraceShares`
       * which previously did a single bulk DELETE. The single-trace `unshare()`
       * runs `autoUnpin` first, so `source=share` pins disappeared with their
       * share — bulk did not, leaving orphaned share-sourced pins behind.
       */
      /** @scenario Disabling trace sharing for a project revokes all its links */
      it("auto-unpins every trace share before deleting them", async () => {
        vi.mocked(repo.findAllTraceShareResourceIds).mockResolvedValue([
          "trace_a",
          "trace_b",
          "trace_c",
        ]);

        await service.revokeAllTraceShares("project_1");

        expect(pinnedTraces.autoUnpin).toHaveBeenCalledTimes(3);
        expect(pinnedTraces.autoUnpin).toHaveBeenCalledWith({
          projectId: "project_1",
          traceId: "trace_a",
        });
        expect(pinnedTraces.autoUnpin).toHaveBeenCalledWith({
          projectId: "project_1",
          traceId: "trace_b",
        });
        expect(pinnedTraces.autoUnpin).toHaveBeenCalledWith({
          projectId: "project_1",
          traceId: "trace_c",
        });
        expect(repo.deleteAllTraceShares).toHaveBeenCalledWith("project_1");
      });

      it("continues with the remaining traces when one auto-unpin fails", async () => {
        vi.mocked(repo.findAllTraceShareResourceIds).mockResolvedValue([
          "trace_a",
          "trace_b",
        ]);
        vi.mocked(pinnedTraces.autoUnpin)
          .mockRejectedValueOnce(new Error("boom"))
          .mockResolvedValueOnce(undefined);

        await service.revokeAllTraceShares("project_1");

        expect(pinnedTraces.autoUnpin).toHaveBeenCalledTimes(2);
        // Bulk delete still runs — one stuck pin must not block the revocation.
        expect(repo.deleteAllTraceShares).toHaveBeenCalledWith("project_1");
      });
    });

    describe("when there are no trace shares", () => {
      it("still calls the bulk delete (idempotent) without invoking autoUnpin", async () => {
        vi.mocked(repo.findAllTraceShareResourceIds).mockResolvedValue([]);

        await service.revokeAllTraceShares("project_1");

        expect(pinnedTraces.autoUnpin).not.toHaveBeenCalled();
        expect(repo.deleteAllTraceShares).toHaveBeenCalledWith("project_1");
      });
    });
  });
});
