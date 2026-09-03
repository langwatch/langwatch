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
 * `stale-page-refuses-agent-actions.integration.test.tsx` covers the transform
 * actions, which persist before they answer. This one covers `workbench.run`,
 * which has nothing of its own to answer with and must flush what is already
 * pending.
 *
 * @see specs/langy/langy-ui-actions.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LangyUiActionHandlers } from "@langwatch/langy-web";

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
  vi.fn(async (_scope?: unknown, options?: { onRunStarted?: (id: string) => void }) => {
    calls.push("run");
    // The real hook names the run from the stream's FIRST FRAME, which lands
    // after the request opens. Naming it in the same tick would let a handler
    // that never awaited the stream look correct here and answer `undefined`
    // against the real one.
    await new Promise((resolve) => setTimeout(resolve, 0));
    options?.onRunStarted?.("swift-bold-fox");
    // The run then keeps streaming. The handler must answer while it does,
    // which is what "without waiting for the run" means.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }),
);

vi.mock("@langwatch/workflow-web/studio-host/next-router", () => ({
  useRouter: () => ({
    query: { slug: "exp-1" },
    pathname: "",
    replace: vi.fn(),
  }),
}));

vi.mock("@langwatch/workflow-web/studio-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "proj" },
  }),
}));

vi.mock("../../../behavior/experiments-v3/use-evaluations-v3-store", () => ({
  useEvaluationsV3Store: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        name: "My Experiment",
        setName: vi.fn(),
        datasets: [],
        targets: [],
        reset: vi.fn(),
        addEvaluator: vi.fn(),
        removeEvaluator: vi.fn(),
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

vi.mock("../../../behavior/experiments-v3/use-autosave-evaluations-v3", () => ({
  useAutosaveEvaluationsV3: () => ({
    isLoading: false,
    isNotFound: false,
    isError: false,
    error: null,
    reset: vi.fn(),
    isDirty: false,
    reloadFromServer: vi.fn(),
    saveNow,
  }),
}));

vi.mock("../../../behavior/experiments-v3/use-execute-evaluation", () => ({
  useExecuteEvaluation: () => ({
    execute: executeEvaluation,
    // The page reports the run's progress to the Langy panel, so the mock
    // has to answer the same shape the real hook does.
    status: "idle",
    progress: { completed: 0, total: 0 },
  }),
}));

vi.mock("../../../behavior/experiments-v3/use-saved-dataset-loader", () => ({
  useSavedDatasetLoader: () => ({ isLoading: false }),
}));

vi.mock("../../../behavior/experiments-v3/use-target-name", () => ({
  useTargetNames: () => [],
}));

vi.mock("../../../behavior/experiments-v3/use-workbench-update-listener", () => ({
  useWorkbenchUpdateListener: () => ({ stale: undefined, reload: vi.fn() }),
}));

vi.mock("../../../behavior/experiments-v3/use-lambda-warmup", () => ({
  useLambdaWarmup: () => undefined,
}));

vi.mock("../../../behavior/experiments-v3/use-optimize-with-langy", () => ({
  useOptimizeWithLangy: () => undefined,
}));

vi.mock("@langwatch/langy-web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/langy-web")>();
  return {
    ...actual,
    useRegisterLangyHandlers: () => undefined,
    useRegisterLangyActions: (handlers: LangyUiActionHandlers) => {
      captured.handlers = handlers;
    },
  };
});

vi.mock("../../../ui/sections/experiments-v3/evaluations-v3-table", () => ({
  EvaluationsV3Table: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/saved-dataset-loaders", () => ({
  SavedDatasetLoaders: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/history-button", () => ({
  HistoryButton: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/table-settings-menu", () => ({
  TableSettingsMenu: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/undo-redo", () => ({
  UndoRedo: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/run-evaluation-button", () => ({
  RunEvaluationButton: () => null,
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

vi.mock("@langwatch/workflow-web/studio-host/api", () => ({
  api: {
    useUtils: () => ({}),
    useQueries: () => [],
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

import ExperimentsWorkbenchPage from "../workbench.screen";

describe("given the page holds an edit the agent has just made", () => {
  afterEach(() => {
    calls.length = 0;
    captured.handlers = undefined;
    vi.clearAllMocks();
  });

  describe("when the agent dispatches workbench.run", () => {
    /** @scenario A run waits for the page's own edits to be saved first */
    it("saves before the run starts", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <ExperimentsWorkbenchPage />
        </ChakraProvider>,
      );

      const runAction = captured.handlers?.["workbench.run"];
      expect(runAction).toBeTruthy();

      await runAction!.run({} as never);

      // Order, not counts: a run that starts first writes its results as a
      // newer version and the pending save is refused behind it.
      expect(calls).toEqual(["save", "run"]);
    });

    /** @scenario A run answers with the id of the run it started */
    it("answers with the run id, without waiting for the run", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <ExperimentsWorkbenchPage />
        </ChakraProvider>,
      );

      const answer = await captured.handlers?.["workbench.run"]?.run({} as never);

      expect(answer).toEqual({
        runId: "swift-bold-fox",
        status: "running",
      });
    });
  });
});
