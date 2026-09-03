import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  ShareLinkExhaustedError,
  ShareLinkExpiredError,
  ShareLinkForbiddenError,
  ShareLinkNotFoundError,
  PinnedToActiveShareError,
  type ShareViewer,
  type ShareWithProject,
  TraceSharingDisabledError,
} from "@langwatch/share-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { ShareCacheRepository } from "../share-cache.repository";
import type { ShareRepository } from "../share.repository";
import { ShareService } from "../../services/share.service";

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

const anonymousViewer: ShareViewer = { type: "anonymous" };
const userViewer: ShareViewer = { type: "user", id: "user_1" };

describe("ShareService", () => {
  let repo: ShareRepository;
  let dataRetention: DataRetentionService;
  let projects: ProjectService;
  let permissions: AuthzService;
  let cache: ShareCacheRepository;
  let service: ShareService;

  beforeEach(() => {
    repo = {
      tryFindByToken: vi.fn(),
      tryFindById: vi.fn(),
      listByResource: vi.fn(),
      hasActiveShareForResource: vi.fn().mockResolvedValue(false),
      create: vi.fn(),
      consumeView: vi.fn().mockResolvedValue(true),
      deleteById: vi.fn(),
      deleteByResource: vi.fn(),
      findAllTraceShareResourceIds: vi.fn(),
      deleteAllTraceShares: vi.fn(),
    } as unknown as ShareRepository;
    dataRetention = {
      autoUnpin: vi.fn().mockResolvedValue(void 0),
      autoPin: vi.fn().mockResolvedValue(void 0),
      unpin: vi.fn().mockResolvedValue(void 0),
    } as unknown as DataRetentionService;
    projects = {
      tryGetTraceSharingConfig: vi.fn().mockResolvedValue({
        orgEnabled: true,
        projectEnabled: true,
      }),
    } as unknown as ProjectService;
    permissions = {
      getDecision: vi.fn().mockResolvedValue({ permitted: false }),
    } as unknown as AuthzService;
    cache = {
      isNewViewing: vi.fn().mockResolvedValue(true),
      tryGetPayload: vi.fn().mockResolvedValue(null),
      setPayload: vi.fn().mockResolvedValue(void 0),
    } as unknown as ShareCacheRepository;
    service = ShareService.create({
      repository: repo,
      dataRetention,
      projects,
      permissions,
      cache,
    });
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
        vi.mocked(repo.tryFindByToken).mockResolvedValue(buildShare());
      });

      it("does not consume another view", async () => {
        vi.mocked(cache.isNewViewing).mockResolvedValue(false);

        await service.resolveForViewer({
          token: "tok_abc",
          viewer: anonymousViewer,
          viewerKey: "viewer_1",
        });

        expect(repo.consumeView).not.toHaveBeenCalled();
      });

      /** @scenario A viewer refreshing a single-view link keeps access */
      it("still resolves a link their own earlier view already spent", async () => {
        vi.mocked(cache.isNewViewing).mockResolvedValue(false);
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
          buildShare({ maxViews: 1, viewCount: 1 }),
        );

        await expect(
          service.resolveForViewer({
            token: "tok_abc",
            viewer: anonymousViewer,
            viewerKey: "viewer_1",
          }),
        ).resolves.toMatchObject({ id: "share_1" });
      });
    });

    describe("given a viewer opening a link for the first time", () => {
      /** @scenario A different viewer cannot reuse someone else's viewing */
      it("consumes a view", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(buildShare());
        vi.mocked(cache.isNewViewing).mockResolvedValue(true);

        await service.resolveForViewer({
          token: "tok_abc",
          viewer: anonymousViewer,
          viewerKey: "viewer_1",
        });

        expect(repo.consumeView).toHaveBeenCalledTimes(1);
      });
    });

    describe("given no viewer key (dedupe unavailable)", () => {
      it("counts every request, the stricter behaviour", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(buildShare());
        vi.mocked(cache.isNewViewing).mockResolvedValue(false);

        await service.resolveForViewer({
          token: "tok_abc",
          viewer: anonymousViewer,
        });

        expect(cache.isNewViewing).not.toHaveBeenCalled();
        expect(repo.consumeView).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("resolveForViewer", () => {
    describe("given no share matches the token", () => {
      it("throws not-found", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(null);

        await expect(
          service.resolveForViewer({
            token: "tok_nope",
            viewer: anonymousViewer,
          }),
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
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
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
          service.resolveForViewer({ token: "tok_abc", viewer: anonymousViewer }),
        ).rejects.toThrow(ShareLinkNotFoundError);
      });

      it("throws the same not-found as a bad token when the PROJECT disabled sharing", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
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
          service.resolveForViewer({ token: "tok_abc", viewer: anonymousViewer }),
        ).rejects.toThrow(ShareLinkNotFoundError);
      });

      it("resolves when BOTH the org and the project allow sharing", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(buildShare());

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: anonymousViewer,
        });

        expect(share.id).toBe("share_1");
      });
    });

    describe("given the link expired in the past", () => {
      /** @scenario A timed link stops resolving after its expiry */
      it("throws expired and does not consume a view", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
          buildShare({ expiresAt: new Date(Date.now() - 1000) }),
        );

        await expect(
          service.resolveForViewer({ token: "tok_abc", viewer: anonymousViewer }),
        ).rejects.toThrow(ShareLinkExpiredError);
        expect(repo.consumeView).not.toHaveBeenCalled();
      });
    });

    describe("given a public link", () => {
      /** @scenario A public link resolves for an anonymous viewer */
      /** @scenario A link with no expiry and no view cap resolves indefinitely */
      it("grants an anonymous viewer and consumes one view", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(buildShare());

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: anonymousViewer,
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
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
          buildShare({ visibility: "ORGANIZATION" }),
        );

        await expect(
          service.resolveForViewer({
            token: "tok_abc",
            viewer: anonymousViewer,
          }),
        ).rejects.toThrow(ShareLinkForbiddenError);
        expect(repo.consumeView).not.toHaveBeenCalled();
      });

      /** @scenario An organization link requires a member of the same organization */
      it("grants a member of that organization", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
          buildShare({ visibility: "ORGANIZATION" }),
        );
        vi.mocked(permissions.getDecision).mockResolvedValue({
          permitted: true,
        } as never);

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: userViewer,
        });

        expect(share.id).toBe("share_1");
        expect(permissions.getDecision).toHaveBeenCalledWith({
          userId: "user_1",
          permission: "organization:view",
          scope: { tier: "organization", id: ORG_ID },
        });
      });
    });

    describe("given a project-scoped link", () => {
      /** @scenario A project link requires a member of the same project */
      it("grants a member of that project", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
          buildShare({ visibility: "PROJECT" }),
        );
        vi.mocked(permissions.getDecision).mockResolvedValue({
          permitted: true,
        } as never);

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: userViewer,
        });

        expect(share.id).toBe("share_1");
        expect(permissions.getDecision).toHaveBeenCalledWith({
          userId: "user_1",
          permission: "traces:view",
          scope: { tier: "project", id: PROJECT_ID },
        });
      });

      it("denies a non-member", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
          buildShare({ visibility: "PROJECT" }),
        );

        await expect(
          service.resolveForViewer({ token: "tok_abc", viewer: anonymousViewer }),
        ).rejects.toThrow(ShareLinkForbiddenError);
      });
    });

    describe("given a single-view link", () => {
      /** @scenario A single-view link resolves exactly once */
      it("grants the first view through the atomic consume", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
          buildShare({ maxViews: 1, viewCount: 0 }),
        );

        const share = await service.resolveForViewer({
          token: "tok_abc",
          viewer: anonymousViewer,
        });

        expect(share.id).toBe("share_1");
        expect(repo.consumeView).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
          maxViews: 1,
        });
      });

      it("throws exhausted once the view was already spent, without a write attempt", async () => {
        vi.mocked(repo.tryFindByToken).mockResolvedValue(
          buildShare({ maxViews: 1, viewCount: 1 }),
        );

        await expect(
          service.resolveForViewer({ token: "tok_abc", viewer: anonymousViewer }),
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
          vi.mocked(repo.tryFindByToken).mockResolvedValue(
            buildShare({ maxViews: 1, viewCount: 0 }),
          );
          vi.mocked(repo.consumeView).mockResolvedValue(false);

          await expect(
            service.resolveForViewer({
              token: "tok_abc",
              viewer: anonymousViewer,
            }),
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
      expect(dataRetention.autoPin).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        traceId: "trace_a",
      });
    });

    describe("when the project disabled trace sharing", () => {
      it("refuses to mint a link", async () => {
        vi.mocked(projects.tryGetTraceSharingConfig).mockResolvedValue({
          orgEnabled: true,
          projectEnabled: false,
        });

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

        expect(vi.mocked(repo.create).mock.calls[0]![0]).not.toHaveProperty("threadId");
      });
    });

    it("rolls the link back when auto-pinning fails", async () => {
      vi.mocked(repo.create).mockResolvedValue({ id: "share_1" } as never);
      vi.mocked(dataRetention.autoPin).mockRejectedValue(new Error("boom"));

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
        vi.mocked(dataRetention.autoPin).mockRejectedValue(new Error("pin failed"));
        vi.mocked(repo.deleteById).mockRejectedValue(new Error("rollback failed"));

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
        vi.mocked(repo.tryFindById).mockResolvedValue(buildShare());
        vi.mocked(repo.hasActiveShareForResource).mockResolvedValue(true);

        await service.revokeById({ id: "share_1", projectId: PROJECT_ID });

        expect(repo.deleteById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        expect(dataRetention.autoUnpin).not.toHaveBeenCalled();
      });
    });

    describe("when it was the trace's last link", () => {
      /** @scenario A revoked link stops resolving */
      it("revokes the link and auto-unpins the trace", async () => {
        vi.mocked(repo.tryFindById).mockResolvedValue(buildShare());
        vi.mocked(repo.hasActiveShareForResource).mockResolvedValue(false);

        await service.revokeById({ id: "share_1", projectId: PROJECT_ID });

        expect(dataRetention.autoUnpin).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          traceId: "trace_a",
        });
      });
    });

    describe("when the link belongs to another project", () => {
      it("does nothing — the lookup is project-scoped, so it returns null", async () => {
        // tryFindById is scoped by projectId now, so a cross-tenant id never
        // resolves; the service just no-ops on the null.
        vi.mocked(repo.tryFindById).mockResolvedValue(null);

        await service.revokeById({ id: "share_1", projectId: PROJECT_ID });

        expect(repo.tryFindById).toHaveBeenCalledWith({
          id: "share_1",
          projectId: PROJECT_ID,
        });
        expect(repo.deleteById).not.toHaveBeenCalled();
      });
    });
  });

  describe("unpinTrace", () => {
    /** @scenario Active shares own their pin annotation */
    it("rejects manual unpinning while a share is active", async () => {
      vi.mocked(repo.hasActiveShareForResource).mockResolvedValue(true);

      await expect(
        service.unpinTrace({ projectId: PROJECT_ID, traceId: "trace_a" }),
      ).rejects.toBeInstanceOf(PinnedToActiveShareError);

      expect(dataRetention.unpin).not.toHaveBeenCalled();
    });

    it("delegates the pin removal when the trace is not shared", async () => {
      vi.mocked(repo.hasActiveShareForResource).mockResolvedValue(false);

      await service.unpinTrace({
        projectId: PROJECT_ID,
        traceId: "trace_a",
      });

      expect(dataRetention.unpin).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        traceId: "trace_a",
      });
    });
  });

  describe("shared payload cache", () => {
    const protections = {
      canSeeCosts: false,
      canSeeCapturedInput: false,
    };

    it("uses the same redaction-aware key for reads and writes", async () => {
      vi.mocked(cache.tryGetPayload).mockResolvedValue({ trace: "cached" });

      await expect(
        service.tryGetCachedPayload({ token: "token", protections }),
      ).resolves.toEqual({ trace: "cached" });
      await service.cachePayload({
        token: "token",
        protections,
        payload: { trace: "fresh" },
      });

      const readKey = vi.mocked(cache.tryGetPayload).mock.calls[0]?.[0];
      expect(cache.setPayload).toHaveBeenCalledWith(readKey, {
        trace: "fresh",
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

        expect(dataRetention.autoUnpin).toHaveBeenCalledTimes(3);
        expect(dataRetention.autoUnpin).toHaveBeenCalledWith({
          projectId: "project_1",
          traceId: "trace_a",
        });
        expect(dataRetention.autoUnpin).toHaveBeenCalledWith({
          projectId: "project_1",
          traceId: "trace_b",
        });
        expect(dataRetention.autoUnpin).toHaveBeenCalledWith({
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
        vi.mocked(dataRetention.autoUnpin)
          .mockRejectedValueOnce(new Error("boom"))
          .mockResolvedValueOnce(void 0);

        await service.revokeAllTraceShares("project_1");

        expect(dataRetention.autoUnpin).toHaveBeenCalledTimes(2);
        // Bulk delete still runs — one stuck pin must not block the revocation.
        expect(repo.deleteAllTraceShares).toHaveBeenCalledWith("project_1");
      });
    });

    describe("when there are no trace shares", () => {
      it("still calls the bulk delete (idempotent) without invoking autoUnpin", async () => {
        vi.mocked(repo.findAllTraceShareResourceIds).mockResolvedValue([]);

        await service.revokeAllTraceShares("project_1");

        expect(dataRetention.autoUnpin).not.toHaveBeenCalled();
        expect(repo.deleteAllTraceShares).toHaveBeenCalledWith("project_1");
      });
    });
  });
});
