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
 * A save that simply does not land is the same false success by another door.
 * Autosave reports that one on the badge and keeps the edit for its next try,
 * so it resolves normally, and the page used to read that as a write. It
 * refuses under its own code now.
 *
 * @see specs/langy/langy-ui-actions.feature
 *   ("A page that cannot save refuses the action instead of reporting success")
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LangyUiActionHandlers } from "@langwatch/langy-web";

const captured = vi.hoisted(() => ({
  handlers: undefined as LangyUiActionHandlers | undefined,
}));

/** Flipped per test: what the store reports about its own staleness. */
const store = vi.hoisted(() => ({
  staleWorkbench: undefined as { serverVersion: number } | undefined,
  /** What `saveNow` answers, which is what the page has to act on. */
  saveOutcome: "saved" as "saved" | "unchanged" | "refused" | "failed",
}));

const applyWorkbenchAction = vi.hoisted(() => vi.fn(() => ({ ok: true })));
const saveNow = vi.hoisted(() => vi.fn(async () => store.saveOutcome));
// `async`, like the real hook: `useExecuteEvaluation().execute` is an async
// function, so it always answers with a promise, and the run handler settles on
// that promise when the stream names no run. A mock returning undefined would
// leave the handler waiting out its whole id budget.
const executeEvaluation = vi.hoisted(() => vi.fn(async () => undefined));

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
    {
      getState: () => ({
        applyWorkbenchAction,
        staleWorkbench: store.staleWorkbench,
      }),
    },
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

const OUT_OF_DATE = "langy_ui_page_out_of_date";
const SAVE_FAILED = "langy_ui_save_failed";

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
      render(
        <ChakraProvider value={defaultSystem}>
          <ExperimentsWorkbenchPage />
        </ChakraProvider>,
      );

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
      render(
        <ChakraProvider value={defaultSystem}>
          <ExperimentsWorkbenchPage />
        </ChakraProvider>,
      );

      const runAction = captured.handlers?.["workbench.run"];
      expect(runAction).toBeTruthy();

      await expect(runAction!.run({} as never)).rejects.toThrow(
        expect.objectContaining({ code: OUT_OF_DATE }),
      );
      expect(executeEvaluation).not.toHaveBeenCalled();
    });
  });
});

describe("given a page whose save fails for a reason other than a newer version", () => {
  beforeEach(() => {
    store.staleWorkbench = undefined;
    store.saveOutcome = "failed";
  });

  afterEach(() => {
    captured.handlers = undefined;
    store.saveOutcome = "saved";
    vi.clearAllMocks();
  });

  describe("when the agent dispatches a transform action", () => {
    /** @scenario "A save that does not land is refused rather than reported as done" */
    it("refuses with a code instead of answering that the change was saved", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <ExperimentsWorkbenchPage />
        </ChakraProvider>,
      );

      const duplicate = captured.handlers?.["workbench.duplicateTarget"];
      expect(duplicate).toBeTruthy();

      await expect(duplicate!.run({ targetId: "t1" } as never)).rejects.toThrow(
        expect.objectContaining({ code: SAVE_FAILED }),
      );
      // The change is applied first, so the tab keeps it and autosave retries.
      // What must not happen is the agent being told the server has it.
      expect(applyWorkbenchAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the agent dispatches workbench.run", () => {
    /** @scenario "A save that does not land stops the run that would follow it" */
    it("refuses instead of running a document the server does not have", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <ExperimentsWorkbenchPage />
        </ChakraProvider>,
      );

      const runAction = captured.handlers?.["workbench.run"];
      expect(runAction).toBeTruthy();

      await expect(runAction!.run({} as never)).rejects.toThrow(
        expect.objectContaining({ code: SAVE_FAILED }),
      );
      expect(executeEvaluation).not.toHaveBeenCalled();
    });
  });
});

describe("given a page that is current with the server", () => {
  beforeEach(() => {
    store.staleWorkbench = undefined;
    store.saveOutcome = "saved";
  });

  afterEach(() => {
    captured.handlers = undefined;
    vi.clearAllMocks();
  });

  describe("when the agent dispatches a transform action", () => {
    it("applies it and answers", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <ExperimentsWorkbenchPage />
        </ChakraProvider>,
      );

      const duplicate = captured.handlers?.["workbench.duplicateTarget"];
      await expect(
        duplicate!.run({ targetId: "t1" } as never),
      ).resolves.toBeTruthy();
      expect(applyWorkbenchAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the agent dispatches workbench.run", () => {
    it("runs it", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <ExperimentsWorkbenchPage />
        </ChakraProvider>,
      );

      await captured.handlers!["workbench.run"]!.run({} as never);
      expect(executeEvaluation).toHaveBeenCalledTimes(1);
    });
  });
});
