import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { workflowRouter } from "../workflows";

const { hasProjectPermission } = vi.hoisted(() => ({
  hasProjectPermission: vi.fn(),
}));

// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
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

// The router's imperative check goes through the app-layer facade.
vi.mock("~/server/app-layer/permissions/imperative", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("~/server/app-layer/permissions/imperative")
  >();
  return { ...actual, probeProjectPermission: hasProjectPermission };
});

const findMany = vi.fn();

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = {
    workflow: { findMany },
  } as unknown as PrismaClient;
  return workflowRouter.createCaller(ctx);
};

beforeEach(() => {
  vi.clearAllMocks();
  hasProjectPermission.mockImplementation(
    async (_ctx, projectId, permission) => {
      expect(permission).toBe("workflows:view");
      return projectId === "project_visible";
    },
  );
  findMany.mockResolvedValue([
    {
      id: "workflow_copy",
      projectId: "project_1",
      copiedFromWorkflowId: "workflow_source",
      copiedFrom: {
        id: "workflow_source",
        name: "Private source",
        projectId: "project_private",
        project: {
          id: "project_private",
          name: "Private project",
          team: {
            id: "team_private",
            name: "Private team",
            organization: { id: "org_private", name: "Private org" },
          },
        },
      },
      copiedWorkflows: [
        { projectId: "project_private" },
        { projectId: "project_visible" },
      ],
    },
  ]);
});

describe("workflow list tenant metadata", () => {
  it("hides source metadata without source-project access", async () => {
    const [workflow] = await createCaller().getAll({ projectId: "project_1" });

    expect(workflow?.copiedFromWorkflowId).toBeNull();
    expect(workflow?.copiedFrom).toBeNull();
  });

  it("only counts copies in projects the caller can view", async () => {
    const [workflow] = await createCaller().getAll({ projectId: "project_1" });

    expect(workflow?._count.copiedWorkflows).toBe(1);
  });
});
