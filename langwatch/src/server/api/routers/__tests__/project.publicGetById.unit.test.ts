import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { projectRouter } from "../project";

const { mockGetPublicProjectForGrant, audienceViewer } = vi.hoisted(() => ({
  mockGetPublicProjectForGrant: vi.fn(),
  audienceViewer: {
    isOrgMember: vi.fn(),
    isProjectMember: vi.fn(),
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    share: { getPublicProjectForGrant: mockGetPublicProjectForGrant },
  }),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    createShareAudienceViewer: vi.fn(() => audienceViewer),
  };
});

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nano-id"),
  customAlphabet: vi.fn(
    () => () => "mock48characterrandomstringforapikeygeneration",
  ),
}));

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

describe("project.publicGetById", () => {
  const grant = {
    share_id: "share_1",
    project_id: "project_1",
    resource_type: "TRACE" as const,
    resource_id: "trace_1",
    thread_id: null,
  };
  let caller: ReturnType<typeof projectRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = createInnerTRPCContext({
      session: null,
      req: undefined,
      res: undefined,
      shareGrant: grant,
    });
    ctx.prisma = {} as PrismaClient;
    caller = projectRouter.createCaller(ctx);
  });

  describe("when the share service grants project chrome access", () => {
    it("returns the sanitized project from the share service", async () => {
      const project = {
        id: "project_1",
        name: "Test project",
        slug: "test-project",
        language: "typescript",
        framework: "nextjs",
      };
      mockGetPublicProjectForGrant.mockResolvedValue({
        status: "granted",
        project,
      });

      const result = await caller.publicGetById({
        id: "project_1",
        shareId: "share_1",
      });

      expect(result).toEqual(project);
      expect(mockGetPublicProjectForGrant).toHaveBeenCalledWith({
        shareId: "share_1",
        projectId: "project_1",
        grant,
        viewer: audienceViewer,
      });
    });
  });

  describe("when the share service cannot find an active matching link", () => {
    it("returns NOT_FOUND", async () => {
      mockGetPublicProjectForGrant.mockResolvedValue({ status: "not_found" });

      await expect(
        caller.publicGetById({ id: "project_1", shareId: "share_1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("when the share service rejects the grant or current audience", () => {
    it("returns UNAUTHORIZED", async () => {
      mockGetPublicProjectForGrant.mockResolvedValue({ status: "forbidden" });

      await expect(
        caller.publicGetById({ id: "project_1", shareId: "share_1" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });
});
