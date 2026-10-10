/**
 * The workbench tells the Langy panel what it is doing.
 * @vitest-environment jsdom
 * @see specs/langy/langy-page-activity-narration.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execution = vi.hoisted(() => ({
  status: "idle" as string,
  progress: { completed: 0, total: 0 },
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    query: { slug: "exp-1" },
    pathname: "",
    replace: vi.fn(),
  }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "proj" },
  }),
}));

vi.mock("../../../../behavior/experiments-v3/use-evaluations-v3-store.ts", () => ({
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

vi.mock("../../../../behavior/experiments-v3/use-autosave-evaluations-v3.ts", () => ({
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

vi.mock("../../../../behavior/experiments-v3/use-execute-evaluation.ts", () => ({
  useExecuteEvaluation: () => ({
    execute: vi.fn(),
    status: execution.status,
    progress: execution.progress,
  }),
}));

vi.mock("../../../../behavior/experiments-v3/use-target-name.ts", () => ({
  useTargetNames: () => [],
}));

vi.mock("../../../../behavior/experiments-v3/use-saved-dataset-loader.ts", () => ({
  useSavedDatasetLoader: () => ({ isLoading: false }),
}));

vi.mock("../../../../behavior/experiments-v3/use-workbench-update-listener.ts", () => ({
  useWorkbenchUpdateListener: () => ({ stale: undefined, reload: vi.fn() }),
}));

vi.mock("../../../../behavior/experiments-v3/use-lambda-warmup.ts", () => ({
  useLambdaWarmup: () => undefined,
}));

vi.mock("../../../../behavior/experiments-v3/use-optimize-with-langy.ts", () => ({
  useOptimizeWithLangy: () => undefined,
}));

// Registration is exercised by `run-flushes-pending-save` and
// `stale-page-refuses-agent-actions`; this test only reads `useLangyStore`,
// so the two hooks are stood down and everything else (including the store)
// stays real.
vi.mock("../../langy/langy-page-context.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof langyPageRegistrationModule>();
  return {
    ...actual,
    useRegisterLangyHandlers: () => undefined,
    useRegisterLangyActions: () => undefined,
  };
});

// The page's heavy children read the store and tRPC directly; this test only
// exercises the activity-reporting handover, so they are stubbed out like the
// sibling `RunFlushesPendingSave` workbench test.
vi.mock("../../../../ui/sections/experiments-v3/evaluations-v3-table.tsx", () => ({
  EvaluationsV3Table: () => null,
}));
vi.mock("../../../../ui/sections/experiments-v3/saved-dataset-loaders.tsx", () => ({
  SavedDatasetLoaders: () => null,
}));
vi.mock("../../../../ui/sections/experiments-v3/history-button.tsx", () => ({
  HistoryButton: () => null,
}));
vi.mock("../../../../ui/sections/experiments-v3/table-settings-menu.tsx", () => ({
  TableSettingsMenu: () => null,
}));
vi.mock("../../../../ui/sections/experiments-v3/undo-redo.tsx", () => ({
  UndoRedo: () => null,
}));
vi.mock("../../../../ui/sections/experiments-v3/run-evaluation-button.tsx", () => ({
  RunEvaluationButton: () => null,
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

vi.mock("../../../../behavior/experiment-api.ts", () => ({
  experimentApi: {
    useUtils: () => ({}),
    useQueries: () => [],
  },
}));
vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: {
    useUtils: () => ({}),
    evaluators: {
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    useUtils: () => ({}),
    prompts: {
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({}),
    dataset: { upsert: { useMutation: () => ({ mutate: vi.fn() }) } },
    datasetRecord: { create: { useMutation: () => ({ mutate: vi.fn() }) } },
  },
}));

import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_SURFACE,
  LANGY_STORE_SLICE,
  type LangySliceSurface,
} from "@langwatch/langy-contract";

// Stands in for Langy, the owner of the slice, which this package only reads.
const langy = defineSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  create: (set) => ({
    ...LANGY_ABSENT_SURFACE,
    setPageActivity: (pageActivity) => set({ pageActivity }),
  }),
});
import type * as langyPageRegistrationModule from "../../langy/langy-page-context.tsx";
import WorkbenchPage from "../workbench.screen.tsx";

const reported = () => langy.getState().pageActivity;

beforeEach(() => {
  execution.status = "idle";
  execution.progress = { completed: 0, total: 0 };
  langy.getState().setPageActivity(null);
});

afterEach(() => {
  langy.getState().setPageActivity(null);
  vi.clearAllMocks();
});

describe("given the workbench is open", () => {
  describe("when nothing is running", () => {
    it("reports nothing, leaving the line to the turn", () => {
      renderWithDesignSystem(<WorkbenchPage />);

      expect(reported()).toBeNull();
    });
  });

  describe("when a run is streaming into the page", () => {
    /** @scenario "A run streaming into the page names the column and the progress" */
    it("reports the run and how far along it is", () => {
      execution.status = "running";
      execution.progress = { completed: 12, total: 20 };

      renderWithDesignSystem(<WorkbenchPage />);

      expect(reported()).toContain("12 of 20 cells");
    });
  });

  describe("when the reader leaves the workbench", () => {
    /** @scenario "Leaving the workbench clears what it was reporting" */
    it("stops reporting, so the panel cannot name a run on a page nobody is on", () => {
      execution.status = "running";
      execution.progress = { completed: 5, total: 20 };

      const view = renderWithDesignSystem(<WorkbenchPage />);
      expect(reported()).not.toBeNull();

      view.unmount();

      expect(reported()).toBeNull();
    });
  });
});
