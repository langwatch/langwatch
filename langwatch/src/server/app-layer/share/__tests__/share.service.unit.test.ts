import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import type {
  ShareRepository,
  ShareWithProject,
} from "../repositories/share.repository";
import { ShareService, type ShareViewer } from "../share.service";

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
      team: { organizationId: ORG_ID },
    },
    ...overrides,
  } as ShareWithProject;
}

function buildViewer(overrides: Partial<ShareViewer> = {}): ShareViewer {
  return {
    grantedShareId: null,
    isOrgMember: vi.fn().mockResolvedValue(false),
    isProjectMember: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("ShareService", () => {
  let repo: ShareRepository;
  let pinnedTraces: Pick<PinnedTraceService, "autoUnpin" | "autoPin">;
  let service: ShareService;

  beforeEach(() => {
    repo = {
      findByToken: vi.fn(),
      findById: vi.fn(),
      listByResource: vi.fn(),
      hasActiveShareForResource: vi.fn().mockResolvedValue(false),
      create: vi.fn(),
      incrementViewCount: vi.fn().mockResolvedValue(true),
      deleteById: vi.fn(),
      deleteByResource: vi.fn(),
      findAllTraceShareResourceIds: vi.fn(),
      deleteAllTraceShares: vi.fn(),
    } as unknown as ShareRepository;
    pinnedTraces = {
      autoUnpin: vi.fn().mockResolvedValue(undefined),
      autoPin: vi.fn().mockResolvedValue(undefined),
    };
    service = new ShareService(repo, pinnedTraces as PinnedTraceService);
  });

  describe("resolveForViewer", () => {
    describe("given no share matches the token", () => {
      it("reports not_found", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(null);

        const result = await service.resolveForViewer({
          token: "tok_nope",
          viewer: buildViewer(),
        });

        expect(result.status).toBe("not_found");
      });
    });

    describe("given the project disabled trace sharing", () => {
      it("reports sharing_disabled", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({
            project: {
              traceSharingEnabled: false,
              team: { organizationId: ORG_ID },
            },
          }),
        );

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(result.status).toBe("sharing_disabled");
      });
    });

    describe("given the link expired in the past", () => {
      it("reports expired and does not consume a view", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ expiresAt: new Date(Date.now() - 1000) }),
        );

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(result.status).toBe("expired");
        expect(repo.incrementViewCount).not.toHaveBeenCalled();
      });
    });

    describe("given a public link", () => {
      it("grants an anonymous viewer and consumes one view", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(buildShare());

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(result.status).toBe("granted");
        expect(result).toMatchObject({ isConsumed: true });
        expect(repo.incrementViewCount).toHaveBeenCalledWith({
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

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer({ isOrgMember: vi.fn().mockResolvedValue(false) }),
        });

        expect(result.status).toBe("forbidden");
        expect(repo.incrementViewCount).not.toHaveBeenCalled();
      });

      it("grants a member of that organization", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ visibility: "ORGANIZATION" }),
        );
        const isOrgMember = vi.fn().mockResolvedValue(true);

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer({ isOrgMember }),
        });

        expect(result.status).toBe("granted");
        expect(isOrgMember).toHaveBeenCalledWith(ORG_ID);
      });
    });

    describe("given a project-scoped link", () => {
      it("grants a member of that project", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ visibility: "PROJECT" }),
        );
        const isProjectMember = vi.fn().mockResolvedValue(true);

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer({ isProjectMember }),
        });

        expect(result.status).toBe("granted");
        expect(isProjectMember).toHaveBeenCalledWith(PROJECT_ID);
      });

      it("denies a non-member", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ visibility: "PROJECT" }),
        );

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(result.status).toBe("forbidden");
      });
    });

    describe("given a single-view link", () => {
      it("grants the first view", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ maxViews: 1, viewCount: 0 }),
        );

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(result.status).toBe("granted");
        expect(repo.incrementViewCount).toHaveBeenCalledOnce();
      });

      it("reports exhausted once the view was already spent", async () => {
        vi.mocked(repo.findByToken).mockResolvedValue(
          buildShare({ maxViews: 1, viewCount: 1 }),
        );

        const result = await service.resolveForViewer({
          token: "tok_abc",
          viewer: buildViewer(),
        });

        expect(result.status).toBe("exhausted");
        expect(repo.incrementViewCount).not.toHaveBeenCalled();
      });

      describe("when the viewer already holds a grant for this share", () => {
        /**
         * One view == one grant issuance. A page load fires several data reads
         * and the viewer may refresh within the grant window; neither may
         * re-consume the single view, nor be denied as exhausted.
         */
        it("re-grants without consuming another view", async () => {
          vi.mocked(repo.findByToken).mockResolvedValue(
            buildShare({ maxViews: 1, viewCount: 1 }),
          );

          const result = await service.resolveForViewer({
            token: "tok_abc",
            viewer: buildViewer({ grantedShareId: "share_1" }),
          });

          expect(result.status).toBe("granted");
          expect(result).toMatchObject({ isConsumed: false });
          expect(repo.incrementViewCount).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe("createShare", () => {
    it("mints a high-entropy token and auto-pins the trace", async () => {
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
      it("does nothing", async () => {
        vi.mocked(repo.findById).mockResolvedValue(
          buildShare({ projectId: "other_project" }),
        );

        await service.revokeById({ id: "share_1", projectId: PROJECT_ID });

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
