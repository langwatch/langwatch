/**
 * @vitest-environment jsdom
 *
 * Integration test for issue #3363 (founder follow-up on PR #3983).
 *
 * Pins the founder-requested compromise: after a successful quick-run with no
 * skipped archived items, useRunSuite's success toast must carry an opt-in
 * "View run" action whose onClick delegates to the onViewRun option (with the
 * scheduled suite id). The hook itself does NOT navigate — it hands the suite
 * id back to the consumer, preserving the no-auto-navigate thesis.
 *
 * The success path is driven by capturing api.suites.run.useMutation's
 * onSuccess handler and invoking it with a fake successful result, rather than
 * running a full tRPC mutation cycle.
 *
 * @see specs/features/suites/quick-run-stay-in-place.feature (AC8)
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted captures + spies — declared before any import touches the module
// ---------------------------------------------------------------------------

/**
 * Capture the onSuccess handler registered by useRunSuite on
 * api.suites.run.useMutation so the test can invoke it with a fake result.
 */
const capturedRunOnSuccess = vi.hoisted(
  () =>
    ({
      current: null,
    }) as {
      current:
        | ((
            result: any,
            variables: { id: string; batchRunId?: string },
          ) => void)
        | null;
    },
);

/** Spy on toaster.create so we can assert on the toast config (incl. action). */
const mockToasterCreate = vi.hoisted(() => vi.fn());

const mockOpenDrawer = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
      },
    }),
    suites: {
      run: {
        useMutation: (opts: {
          onSuccess?: (result: any, variables: any) => void;
          onError?: (err: any, variables: any) => void;
        }) => {
          capturedRunOnSuccess.current = opts.onSuccess ?? null;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
    scenarios: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
  },
}));

// The hook imports toaster from "../ui/toaster" -> ~/components/ui/toaster.
vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: (args: unknown) => mockToasterCreate(args),
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "test-project" },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mirrors the hook's success result shape (suite.router run -> service.run). */
const successResult = {
  scheduled: true,
  jobCount: 1,
  batchRunId: "batch_x",
  skippedArchived: undefined,
};

async function renderUseRunSuite(options?: {
  onViewRun?: (suiteId: string) => void;
}) {
  const { useRunSuite } = await import("~/components/suites/useRunSuite");
  return renderHook(() => useRunSuite(options));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRunSuite View run toast action (#3363 founder follow-up)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedRunOnSuccess.current = null;
  });

  describe("given an onViewRun option is provided", () => {
    describe("when a run is scheduled with no archived items skipped", () => {
      it("shows a success toast carrying a View run action", async () => {
        await renderUseRunSuite({ onViewRun: vi.fn() });

        expect(capturedRunOnSuccess.current).not.toBeNull();
        capturedRunOnSuccess.current!(successResult, { id: "suite_target" });

        expect(mockToasterCreate).toHaveBeenCalled();
        const [toastArg] = mockToasterCreate.mock.calls[0]!;
        expect(toastArg).toMatchObject({
          type: "success",
          action: expect.objectContaining({ label: "View run" }),
        });
      });

      it("delegates the View run action to onViewRun with the scheduled suite id", async () => {
        const onViewRun = vi.fn();
        await renderUseRunSuite({ onViewRun });

        expect(capturedRunOnSuccess.current).not.toBeNull();
        capturedRunOnSuccess.current!(successResult, { id: "suite_target" });

        const [toastArg] = mockToasterCreate.mock.calls[0]!;
        // Invoke the action wired onto the toast.
        toastArg.action.onClick();

        expect(onViewRun).toHaveBeenCalledWith("suite_target");
      });
    });
  });

  describe("given no onViewRun option is provided", () => {
    describe("when a run is scheduled with no archived items skipped", () => {
      it("shows a success toast with no action", async () => {
        await renderUseRunSuite();

        expect(capturedRunOnSuccess.current).not.toBeNull();
        capturedRunOnSuccess.current!(successResult, { id: "suite_target" });

        expect(mockToasterCreate).toHaveBeenCalled();
        const [toastArg] = mockToasterCreate.mock.calls[0]!;
        expect(toastArg.type).toBe("success");
        expect(toastArg.action).toBeUndefined();
      });
    });
  });
});
