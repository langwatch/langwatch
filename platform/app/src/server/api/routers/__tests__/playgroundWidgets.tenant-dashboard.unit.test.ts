import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { playgroundWidgetsRouter } from "../playgroundWidgets";

// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return { ...actual, enforceLicenseLimit: vi.fn() };
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

const dashboardFindFirst = vi.fn();
const graphFindFirst = vi.fn();
const graphCreate = vi.fn();
const graphUpdateMany = vi.fn();

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = {
    dashboard: { findFirst: dashboardFindFirst },
    customGraph: {
      findFirst: graphFindFirst,
      create: graphCreate,
      updateMany: graphUpdateMany,
    },
  } as unknown as PrismaClient;
  return playgroundWidgetsRouter.createCaller(ctx);
};

beforeEach(() => {
  vi.clearAllMocks();
  dashboardFindFirst.mockResolvedValue(null);
  graphFindFirst.mockResolvedValue(null);
});

describe("playground widget dashboard references", () => {
  it("create rejects a dashboard from another project", async () => {
    await expect(
      createCaller().create({
        projectId: "project_1",
        dashboardId: "dashboard_2",
        name: "Widget",
        code: "",
        queries: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(dashboardFindFirst).toHaveBeenCalledWith({
      where: { id: "dashboard_2", projectId: "project_1" },
      select: { id: true },
    });
    expect(graphCreate).not.toHaveBeenCalled();
  });

  it("assignDashboard rejects a dashboard from another project", async () => {
    await expect(
      createCaller().assignDashboard({
        projectId: "project_1",
        id: "widget_1",
        dashboardId: "dashboard_2",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(dashboardFindFirst).toHaveBeenCalledWith({
      where: { id: "dashboard_2", projectId: "project_1" },
      select: { id: true },
    });
    expect(graphUpdateMany).not.toHaveBeenCalled();
  });
});
