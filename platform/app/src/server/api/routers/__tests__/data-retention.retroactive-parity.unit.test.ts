import type { RetroactiveMutationProgress } from "@langwatch/data-retention-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const policyAuthz = vi.hoisted(() => ({
  assertCanDisableRetention: vi.fn(),
  assertCanWriteRetentionScope: vi.fn(),
  assertRetentionPlan: vi.fn(),
  assertRetentionPlanForScope: vi.fn(),
  assertRetentionWriteAllowed: vi.fn(),
}));
const prisma = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn().mockResolvedValue({
      team: { organizationId: "organization-1" },
    }),
  },
}));

vi.mock("~/server/data-retention/policy/dataRetentionPolicy.authz", () => policyAuthz);
vi.mock("~/server/data-retention/policy/dataRetentionPolicy.read", () => ({
  getRetentionPolicySnapshot: vi.fn(),
}));
vi.mock("~/server/data-retention/metering/storageMeter.read", () => ({
  resolveScopeStorageUsage: vi.fn(),
}));
vi.mock("~/server/api/rbac", async () => {
  const { declareAuthzMiddleware } = await import("@langwatch/authz-contract");
  return {
    authorizeInResolver: (enforces: Record<string, string>) =>
      declareAuthzMiddleware(
        {
          kind: "service-authorized",
          reason: "test declaration",
          permissions: [],
          enforces,
        },
        async ({
          ctx,
          next,
        }: {
          ctx: { permissionChecked: boolean };
          next(): unknown;
        }) => {
          ctx.permissionChecked = true;
          return next();
        },
      ),
  };
});

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});
vi.mock("~/server/db", () => ({ prisma }));

vi.mock("~/runtime/app/features/audit-log", () => ({ auditLog: vi.fn() }));

import { dataRetentionRouter } from "../dataRetention";
import { createInnerTRPCContext } from "../../trpc";

const getResolvedForProject = vi.fn();
const triggerRetroactiveUpdate = vi.fn();
const getRetroactiveMutationProgress = vi.fn();

function caller() {
  const context = createInnerTRPCContext({
    session: { user: { id: "user-1" }, expires: "1" },
    permissionChecked: true,
  });
  Object.assign(context.app, {
    permissions: {
      getDecision: vi
        .fn()
        .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
    },
    dataRetention: {
      getResolvedForProject,
      triggerRetroactiveUpdate,
      getRetroactiveMutationProgress,
    },
    planProvider: {},
  });

  return dataRetentionRouter.createCaller(context);
}

describe("data-retention retroactive tRPC parity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the legacy tables and applied retention fields", async () => {
    getResolvedForProject.mockResolvedValue({
      traces: 49,
      scenarios: 63,
      experiments: 91,
    });
    triggerRetroactiveUpdate.mockResolvedValue({
      tables: ["trace_summaries", "trace_analytics", "trace_analytics_rollup"],
    });

    await expect(
      caller().triggerRetroactiveUpdate({
        projectId: "project-1",
        category: "traces",
      }),
    ).resolves.toEqual({
      tables: ["trace_summaries", "trace_analytics", "trace_analytics_rollup"],
      appliedRetentionDays: 49,
    });

    expect(triggerRetroactiveUpdate).toHaveBeenCalledWith({
      projectId: "project-1",
      category: "traces",
      newRetentionDays: 49,
    });
  });

  it("forwards the legacy progress shape unchanged", async () => {
    const progress: RetroactiveMutationProgress[] = [
      {
        mutationId: "mutation-1",
        table: "trace_analytics",
        isDone: false,
        partsToDo: 3,
        createTime: "2026-08-26T20:00:00",
        category: "traces",
      },
    ];
    getRetroactiveMutationProgress.mockResolvedValue(progress);

    await expect(
      caller().getMutationProgress({ projectId: "project-1" }),
    ).resolves.toEqual(progress);
  });
});
