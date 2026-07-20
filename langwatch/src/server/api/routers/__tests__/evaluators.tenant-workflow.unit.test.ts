import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { evaluatorsRouter } from "../evaluators";

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

const workflowFindFirst = vi.fn();
const evaluatorFindFirst = vi.fn();
const evaluatorCreate = vi.fn();

const prisma = {
  workflow: { findFirst: workflowFindFirst },
  evaluator: {
    findFirst: evaluatorFindFirst,
    create: evaluatorCreate,
  },
} as unknown as PrismaClient;

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = prisma;
  return evaluatorsRouter.createCaller(ctx);
};

beforeEach(() => {
  vi.clearAllMocks();
  workflowFindFirst.mockResolvedValue(null);
  evaluatorFindFirst.mockResolvedValue(null);
});

describe("evaluator workflow references", () => {
  it("rejects a workflow from another project on create", async () => {
    await expect(
      createCaller().create({
        projectId: "project_1",
        name: "Foreign workflow",
        type: "workflow",
        config: {},
        workflowId: "workflow_2",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(evaluatorCreate).not.toHaveBeenCalled();
  });

  it("rejects a workflow from another project on update", async () => {
    await expect(
      createCaller().update({
        id: "evaluator_1",
        projectId: "project_1",
        workflowId: "workflow_2",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not follow a stale foreign workflow on read", async () => {
    evaluatorFindFirst.mockResolvedValue({
      id: "evaluator_1",
      projectId: "project_1",
      type: "workflow",
      workflowId: "workflow_2",
    });

    const result = await createCaller().getWorkflowFields({
      id: "evaluator_1",
      projectId: "project_1",
    });

    expect(result.fields).toEqual([]);
    expect(workflowFindFirst).toHaveBeenCalledWith({
      where: {
        id: "workflow_2",
        projectId: "project_1",
        archivedAt: null,
      },
      include: { currentVersion: true },
    });
  });
});
