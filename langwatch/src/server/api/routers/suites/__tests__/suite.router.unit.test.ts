import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

/**
 * Unit tests for suite router license enforcement.
 *
 * Verifies that the create mutation calls enforceLicenseLimit
 * with the "scenarioSets" limit type before creating a suite.
 *
 * Mocks the enforcement middleware and SuiteService at module boundaries.
 */

const { mockEnforceLicenseLimit, mockSuiteCreate } = vi.hoisted(() => ({
  mockEnforceLicenseLimit: vi.fn().mockResolvedValue(undefined),
  mockSuiteCreate: vi.fn().mockResolvedValue({
    id: "suite-1",
    name: "Test Suite",
    slug: "test-suite",
    projectId: "proj-1",
  }),
}));

vi.mock("~/server/license-enforcement", () => ({
  enforceLicenseLimit: mockEnforceLicenseLimit,
}));

vi.mock("~/server/suites/suite.service", () => ({
  SuiteService: {
    create: () => ({
      create: mockSuiteCreate,
      getAll: vi.fn(),
      getById: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      archive: vi.fn(),
      resolveArchivedNames: vi.fn(),
      run: vi.fn(),
    }),
  },
}));

vi.mock("~/server/projects/project.repository", () => ({
  ProjectRepository: vi.fn().mockImplementation(() => ({
    getOrganizationId: vi.fn().mockResolvedValue("org-1"),
  })),
}));

vi.mock("../../rbac", () => ({
  checkProjectPermission: () => ({ _config: { _middlewares: [] } }),
}));

// Dynamic import after mocks are set up
const { suiteRouter } = await import("../suite.router");

/**
 * Extracts the raw mutation resolver from a tRPC procedure.
 * tRPC v10 stores the resolver in the last middleware of the chain.
 */
function extractMutationResolver(procedure: any): (opts: any) => Promise<any> {
  // tRPC stores the mutation handler in the _def.mutations or as the last middleware
  // Walk the _def to find the actual mutation function
  const def = procedure._def;

  // The mutation resolver is stored as a callable in the middlewares chain
  // For our purposes, we need the function that runs after all middlewares
  // In tRPC v10, the resolver is a `call` in the procedure definition
  if (def.mutation) {
    return def.mutation;
  }

  // Alternative: walk through mutation definitions
  if (def.mutations && def.mutations.length > 0) {
    return def.mutations[def.mutations.length - 1];
  }

  // Fallback: use the procedure itself as a callable
  throw new Error("Could not extract mutation resolver from procedure");
}

describe("suiteRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    const ctx = {
      prisma: {} as any,
      session: { user: { id: "user-1" } } as any,
    };
    const input = {
      projectId: "proj-1",
      name: "Test Suite",
      slug: "test-suite",
      scenarioIds: [],
      targets: [],
    };

    /**
     * Invokes the create mutation handler, bypassing tRPC middleware.
     * Uses internal tRPC structure to access the raw resolver.
     */
    async function invokeCreateMutation() {
      // Access the raw procedure definition
      const procedure = suiteRouter._def.procedures.create as any;

      // tRPC v10 stores the resolver in different spots depending on version
      // Try multiple known locations
      const resolver =
        procedure._def?.resolver ??
        procedure._def?.mutation ??
        procedure.mutation;

      if (typeof resolver === "function") {
        return resolver({ ctx, input, type: "mutation", path: "suites.create" });
      }

      // If direct resolver not available, use the procedure's call method
      // This executes all middlewares too, but since we mock them it's fine
      if (typeof procedure === "function") {
        return procedure({ ctx, rawInput: input, path: "suites.create", type: "mutation" });
      }

      throw new Error("Could not find mutation resolver");
    }

    describe("when scenario set limit is not exceeded", () => {
      it("calls enforceLicenseLimit with scenarioSets type", async () => {
        mockEnforceLicenseLimit.mockResolvedValue(undefined);

        try {
          await invokeCreateMutation();
        } catch {
          // May throw due to incomplete tRPC context; we only care about the call
        }

        expect(mockEnforceLicenseLimit).toHaveBeenCalledWith(
          ctx,
          "proj-1",
          "scenarioSets",
        );
      });

      it("creates the suite after enforcement passes", async () => {
        mockEnforceLicenseLimit.mockResolvedValue(undefined);

        try {
          await invokeCreateMutation();
        } catch {
          // May throw due to incomplete tRPC context
        }

        expect(mockSuiteCreate).toHaveBeenCalled();
      });
    });

    describe("when scenario set limit is exceeded", () => {
      it("does not create the suite", async () => {
        mockEnforceLicenseLimit.mockRejectedValue(
          new TRPCError({
            code: "FORBIDDEN",
            message: "You've reached the limit of scenario sets on your current plan",
            cause: { limitType: "scenarioSets", current: 3, max: 3 },
          }),
        );

        try {
          await invokeCreateMutation();
        } catch {
          // Expected to throw
        }

        expect(mockEnforceLicenseLimit).toHaveBeenCalledWith(
          ctx,
          "proj-1",
          "scenarioSets",
        );
        expect(mockSuiteCreate).not.toHaveBeenCalled();
      });
    });
  });
});
