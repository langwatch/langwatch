/**
 * The workbench tells the Langy panel what it is doing.
 * @vitest-environment jsdom
 * @see specs/langy/langy-page-activity-narration.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execution = vi.hoisted(() => ({
  status: "idle" as string,
  progress: { completed: 0, total: 0 },
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({
    query: { slug: "exp-1" },
    pathname: "",
    replace: vi.fn(),
  }),
}));

vi.mock("@langwatch/ui-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "proj" },
  }),
}));

vi.mock("../../../behavior/experiments-v3/use-evaluations-v3-store.ts", () => ({
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

vi.mock("../../../behavior/experiments-v3/use-autosave-evaluations-v3.ts", () => ({
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

vi.mock("../../../behavior/experiments-v3/use-execute-evaluation.ts", () => ({
  useExecuteEvaluation: () => ({
    execute: vi.fn(),
    status: execution.status,
    progress: execution.progress,
  }),
}));

vi.mock("../../../behavior/experiments-v3/use-target-name.ts", () => ({
  useTargetNames: () => [],
}));

vi.mock("../../../behavior/experiments-v3/use-saved-dataset-loader.ts", () => ({
  useSavedDatasetLoader: () => ({ isLoading: false }),
}));

vi.mock("../../../behavior/experiments-v3/use-workbench-update-listener.ts", () => ({
  useWorkbenchUpdateListener: () => ({ stale: undefined, reload: vi.fn() }),
}));

vi.mock("../../../behavior/experiments-v3/use-lambda-warmup.ts", () => ({
  useLambdaWarmup: () => undefined,
}));

vi.mock("../../../behavior/experiments-v3/use-optimize-with-langy.ts", () => ({
  useOptimizeWithLangy: () => undefined,
}));

// Registration is exercised by `run-flushes-pending-save` and
// `stale-page-refuses-agent-actions`; this test only reads `useLangyStore`,
// so the two hooks are stood down and everything else (including the store)
// stays real.
vi.mock("@langwatch/langy-web/surfaces/langy-page-registration", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@langwatch/langy-web/surfaces/langy-page-registration")>();
  return {
    ...actual,
    useRegisterLangyHandlers: () => undefined,
    useRegisterLangyActions: () => undefined,
  };
});

// The page's heavy children read the store and tRPC directly; this test only
// exercises the activity-reporting handover, so they are stubbed out like the
// sibling `RunFlushesPendingSave` workbench test.
vi.mock("../../../ui/sections/experiments-v3/evaluations-v3-table.tsx", () => ({
  EvaluationsV3Table: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/saved-dataset-loaders.tsx", () => ({
  SavedDatasetLoaders: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/history-button.tsx", () => ({
  HistoryButton: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/table-settings-menu.tsx", () => ({
  TableSettingsMenu: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/undo-redo.tsx", () => ({
  UndoRedo: () => null,
}));
vi.mock("../../../ui/sections/experiments-v3/run-evaluation-button.tsx", () => ({
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

vi.mock("@langwatch/workflow-web/surfaces/workflow-api", () => ({
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

import { useLangyStore } from "@langwatch/langy-web/surfaces/langy-store";
import WorkbenchPage from "../workbench.screen.tsx";

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
      render(
        <ChakraProvider value={defaultSystem}>
          <WorkbenchPage />
        </ChakraProvider>,
      );

      expect(reported()).toBeNull();
    });
  });

  describe("when a run is streaming into the page", () => {
    /** @scenario "A run streaming into the page names the column and the progress" */
    it("reports the run and how far along it is", () => {
      execution.status = "running";
      execution.progress = { completed: 12, total: 20 };

      render(
        <ChakraProvider value={defaultSystem}>
          <WorkbenchPage />
        </ChakraProvider>,
      );

      expect(reported()).toContain("12 of 20 cells");
    });
  });

  describe("when the reader leaves the workbench", () => {
    /** @scenario "Leaving the workbench clears what it was reporting" */
    it("stops reporting, so the panel cannot name a run on a page nobody is on", () => {
      execution.status = "running";
      execution.progress = { completed: 5, total: 20 };

      const view = render(
        <ChakraProvider value={defaultSystem}>
          <WorkbenchPage />
        </ChakraProvider>,
      );
      expect(reported()).not.toBeNull();

      view.unmount();

      expect(reported()).toBeNull();
    });
  });
});
