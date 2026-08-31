import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardNotFoundError } from "@langwatch/dashboard-contract";
import { DashboardApp, type DashboardAppDependencies } from "@langwatch/dashboard-server";
import { createInnerTRPCContext } from "../../trpc";
import { appRouter } from "../../root";

// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../license-enforcement")>();
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

const createGraph = vi.fn();

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    permissionChecked: true,
  });
  Object.defineProperty(ctx.app, "dashboard", {
    configurable: true,
    // The real `DashboardApp` over a stubbed service. The translation from the
    // service's `DashboardNotFoundError` to the typed 404 the transport ships
    // is the application's own rule, so a hand-written double standing in its
    // place would decide the answer this test is asking about.
    value: DashboardApp.create({
      dashboard: { createGraph },
    } as unknown as DashboardAppDependencies),
  });
  return appRouter.createCaller(ctx).graphs;
};

beforeEach(() => {
  vi.clearAllMocks();
  createGraph.mockRejectedValue(new DashboardNotFoundError());
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

    expect(createGraph).toHaveBeenCalledWith({
      projectId: "project_1",
      name: "Graph",
      graph: {},
      filters: {},
      dashboardId: "dashboard_2",
      layout: {
        gridColumn: 0,
        colSpan: 1,
        rowSpan: 1,
      },
    });
  });
});
