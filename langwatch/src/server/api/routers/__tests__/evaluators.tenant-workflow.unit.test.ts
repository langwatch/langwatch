import type { PrismaClient } from "@prisma/client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { evaluatorsRouter } from "../evaluators";

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return { ...actual, enforceLicenseLimit: vi.fn() };
});

// Mutations audit through the global prisma, not ctx.prisma — unmocked, the
// middleware reaches for a real database this unit environment does not have.
vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const workflowFindFirst = vi.fn();
const evaluatorFindFirst = vi.fn();
const evaluatorCreate = vi.fn();

// The caller is seeded as an org admin so the REAL rbac middleware resolves
// and grants project permissions. (No vi.mock on the rbac module: under the
// unit pool's shared module registry a module mock can silently fail to
// apply depending on which files preceded this one in the worker, letting
// the real middleware run against a stub that could not serve it. The
// seeded-admin path has no such order sensitivity.)
const prisma = {
  workflow: { findFirst: workflowFindFirst },
  evaluator: {
    findFirst: evaluatorFindFirst,
    create: evaluatorCreate,
  },
  project: {
    findUnique: vi.fn().mockResolvedValue({
      team: { id: "team_1", organizationId: "org_1" },
    }),
  },
  organizationUser: {
    findFirst: vi.fn().mockResolvedValue({ role: OrganizationUserRole.ADMIN }),
  },
  groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
  roleBinding: {
    findMany: vi.fn().mockResolvedValue([
      {
        role: TeamUserRole.ADMIN,
        customRoleId: null,
        scopeType: RoleBindingScopeType.ORGANIZATION,
      },
    ]),
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
