/**
 * A workbench the reader's role cannot change sends no saves or runs the server
 * would refuse, and explains the refusals it gets anyway.
 * @vitest-environment jsdom
 * @see modules/experiment/specs/workbench-view-only-access.feature
 */
import { FetchSSERefusedError } from "@langwatch/browser-host/fetch-sse";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../use-evaluations-v3-store.ts";

const AUTOSAVE_DEBOUNCE_MS = 1500;

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  fetchSSE: vi.fn(),
  showErrorToast: vi.fn(),
  toast: vi.fn(),
  access: { maySave: true, mayRun: true },
}));

vi.mock("../../experiment-api.ts", () => ({
  experimentApi: {
    useUtils: () => ({
      experiments: {
        getEvaluationsV3BySlug: { invalidate: vi.fn(), reset: vi.fn(), fetch: vi.fn() },
      },
    }),
    experiments: {
      saveEvaluationsV3: {
        useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
      },
      getEvaluationsV3BySlug: { useQuery: () => ({ data: null, isLoading: false }) },
    },
  },
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

vi.mock("../use-workbench-access.ts", () => ({
  useWorkbenchAccess: () => mocks.access,
  readWorkbenchAccess: () => mocks.access,
}));

vi.mock("../../../model/posthog-error-capture.ts", () => ({
  captureException: vi.fn(),
  toError: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
}));

import { useAutosaveEvaluationsV3 } from "../use-autosave-evaluations-v3.ts";
import { useExecuteEvaluation } from "../use-execute-evaluation.ts";

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
function AutosaveProbe({ maySave }: { maySave: boolean }) {
  autosave = useAutosaveEvaluationsV3({ maySave });
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
    mocks.access = { maySave: true, mayRun: true };
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
    it("keeps an edited cell in the tab without sending a save", async () => {
      renderWithDesignSystem(
        <Wrapper>
          <AutosaveProbe maySave={false} />
        </Wrapper>,
      );

      await editACell("edited");

      expect(mocks.mutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("given the page offered saving", () => {
    describe("when the server refuses a save for the reader's role", () => {
      /** @scenario "A save the server refuses for my role stops autosave and says why" */
      it("reports the refusal once, turns the page view only, and sends no further save", async () => {
        mocks.mutateAsync.mockRejectedValue(liteMemberSaveRefusal());
        renderWithDesignSystem(
          <Wrapper>
            <AutosaveProbe maySave={true} />
          </Wrapper>,
        );

        await editACell("first");

        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
        expect(autosave?.accessRefused).toBe(true);
        expect(mocks.showErrorToast).toHaveBeenCalledTimes(1);
        const reported = mocks.showErrorToast.mock.calls[0]?.[0] as { error: unknown };
        expect(readHandledError(reported.error)?.code).toBe("lite_member_restricted");
        // A role refusal is not a generic autosave failure.
        expect(mocks.toast).not.toHaveBeenCalled();

        await editACell("second");

        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a role that can view experiments but not run evaluations", () => {
    describe("when one cell is run", () => {
      /** @scenario "Running part of a view-only workbench explains instead of calling the server" */
      it("sends no run request and says the role can't run evaluations", async () => {
        mocks.access = { maySave: false, mayRun: false };
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
