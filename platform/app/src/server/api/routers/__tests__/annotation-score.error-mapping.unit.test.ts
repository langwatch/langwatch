import { AnnotationScoreNotFoundError } from "@langwatch/annotation-contract";
import { describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { annotationScoreRouter } from "../annotationScore";

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

describe("annotation score error mapping", () => {
  it("keeps a missing score read on the legacy internal-error path", async () => {
    const ctx = createInnerTRPCContext({
      session: { user: { id: "user-1" }, expires: "1" },
      permissionChecked: true,
    });
    Object.assign(ctx.app, {
      annotations: {
        getScore: vi.fn(async () => {
          throw new AnnotationScoreNotFoundError("missing-score");
        }),
      },
    });

    await expect(
      annotationScoreRouter.createCaller(ctx).getById({
        projectId: "project-1",
        scoreId: "missing-score",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
