/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useRunScenario } from "../useRunScenario";

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock tRPC api
const mockMutateAsync = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      run: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          isPending: false,
        }),
      },
      getBatchRunData: {
        fetch: vi.fn(),
      },
    },
    useContext: () => ({
      scenarios: {
        getBatchRunData: {
          fetch: vi.fn(),
        },
      },
    }),
  },
}));

// Mock toaster
const mockToasterCreate = vi.fn();
vi.mock("../../components/ui/toaster", () => ({
  toaster: {
    create: (args: unknown) => mockToasterCreate(args),
  },
}));

// Mock pollForScenarioRun
vi.mock("~/utils/pollForScenarioRun", () => ({
  pollForScenarioRun: vi.fn().mockResolvedValue({ success: true, scenarioRunId: "run-123" }),
}));

// Mock buildRoutePath
vi.mock("~/utils/routes", () => ({
  buildRoutePath: vi.fn().mockReturnValue("/mock/route"),
}));

// Create a variable for mock that can be modified per test
let mockHasEnabledProviders = true;

// Mock useModelProvidersSettings
vi.mock("../useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    hasEnabledProviders: mockHasEnabledProviders,
    isLoading: false,
  }),
}));

describe("useRunScenario()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({
      setId: "set-123",
      batchRunId: "batch-123",
    });
    // Reset to having providers by default
    mockHasEnabledProviders = true;
  });

  describe("when model providers are configured", () => {
    it("allows running scenarios", async () => {
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
        })
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      expect(mockMutateAsync).toHaveBeenCalled();
    });
  });

  describe("when no model providers are configured", () => {
    beforeEach(() => {
      mockHasEnabledProviders = false;
    });

    it("shows error toast", async () => {
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
        })
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "No model provider configured",
            type: "error",
          })
        );
      });
    });

    it("does not call run mutation", async () => {
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
        })
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });
});
