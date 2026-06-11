/**
 * @vitest-environment jsdom
 *
 * Integration tests for the evaluate-time autosave: when no Fast model
 * resolves, the auto-committed version keeps the "autosaved" fallback
 * description without ever firing the commit-message generation call,
 * so no missing-model toast interrupts the run.
 *
 * UX contract: specs/model-providers/missing-model-popup.feature.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockResolvedDefault,
  mockGenerateMutateAsync,
  mockCommitMutateAsync,
  mockPostEvent,
} = vi.hoisted(() => ({
  mockResolvedDefault: { current: null as { model: string } | null },
  mockGenerateMutateAsync: vi.fn().mockResolvedValue("generated message"),
  mockCommitMutateAsync: vi.fn().mockResolvedValue({ id: "v-2" }),
  mockPostEvent: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      workflow: { getVersions: { invalidate: vi.fn() } },
    }),
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({
          data: mockResolvedDefault.current,
          isLoading: false,
          isFetched: true,
        }),
      },
    },
    workflow: {
      commitVersion: {
        useMutation: () => ({ mutateAsync: mockCommitMutateAsync }),
      },
      generateCommitMessage: {
        useMutation: () => ({ mutateAsync: mockGenerateMutateAsync }),
      },
    },
  },
}));

vi.mock("../usePostEvent", () => ({
  usePostEvent: () => ({ postEvent: mockPostEvent, isLoading: false }),
}));

const storeState = {
  setEvaluationState: vi.fn(),
  setWorkflow: vi.fn(),
  getWorkflow: () => ({
    workflow_id: "wf-1",
    name: "Test Workflow",
    nodes: [],
    edges: [],
    state: {},
  }),
};

vi.mock("../useWorkflowStore", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) => selector(storeState),
  serializeWorkflow: (workflow: unknown) => workflow,
}));

vi.mock("../../components/History", () => ({
  useVersionState: () => ({
    latestVersion: { id: "v-1-auto", autoSaved: true },
    previousVersion: {
      id: "v-1",
      version: "1.0",
      dsl: {
        workflow_id: "wf-1",
        name: "Prev",
        nodes: [
          {
            id: "old_node",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {},
          },
        ],
        edges: [],
      },
    },
    nextVersion: "1.1",
  }),
}));

const { useRunEvalution } = await import("../useRunEvalution");

describe("given an evaluation run auto-commits unsaved changes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when no Fast model resolves at any scope", () => {
    /** @scenario Evaluate-time autosave without a Fast model commits silently */
    it("commits with the autosaved fallback and sends no generation request", async () => {
      mockResolvedDefault.current = null;
      const { result } = renderHook(() => useRunEvalution());

      await act(async () => {
        await result.current.runEvaluation({});
      });

      expect(mockGenerateMutateAsync).not.toHaveBeenCalled();
      expect(mockCommitMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockCommitMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ commitMessage: "autosaved" }),
      );
      expect(mockPostEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a Fast model resolves for the project", () => {
    it("generates the description before committing", async () => {
      mockResolvedDefault.current = { model: "openai/gpt-5-mini" };
      const { result } = renderHook(() => useRunEvalution());

      await act(async () => {
        await result.current.runEvaluation({});
      });

      expect(mockGenerateMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockCommitMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ commitMessage: "generated message" }),
      );
    });
  });
});
