/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useRunScenario } from "../useRunScenario";

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
const mockPollForScenarioRun = vi.hoisted(() => vi.fn());
vi.mock("~/utils/pollForScenarioRun", () => ({
  pollForScenarioRun: mockPollForScenarioRun,
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
    mockPollForScenarioRun.mockResolvedValue({ success: true, scenarioRunId: "run-123" });
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

  describe("when run completes successfully", () => {
    it("calls onRunComplete callback with run result", async () => {
      const onRunComplete = vi.fn();
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
          onRunComplete,
        })
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      await waitFor(() => {
        expect(onRunComplete).toHaveBeenCalledWith({
          scenarioRunId: "run-123",
          setId: "set-123",
          batchRunId: "batch-123",
        });
      });
    });

    it("completes without error when no onRunComplete callback is provided", async () => {
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

      // Mutation was called and polling completed without throwing
      expect(mockMutateAsync).toHaveBeenCalled();
      expect(mockPollForScenarioRun).toHaveBeenCalled();
    });
  });

  describe("when run fails with an error", () => {
    beforeEach(() => {
      mockPollForScenarioRun.mockResolvedValue({
        success: false,
        error: "run_error",
        scenarioRunId: "failed-run-123",
      });
    });

    it("shows error toast with action that calls onRunFailed", async () => {
      const onRunFailed = vi.fn();
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
          onRunFailed,
        })
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Scenario run failed",
            type: "error",
          })
        );
      });

      // Simulate clicking the toast action
      const toastCall = mockToasterCreate.mock.calls[0]![0] as {
        action?: { onClick: () => void };
      };
      toastCall.action?.onClick();

      expect(onRunFailed).toHaveBeenCalledWith({
        scenarioRunId: "failed-run-123",
        setId: "set-123",
        batchRunId: "batch-123",
      });
    });
  });
});
