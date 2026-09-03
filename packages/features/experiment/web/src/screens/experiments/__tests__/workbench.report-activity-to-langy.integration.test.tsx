/**
 * @vitest-environment jsdom
 *
 * The workbench tells the Langy panel what it is doing.
 *
 * The panel's status line may only say things that are true when it says
 * them, so with no tool running and no tokens arriving it falls back to a verb
 * that claims nothing. Filming the optimization loop is what made the cost
 * plain: minutes of "Cooking…" over a page that was running a column the
 * whole time, because nothing carried the page's own progress the few feet to
 * the panel.
 *
 * What matters here is the handover, not the words: the page writes what it is
 * doing, and stops writing when it stops doing it.
 *
 * @see specs/langy/langy-page-activity-narration.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execution = vi.hoisted(() => ({
  status: "idle" as string,
  progress: { completed: 0, total: 0 },
}));

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
    saveNow: vi.fn(async () => "saved" as const),
  }),
}));

vi.mock("../../../behavior/experiments-v3/use-execute-evaluation", () => ({
  useExecuteEvaluation: () => ({
    execute: vi.fn(),
    status: execution.status,
    progress: execution.progress,
  }),
}));

vi.mock("../../../behavior/experiments-v3/use-target-name", () => ({
  useTargetNames: () => [],
}));

vi.mock("../../../behavior/experiments-v3/use-saved-dataset-loader", () => ({
  useSavedDatasetLoader: () => ({ isLoading: false }),
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

// The page's heavy children read the store and tRPC directly; this test only
// exercises the activity-reporting handover, so they are stubbed out like the
// sibling `RunFlushesPendingSave` workbench test.
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

import { useLangyStore } from "@langwatch/langy-web";
import WorkbenchPage from "../workbench.screen";

const reported = () => useLangyStore.getState().pageActivity;

beforeEach(() => {
  execution.status = "idle";
  execution.progress = { completed: 0, total: 0 };
  useLangyStore.getState().setPageActivity(null);
});

afterEach(() => {
  useLangyStore.getState().setPageActivity(null);
  vi.clearAllMocks();
});

describe("given the workbench is open", () => {
  describe("when nothing is running", () => {
    it("reports nothing, leaving the line to the turn", () => {
      render(<ChakraProvider value={defaultSystem}><WorkbenchPage /></ChakraProvider>);

      expect(reported()).toBeNull();
    });
  });

  describe("when a run is streaming into the page", () => {
    /** @scenario "A run streaming into the page names the column and the progress" */
    it("reports the run and how far along it is", () => {
      execution.status = "running";
      execution.progress = { completed: 12, total: 20 };

      render(<ChakraProvider value={defaultSystem}><WorkbenchPage /></ChakraProvider>);

      expect(reported()).toContain("12 of 20 cells");
    });
  });

  describe("when the reader leaves the workbench", () => {
    /** @scenario "Leaving the workbench clears what it was reporting" */
    it("stops reporting, so the panel cannot name a run on a page nobody is on", () => {
      execution.status = "running";
      execution.progress = { completed: 5, total: 20 };

      const view = render(<ChakraProvider value={defaultSystem}><WorkbenchPage /></ChakraProvider>);
      expect(reported()).not.toBeNull();

      view.unmount();

      expect(reported()).toBeNull();
    });
  });
});
