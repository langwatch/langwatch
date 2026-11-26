/**
 * A workbench the reader's role cannot change sends no saves or runs the server
 * would refuse, and explains the refusals it gets anyway.
 * @vitest-environment jsdom
 * @see modules/experiment/specs/workbench-view-only-access.feature
 */
import { FetchSSERefusedError } from "@langwatch/browser-host/fetch-sse";
import { defineSlice } from "@langwatch/browser-host/global-store";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { WORKFLOW_HOST_SLICE } from "@langwatch/workflow-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../use-evaluations-v3-store.ts";
import { useWorkbenchAccessRefusal } from "../use-workbench-access.ts";

const AUTOSAVE_DEBOUNCE_MS = 1500;

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  fetchSSE: vi.fn(),
  showErrorToast: vi.fn(),
  toast: vi.fn(),
}));

/** The slice of the experiment client the autosave hook reads, and nothing more. */
type WorkbenchClient = {
  useUtils: () => {
    experiments: {
      getEvaluationsV3BySlug: { invalidate: () => void; reset: () => void; fetch: () => void };
    };
  };
  experiments: WorkbenchProcedures;
};
type WorkbenchProcedures = {
  saveEvaluationsV3: {
    useMutation: () => { mutateAsync: typeof mocks.mutateAsync; isPending: boolean };
  };
  getEvaluationsV3BySlug: { useQuery: () => { data: null; isLoading: boolean } };
};

vi.mock("../../experiment-api.ts", () => ({
  experimentApi: createApiFixture<WorkbenchClient>(
    {
      useUtils: () => ({
        experiments: {
          getEvaluationsV3BySlug: { invalidate: vi.fn(), reset: vi.fn(), fetch: vi.fn() },
        },
      }),
      experiments: createApiFixture<WorkbenchProcedures>(
        {
          saveEvaluationsV3: {
            useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
          },
          getEvaluationsV3BySlug: { useQuery: () => ({ data: null, isLoading: false }) },
        },
        "experimentApi.experiments",
      ),
    },
    "experimentApi",
  ),
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: { slug: "test-slug" }, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "proj" } }),
}));

vi.mock("@langwatch/browser-host/toaster", () => ({ toaster: { create: mocks.toast } }));

vi.mock("@langwatch/browser-host/errors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  showErrorToast: mocks.showErrorToast,
}));

vi.mock("@langwatch/browser-host/fetch-sse", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSSE: mocks.fetchSSE,
}));

vi.mock("@langwatch/experiment-contract", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildExecutionRequest: () => ({ request: { projectId: "project-1" }, executionCells: [] }),
}));

vi.mock("../../../model/posthog-error-capture.ts", () => ({
  captureException: vi.fn(),
  toError: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
}));

import { useAutosaveEvaluationsV3 } from "../use-autosave-evaluations-v3.ts";
import { useExecuteEvaluation } from "../use-execute-evaluation.ts";

/** The workflow host the page reads grants from, publishing exactly these grants. */
const grants = { current: new Set<string>() };
defineSlice<{ hasPermission: (permission: string) => boolean }>({
  name: WORKFLOW_HOST_SLICE,
  create: () => ({ hasPermission: (permission) => grants.current.has(permission) }),
});
const FULL_ACCESS = ["experiments:update", "evaluations:manage"];

/** The tRPC failure a Lite Member's save gets: the handled payload under `data.error`. */
const liteMemberSaveRefusal = () =>
  Object.assign(new Error("lite_member_restricted"), {
    data: {
      code: "UNAUTHORIZED",
      error: { code: "lite_member_restricted", httpStatus: 401, meta: { resource: "experiments" } },
    },
  });

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

let autosave: ReturnType<typeof useAutosaveEvaluationsV3> | null = null;
function AutosaveProbe() {
  autosave = useAutosaveEvaluationsV3();
  return null;
}

let execution: ReturnType<typeof useExecuteEvaluation> | null = null;
function ExecuteProbe() {
  execution = useExecuteEvaluation();
  return null;
}

/** One cell edit, then past the debounce. */
async function editACell(value: string) {
  act(() => {
    useEvaluationsV3Store
      .getState()
      .setCellValue({ datasetId: "test-data", row: 0, columnId: "input", value });
  });
  await act(async () => {
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
  });
}

describe("a workbench the reader's role cannot change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queryClient.clear();
    autosave = null;
    execution = null;
    grants.current = new Set(FULL_ACCESS);
    useWorkbenchAccessRefusal.getState().reset();
    mocks.mutateAsync.mockResolvedValue({ id: "exp-1", slug: "test-slug", version: 2 });
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.setState({ experimentSlug: "test-slug", experimentId: "exp-1" });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given a role that can view experiments but not change them", () => {
    /** @scenario "A view-only workbench does not send my edits to the server" */
    it("keeps an edited cell in the tab without sending a save, even when asked to save now", async () => {
      grants.current = new Set(["evaluations:manage"]);
      renderWithDesignSystem(
        <Wrapper>
          <AutosaveProbe />
        </Wrapper>,
      );

      await editACell("edited");
      let outcome: string | undefined;
      await act(async () => {
        outcome = await autosave?.saveNow();
      });

      expect(mocks.mutateAsync).not.toHaveBeenCalled();
      expect(outcome).toBe("failed");
    });
  });

  describe("given the page offered saving", () => {
    describe("when the server refuses a save for the reader's role", () => {
      /** @scenario "A save the server refuses for my role stops autosave and says why" */
      it("reports the refusal once, turns the page view only, and sends no further save or run", async () => {
        mocks.mutateAsync.mockRejectedValue(liteMemberSaveRefusal());
        renderWithDesignSystem(
          <Wrapper>
            <AutosaveProbe />
            <ExecuteProbe />
          </Wrapper>,
        );

        await editACell("first");

        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
        expect(useWorkbenchAccessRefusal.getState().refused).toBe(true);
        expect(mocks.showErrorToast).toHaveBeenCalledTimes(1);
        const reported = mocks.showErrorToast.mock.calls[0]?.[0] as { error: unknown };
        expect(readHandledError(reported.error)?.code).toBe("lite_member_restricted");
        // A role refusal is not a generic autosave failure.
        expect(mocks.toast).not.toHaveBeenCalled();

        await editACell("second");
        await act(async () => {
          await autosave?.saveNow();
          await execution?.execute({ type: "full" });
        });

        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
        expect(mocks.showErrorToast).toHaveBeenCalledTimes(1);
        expect(mocks.fetchSSE).not.toHaveBeenCalled();
      });

      it("does not send a save that was queued while the refused one was in flight", async () => {
        let refuse: (error: unknown) => void = () => undefined;
        mocks.mutateAsync.mockReturnValueOnce(
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
        );
        renderWithDesignSystem(
          <Wrapper>
            <AutosaveProbe />
          </Wrapper>,
        );

        await editACell("first");
        let outcomes: string[] = [];
        await act(async () => {
          const first = autosave?.saveNow();
          await editACell("second");
          const queued = autosave?.saveNow();
          refuse(liteMemberSaveRefusal());
          outcomes = (await Promise.all([first, queued])).map(String);
        });

        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
        expect(outcomes).toEqual(["failed", "failed"]);
      });

      it("leaves the next visit editable when a refusal from an earlier visit answers late", async () => {
        let refuse: (error: unknown) => void = () => undefined;
        mocks.mutateAsync.mockReturnValueOnce(
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
        );
        renderWithDesignSystem(
          <Wrapper>
            <AutosaveProbe />
          </Wrapper>,
        );

        await editACell("first");
        let first: Promise<unknown> | undefined;
        act(() => {
          first = autosave?.saveNow();
        });
        // The reader leaves and opens the workbench again before the server answers.
        useWorkbenchAccessRefusal.getState().reset();
        await act(async () => {
          refuse(liteMemberSaveRefusal());
          await first;
        });

        expect(useWorkbenchAccessRefusal.getState().refused).toBe(false);
        expect(mocks.showErrorToast).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a role that can view experiments but not run evaluations", () => {
    beforeEach(() => {
      grants.current = new Set(["experiments:update"]);
    });

    describe("when one cell is run", () => {
      /** @scenario "Running part of a view-only workbench explains instead of calling the server" */
      it("sends no run request and says the role can't run evaluations", async () => {
        renderWithDesignSystem(<ExecuteProbe />);

        await act(async () => {
          await execution?.execute({ type: "cell", rowIndex: 0, targetId: "target-1" });
        });

        expect(mocks.fetchSSE).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Your role can't run evaluations", type: "error" }),
        );
        expect(execution?.status).toBe("idle");
      });
    });

    describe("when one evaluator is rerun", () => {
      it("leaves the evaluator's existing result alone", async () => {
        renderWithDesignSystem(<ExecuteProbe />);
        const before = useEvaluationsV3Store.getState().results.evaluatorResults;

        await act(async () => {
          await execution?.rerunEvaluator(0, "target-1", "evaluator-1");
        });

        expect(mocks.fetchSSE).not.toHaveBeenCalled();
        expect(useEvaluationsV3Store.getState().results.evaluatorResults).toEqual(before);
      });
    });
  });

  describe("given the page offered Run", () => {
    describe("when the server refuses the run for the reader's role", () => {
      /** @scenario "A run the server refuses for my role says why" */
      it("reports the refusal through the registry, by its code", async () => {
        mocks.fetchSSE.mockImplementation(
          async ({ onError }: { onError: (error: Error) => void }) => {
            onError(
              new FetchSSERefusedError({
                message: "This feature is not available for your account",
                httpStatus: 401,
                body: { code: "lite_member_restricted", meta: { resource: "evaluations" } },
              }),
            );
          },
        );
        renderWithDesignSystem(<ExecuteProbe />);

        await act(async () => {
          await execution?.execute({ type: "full" });
        });

        expect(mocks.fetchSSE).toHaveBeenCalledTimes(1);
        expect(mocks.showErrorToast).toHaveBeenCalledTimes(1);
        const reported = mocks.showErrorToast.mock.calls[0]?.[0] as { error: unknown };
        expect(readHandledError(reported.error)?.code).toBe("lite_member_restricted");
        expect(execution?.status).toBe("error");
      });
    });
  });
});
