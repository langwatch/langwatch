import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tracesRouter } from "../traces";
import { createInnerTRPCContext } from "../../trpc";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetAllTracesForProject } = vi.hoisted(() => ({
  mockGetAllTracesForProject: vi.fn(),
}));

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: {
    create: () => ({
      getAllTracesForProject: mockGetAllTracesForProject,
    }),
  },
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    checkPermissionOrPubliclyShared:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("../../utils", () => ({
  getUserProtectionsForProject: vi.fn().mockResolvedValue({
    canSeeCosts: true,
    canSeePiiData: true,
    canSeeTopics: true,
  }),
}));

vi.mock("~/server/evaluations/evaluators.generated", () => ({
  evaluatorsSchema: { keyof: () => ({ or: () => ({}) }) },
}));

vi.mock("~/server/evaluations/preconditions", () => ({
  evaluatePreconditions: vi.fn(),
  buildPreconditionTraceDataFromTrace: vi.fn(),
  checkEvaluatorRequiredFields: vi.fn(),
}));

vi.mock("~/server/evaluations/types", () => ({
  checkPreconditionSchema: {},
}));

describe("traces.getAllForProject", () => {
  let caller: ReturnType<typeof tracesRouter.createCaller>;

  const baseInput = {
    projectId: "project_123",
    startDate: Date.now() - 86400000,
    endDate: Date.now(),
    pageSize: 10,
    pageOffset: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "test-user-id" },
        expires: "1",
      },
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: false,
    });

    ctx.prisma = {} as unknown as PrismaClient;
    caller = tracesRouter.createCaller(ctx);
  });

  describe("when scrollId is provided in the input", () => {
    it("forwards scrollId to the trace service options parameter", async () => {
      const scrollId = "base64encodedcursordata";

      mockGetAllTracesForProject.mockResolvedValueOnce({
        groups: [],
        totalHits: 0,
        traceChecks: {},
      });

      await caller.getAllForProject({
        ...baseInput,
        scrollId,
      });

      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.objectContaining({ scrollId }),
        expect.any(Object),
        { scrollId },
      );
    });
  });

  describe("when scrollId is not provided", () => {
    it("forwards undefined scrollId in options", async () => {
      mockGetAllTracesForProject.mockResolvedValueOnce({
        groups: [],
        totalHits: 0,
        traceChecks: {},
      });

      await caller.getAllForProject(baseInput);

      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { scrollId: undefined },
      );
    });
  });
});
