/**
 * @vitest-environment jsdom
 *
 * @see specs/experiments-v3/workbench-layout.feature
 *
 * Regression guard: the experiments workbench renders inside DashboardLayout.
 * With the compact menu the rail is a 56px strip whose inner box is
 * position:absolute, zIndex 100, and expands to a 200px overlay on hover (see
 * MainMenu), covering the grid's leftmost columns (row select + first dataset
 * cell). The workbench must request the full in-flow menu, i.e. it must NOT pass
 * compactMenu={true}. We mock DashboardLayout to capture the prop the page hands
 * it and ignore its children, so the heavy grid never mounts.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ compactMenu: undefined as unknown }));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: (props: { compactMenu?: boolean }) => {
    captured.compactMenu = props.compactMenu;
    // Ignore children on purpose: we only assert the menu mode the page picks.
    return null;
  },
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
  useEvaluationsV3Store: (selector: (s: unknown) => unknown) =>
    selector({
      name: "My Experiment",
      setName: vi.fn(),
      datasets: [],
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
}));

vi.mock("~/experiments-v3/hooks/useAutosaveEvaluationsV3", () => ({
  useAutosaveEvaluationsV3: () => ({
    isLoading: false,
    isNotFound: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock("~/experiments-v3/hooks/useSavedDatasetLoader", () => ({
  useSavedDatasetLoader: () => ({ isLoading: false }),
}));

vi.mock("~/experiments-v3/hooks/useLambdaWarmup", () => ({
  useLambdaWarmup: () => undefined,
}));

// The page registers Langy action handlers via useRegisterLangyHandlers, which
// calls useLangy() and requires a <LangyProvider>. We don't render the panel
// here, so stub the hook to a no-op.
vi.mock("~/components/langy/LangyContext", () => ({
  useRegisterLangyHandlers: () => undefined,
}));

// Heavy children are never rendered (DashboardLayout mock drops them), but the
// page still imports their modules; stub the data-bound ones to keep the import
// graph light and free of tRPC / store wiring.
vi.mock("~/experiments-v3/components/EvaluationsV3Table", () => ({
  EvaluationsV3Table: () => null,
}));
vi.mock("~/experiments-v3/components/SavedDatasetLoaders", () => ({
  SavedDatasetLoaders: () => null,
}));

// The page body calls tRPC hooks at the top level (api.*.useMutation +
// api.useContext). DashboardLayout is mocked away, but the page module still
// executes these on render, so stub the api boundary like the sibling
// experiments-v3 workbench tests (see ExecutionControls.integration.test.tsx).
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({}),
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

describe("given the experiments workbench is open", () => {
  afterEach(() => {
    captured.compactMenu = undefined;
    vi.clearAllMocks();
  });

  describe("when the page lays out inside the dashboard", () => {
    /** @scenario "The workbench lays out beside the full navigation menu, not under the compact overlay rail" */
    it("does not request the compact overlay menu", () => {
      render(<ExperimentsWorkbenchPage />);

      expect(captured.compactMenu).not.toBe(true);
    });
  });
});
