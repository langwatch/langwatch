/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRunScenario } from "../useRunScenario";

// Mock tRPC api. `mockBatchRunFetch` is hoisted and stable across renders so a
// test can inspect the options the hook hands to react-query — the fetch is
// what the poll ultimately calls, and its caching options are load-bearing.
const mockMutateAsync = vi.fn();
const mockBatchRunFetch = vi.hoisted(() => vi.fn());
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
        fetch: mockBatchRunFetch,
      },
    },
    useUtils: () => ({
      scenarios: {
        getBatchRunData: {
          fetch: mockBatchRunFetch,
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
    mockPollForScenarioRun.mockResolvedValue({
      success: true,
      scenarioRunId: "run-123",
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
        }),
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
        }),
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
          }),
        );
      });
    });

    it("exposes the settings link via the toaster action slot", async () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
        }),
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "No model provider configured",
            action: expect.objectContaining({
              label: "Configure model providers",
            }),
          }),
        );
      });

      const toastCall = mockToasterCreate.mock.calls[0]![0] as {
        description?: unknown;
        action?: { onClick: () => void };
      };
      // Description must be a plain string, not JSX/anchor.
      expect(typeof toastCall.description).toBe("string");

      // Invoking the action opens the provider settings in a new tab.
      toastCall.action?.onClick();
      expect(openSpy).toHaveBeenCalledWith(
        "/settings/model-providers",
        "_blank",
        "noopener,noreferrer",
      );

      openSpy.mockRestore();
    });

    it("does not call run mutation", async () => {
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
        }),
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
        }),
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
        }),
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

  describe("when the run finished and did not pass", () => {
    beforeEach(() => {
      mockPollForScenarioRun.mockResolvedValue({
        success: false,
        error: "run_failed",
        scenarioRunId: "not-passed-run-123",
      });
    });

    it("does not tell the user execution errored", async () => {
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
        }),
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalled();
      });

      const toastCall = mockToasterCreate.mock.calls[0]![0] as {
        title?: string;
        description?: string;
      };
      // The run executed fine — the agent just did not pass. Reporting an
      // execution error sends the user to debug infrastructure that is healthy.
      expect(toastCall.description).not.toContain(
        "encountered an error during execution",
      );
      expect(toastCall.title).not.toBe("Scenario run failed");
    });

    it("offers the run so the user can read the outcome", async () => {
      const onRunFailed = vi.fn();
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
          onRunFailed,
        }),
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalled();
      });

      const toastCall = mockToasterCreate.mock.calls[0]![0] as {
        action?: { onClick: () => void };
      };
      toastCall.action?.onClick();

      expect(onRunFailed).toHaveBeenCalledWith({
        scenarioRunId: "not-passed-run-123",
        setId: "set-123",
        batchRunId: "batch-123",
      });
    });

    it("does not navigate on its own", async () => {
      const onRunComplete = vi.fn();
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
          onRunComplete,
        }),
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalled();
      });

      // onRunComplete navigates (useDrawerRunCallbacks pushes a route). A run
      // that did not pass must not yank the user off the page they are on —
      // navigation stays opt-in via the toast action.
      expect(onRunComplete).not.toHaveBeenCalled();
    });
  });

  describe("when the poll asks the server for batch-run data", () => {
    it("asks for fresh data and does not retry", async () => {
      const { result } = renderHook(() =>
        useRunScenario({
          projectId: "project-123",
          projectSlug: "my-project",
        }),
      );

      await result.current.runScenario({
        scenarioId: "scenario-123",
        target: { type: "prompt", id: "prompt-123" },
      });

      await waitFor(() => {
        expect(mockPollForScenarioRun).toHaveBeenCalled();
      });

      // The poll calls this fetcher up to 60 times over 30s with an identical
      // input. Under the app's default staleTime (30_000) every call after the
      // first is served from the first one's cached answer, so the poll can
      // never observe the run appearing. staleTime: 0 forces a real request.
      // retry: false matters too: fetchQuery only defaults retry off when it is
      // undefined, and the app defines it globally — 4 retries with backoff
      // would burn the whole polling budget inside a single attempt.
      const fetcher = mockPollForScenarioRun.mock.calls[0]![0] as (
        params: unknown,
      ) => Promise<unknown>;
      const params = {
        projectId: "project-123",
        scenarioSetId: "set-123",
        batchRunId: "batch-123",
      };
      await fetcher(params);

      expect(mockBatchRunFetch).toHaveBeenCalledWith(
        params,
        expect.objectContaining({ staleTime: 0, retry: false }),
      );
    });
  });

  describe("when the run could not execute", () => {
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
        }),
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
          }),
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
