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
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execution = vi.hoisted(() => ({
  status: "idle" as string,
  progress: { completed: 0, total: 0 },
}));

vi.mock("~/components/DashboardLayout", () => ({
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
    isDirty: false,
    reloadFromServer: vi.fn(),
    saveNow: vi.fn(async () => "saved" as const),
  }),
}));

vi.mock("~/experiments-v3/hooks/useExecuteEvaluation", () => ({
  useExecuteEvaluation: () => ({
    execute: vi.fn(),
    status: execution.status,
    progress: execution.progress,
  }),
}));

vi.mock("~/experiments-v3/hooks/useTargetName", () => ({
  useTargetNames: () => [],
}));

vi.mock("~/experiments-v3/hooks/useSavedDatasetLoader", () => ({
  useSavedDatasetLoader: () => ({ isLoading: false }),
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
  useRegisterLangyActions: () => undefined,
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

import { useLangyStore } from "@langwatch/langy-web";
import WorkbenchPage from "~/pages/[project]/experiments/workbench/[slug]";

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
      render(<WorkbenchPage />);

      expect(reported()).toBeNull();
    });
  });

  describe("when a run is streaming into the page", () => {
    /** @scenario "A run streaming into the page names the column and the progress" */
    it("reports the run and how far along it is", () => {
      execution.status = "running";
      execution.progress = { completed: 12, total: 20 };

      render(<WorkbenchPage />);

      expect(reported()).toContain("12 of 20 cells");
    });
  });

  describe("when the reader leaves the workbench", () => {
    /** @scenario "Leaving the workbench clears what it was reporting" */
    it("stops reporting, so the panel cannot name a run on a page nobody is on", () => {
      execution.status = "running";
      execution.progress = { completed: 5, total: 20 };

      const view = render(<WorkbenchPage />);
      expect(reported()).not.toBeNull();

      view.unmount();

      expect(reported()).toBeNull();
    });
  });
});
