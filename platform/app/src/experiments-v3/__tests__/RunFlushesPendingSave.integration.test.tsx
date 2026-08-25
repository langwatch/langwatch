/**
 * @vitest-environment jsdom
 *
 * A run must not start while this tab still holds an unsaved edit.
 *
 * A run writes its results back as a new version. So an edit the agent just
 * made, still sitting on the autosave debounce, is a version behind before the
 * first cell lands, and the save that follows is refused as out of date. That
 * is the failure the sibling suite describes: the duplicated column existed in
 * one tab and could never be saved after the run.
 *
 * `AgentEditDurability.integration.test.tsx` covers the transform actions,
 * which persist before they answer. This one covers `workbench.run`, which has
 * nothing of its own to answer with and must flush what is already pending.
 *
 * @see specs/langy/langy-ui-actions.feature
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";

/** What the page hands to `useRegisterLangyActions`, captured on render. */
const captured = vi.hoisted(() => ({
  handlers: undefined as LangyUiActionHandlers | undefined,
}));

/** The order the two boundaries were reached in. This is the whole assertion. */
const calls = vi.hoisted(() => [] as string[]);

const saveNow = vi.hoisted(() =>
  vi.fn(async () => {
    // A save is a network round trip, so the run must still be waiting on the
    // far side of it. Resolving synchronously would let a handler that never
    // awaited look correct.
    await new Promise((resolve) => setTimeout(resolve, 0));
    calls.push("save");
    return "saved" as const;
  }),
);

const executeEvaluation = vi.hoisted(() =>
  vi.fn(
    (_scope?: unknown, options?: { onRunStarted?: (id: string) => void }) => {
      calls.push("run");
      // The real hook names the run from the stream's first frame. The action
      // answers with that id, so the mock has to produce one.
      options?.onRunStarted?.("swift-bold-fox");
    },
  ),
);

vi.mock("~/components/DashboardLayout", () => ({
  // Children are dropped: the page body is what registers the handlers, and
  // the grid underneath is irrelevant to the ordering under test.
  DashboardLayout: () => null,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { slug: "exp-1" },
    pathname: "",
    replace: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "proj" },
  }),
}));

vi.mock("~/experiments-v3/hooks/useEvaluationsV3Store", () => ({
  useEvaluationsV3Store: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        name: "My Experiment",
        setName: vi.fn(),
        datasets: [],
        targets: [],
        reset: vi.fn(),
        ui: {
          autosaveStatus: {
            evaluation: "idle",
            dataset: "idle",
            evaluationError: null,
            datasetError: null,
          },
        },
      }),
    { getState: () => ({ applyWorkbenchAction: vi.fn() }) },
  ),
}));

vi.mock("~/experiments-v3/hooks/useAutosaveEvaluationsV3", () => ({
  useAutosaveEvaluationsV3: () => ({
    isLoading: false,
    isNotFound: false,
    isError: false,
    error: null,
    reset: vi.fn(),
    saveNow,
  }),
}));

vi.mock("~/experiments-v3/hooks/useExecuteEvaluation", () => ({
  useExecuteEvaluation: () => ({
    execute: executeEvaluation,
    // The page reports the run's progress to the Langy panel, so the mock
    // has to answer the same shape the real hook does.
    status: "idle",
    progress: { completed: 0, total: 0 },
  }),
}));

vi.mock("~/experiments-v3/hooks/useSavedDatasetLoader", () => ({
  useSavedDatasetLoader: () => ({ isLoading: false }),
}));

vi.mock("~/experiments-v3/hooks/useTargetName", () => ({
  useTargetNames: () => [],
}));

vi.mock("~/experiments-v3/hooks/useWorkbenchUpdateListener", () => ({
  useWorkbenchUpdateListener: () => ({ stale: undefined, reload: vi.fn() }),
}));

vi.mock("~/experiments-v3/hooks/useLambdaWarmup", () => ({
  useLambdaWarmup: () => undefined,
}));

vi.mock("~/experiments-v3/hooks/useOptimizeWithLangy", () => ({
  useOptimizeWithLangy: () => undefined,
}));

vi.mock("~/features/langy/LangyContext", () => ({
  useRegisterLangyHandlers: () => undefined,
  useRegisterLangyActions: (handlers: LangyUiActionHandlers) => {
    captured.handlers = handlers;
  },
}));

vi.mock("~/experiments-v3/components/EvaluationsV3Table", () => ({
  EvaluationsV3Table: () => null,
}));
vi.mock("~/experiments-v3/components/SavedDatasetLoaders", () => ({
  SavedDatasetLoaders: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    evaluators: {
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    prompts: {
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    dataset: { upsert: { useMutation: () => ({ mutate: vi.fn() }) } },
    datasetRecord: { create: { useMutation: () => ({ mutate: vi.fn() }) } },
  },
}));

import ExperimentsWorkbenchPage from "~/pages/[project]/experiments/workbench/[slug]";

describe("given the page holds an edit the agent has just made", () => {
  afterEach(() => {
    calls.length = 0;
    captured.handlers = undefined;
    vi.clearAllMocks();
  });

  describe("when the agent dispatches workbench.run", () => {
    /** @scenario A run waits for the page's own edits to be saved first */
    it("saves before the run starts", async () => {
      render(<ExperimentsWorkbenchPage />);

      const runAction = captured.handlers?.["workbench.run"];
      expect(runAction).toBeTruthy();

      await runAction!.run({} as never);

      // Order, not counts: a run that starts first writes its results as a
      // newer version and the pending save is refused behind it.
      expect(calls).toEqual(["save", "run"]);
    });

    /** @scenario A run answers with the id of the run it started */
    it("answers with the run id, without waiting for the run", async () => {
      render(<ExperimentsWorkbenchPage />);

      const answer = await captured.handlers?.["workbench.run"]?.run(
        {} as never,
      );

      expect(answer).toEqual({
        runId: "swift-bold-fox",
        status: "running",
      });
    });
  });
});
