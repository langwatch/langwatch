import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { graphsRouter } from "../graphs";

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return { ...actual, enforceLicenseLimit: vi.fn() };
});

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

const dashboardFindFirst = vi.fn();
const graphCreate = vi.fn();

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = {
    dashboard: { findFirst: dashboardFindFirst },
    customGraph: { create: graphCreate },
  } as unknown as PrismaClient;
  return graphsRouter.createCaller(ctx);
};

beforeEach(() => {
  vi.clearAllMocks();
  dashboardFindFirst.mockResolvedValue(null);
});

describe("graph dashboard references", () => {
  it("rejects a dashboard from another project", async () => {
    await expect(
      createCaller().create({
        projectId: "project_1",
        name: "Graph",
        graph: "{}",
        dashboardId: "dashboard_2",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(dashboardFindFirst).toHaveBeenCalledWith({
      where: { id: "dashboard_2", projectId: "project_1" },
      select: { id: true },
    });
    expect(graphCreate).not.toHaveBeenCalled();
  });
});
