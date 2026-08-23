/**
 * @vitest-environment jsdom
 *
 * A page that cannot save must not tell the agent that it did.
 *
 * Autosave stands down once the server holds a newer version, which is correct:
 * writing then would clobber it. But a browser-executed UI action still applied
 * its change to the store and answered "done", so the agent built every later
 * step on a document only that tab could see. On camera this ran a whole
 * optimization loop into a workbench whose extra columns the server never had.
 *
 * The page refuses instead, with a code the agent can act on: the backend path
 * (`--experiment <slug>`) writes the saved document directly.
 *
 * @see specs/langy/langy-ui-actions.feature
 *   ("A page that cannot save refuses the action instead of reporting success")
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";

const captured = vi.hoisted(() => ({
  handlers: undefined as LangyUiActionHandlers | undefined,
}));

/** Flipped per test: what the store reports about its own staleness. */
const store = vi.hoisted(() => ({
  staleWorkbench: undefined as { serverVersion: number } | undefined,
}));

const applyWorkbenchAction = vi.hoisted(() => vi.fn(() => ({ ok: true })));
const saveNow = vi.hoisted(() => vi.fn(async () => undefined));
const executeEvaluation = vi.hoisted(() => vi.fn());

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
    {
      getState: () => ({
        applyWorkbenchAction,
        staleWorkbench: store.staleWorkbench,
      }),
    },
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
  useExecuteEvaluation: () => ({ execute: executeEvaluation }),
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

const OUT_OF_DATE = "langy_ui_page_out_of_date";

describe("given the server holds a newer version than this page", () => {
  beforeEach(() => {
    store.staleWorkbench = { serverVersion: 42 };
  });

  afterEach(() => {
    captured.handlers = undefined;
    store.staleWorkbench = undefined;
    vi.clearAllMocks();
  });

  describe("when the agent dispatches a transform action", () => {
    /** @scenario "A page that cannot save refuses the action instead of reporting success" */
    it("refuses with a code, and changes nothing", async () => {
      render(<ExperimentsWorkbenchPage />);

      const duplicate = captured.handlers?.["workbench.duplicateTarget"];
      expect(duplicate).toBeTruthy();

      await expect(duplicate!.run({ targetId: "t1" } as never)).rejects.toThrow(
        expect.objectContaining({ code: OUT_OF_DATE }),
      );
      // Refused before the change, so the tab is not left holding an edit it
      // cannot write and the agent was not told about.
      expect(applyWorkbenchAction).not.toHaveBeenCalled();
    });
  });

  describe("when the agent dispatches workbench.run", () => {
    /** @scenario "A page that cannot save does not run the document it holds" */
    it("refuses instead of running a document the server does not have", async () => {
      render(<ExperimentsWorkbenchPage />);

      const runAction = captured.handlers?.["workbench.run"];
      expect(runAction).toBeTruthy();

      await expect(runAction!.run({} as never)).rejects.toThrow(
        expect.objectContaining({ code: OUT_OF_DATE }),
      );
      expect(executeEvaluation).not.toHaveBeenCalled();
    });
  });
});

describe("given a page that is current with the server", () => {
  beforeEach(() => {
    store.staleWorkbench = undefined;
  });

  afterEach(() => {
    captured.handlers = undefined;
    vi.clearAllMocks();
  });

  describe("when the agent dispatches a transform action", () => {
    it("applies it and answers", async () => {
      render(<ExperimentsWorkbenchPage />);

      const duplicate = captured.handlers?.["workbench.duplicateTarget"];
      await expect(
        duplicate!.run({ targetId: "t1" } as never),
      ).resolves.toBeTruthy();
      expect(applyWorkbenchAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the agent dispatches workbench.run", () => {
    it("runs it", async () => {
      render(<ExperimentsWorkbenchPage />);

      await captured.handlers!["workbench.run"]!.run({} as never);
      expect(executeEvaluation).toHaveBeenCalledTimes(1);
    });
  });
});
