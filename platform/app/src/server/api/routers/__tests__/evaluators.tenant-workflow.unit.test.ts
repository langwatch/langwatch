import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { permissionsServiceFor } from "~/server/app-layer/permissions/runtime";
import { createInnerTRPCContext } from "../../trpc";
import { evaluatorsRouter } from "../evaluators";

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return { ...actual, enforceLicenseLimit: vi.fn() };
});

// Mutations audit through the global prisma, not ctx.prisma — unmocked, the
// middleware reaches for a real database this unit environment does not have.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const workflowFindFirst = vi.fn();
const evaluatorFindFirst = vi.fn();
const evaluatorCreate = vi.fn();

// Keep authorization real: the caller has a live organization admin grant.
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
    findFirst: vi.fn().mockResolvedValue({
      role: OrganizationUserRole.ADMIN,
      disabledAt: null,
    }),
  },
  groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
  grant: {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "grant-evaluator-admin",
        organizationId: "org_1",
        principalType: "USER",
        principalId: "user_1",
        roleKey: "admin",
        legacyRole: null,
        source: "grants-service",
        scopeType: "ORGANIZATION",
        scopeId: "org_1",
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: null,
        expiresAt: null,
        maxViews: null,
        occurredAt: new Date("2025-01-01T00:00:00.000Z"),
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
  ctx.app = { permissions: permissionsServiceFor(prisma) } as never;
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
