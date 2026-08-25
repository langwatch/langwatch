import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardNotFoundError } from "@langwatch/dashboard-contract";
import { createInnerTRPCContext } from "../../trpc";
import { graphsRouter } from "../graphs";

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
    value: { createGraph },
  });
  return graphsRouter.createCaller(ctx);
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
