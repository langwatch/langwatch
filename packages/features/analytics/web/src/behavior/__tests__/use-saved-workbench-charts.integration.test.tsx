/**
 * @vitest-environment jsdom
 *
 * Which of the two things Save does.
 *
 * The hook holds one piece of state — which chart is open — and that state is
 * the whole difference between a member pressing Save twice and having one
 * chart, or having two and no way to tell which the dashboard is showing. The
 * toolbar suite proves the button says which it will do; this proves the hook
 * then does it.
 *
 * Only the tRPC client is faked, at its module boundary, so the branch under
 * test is the real one.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  utils: {
    analytics: {
      savedWorkbenchCharts: {
        getAll: { invalidate: vi.fn() },
        getById: { fetch: vi.fn() },
      },
    },
  },
}));

vi.mock("../analytics-api", () => ({
  analyticsApi: {
    useUtils: () => mocks.utils,
    analytics: {
      savedWorkbenchCharts: {
        getAll: { useQuery: () => ({ data: [], isLoading: false }) },
        create: { useMutation: () => mocks.create },
        update: { useMutation: () => mocks.update },
        delete: { useMutation: () => mocks.remove },
      },
    },
  },
}));

import { useSavedWorkbenchCharts } from "../use-saved-workbench-charts";

const PROJECT_ID = "proj-1";

const DRAFT = {
  sql: "SELECT count() AS value FROM analytics.traces",
  parameters: { since: "2026-02-01 00:00:00" },
};

const EDITED = {
  sql: "SELECT count() AS value FROM analytics.traces WHERE Model = 'x'",
  parameters: { since: "2026-03-01 00:00:00" },
};

function mountHook() {
  const onError = vi.fn();
  const { result } = renderHook(() =>
    useSavedWorkbenchCharts({
      projectId: PROJECT_ID,
      onOpened: vi.fn(),
      onError,
    }),
  );
  return { result, onError };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mutateAsync.mockResolvedValue({
    id: "chart-1",
    name: "Traces per day",
  });
  mocks.update.mutateAsync.mockResolvedValue({
    id: "chart-1",
    name: "Traces per day",
  });
});

describe("saving a workbench chart", () => {
  describe("given no chart is open", () => {
    describe("when the member saves", () => {
      /** @scenario "Save stores what is on screen, and saves again into the same chart" */
      it("creates one under the name they gave", async () => {
        const { result, onError } = mountHook();

        await act(async () => {
          await result.current.save({ draft: DRAFT, name: "Traces per day" });
        });

        expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          name: "Traces per day",
          definition: {
            version: 1,
            sql: DRAFT.sql,
            parameters: DRAFT.parameters,
          },
        });
        expect(mocks.update.mutateAsync).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.openedChartId).toBe("chart-1");
      });
    });
  });

  describe("given that chart is now the open one", () => {
    describe("when the member edits and saves again", () => {
      /** @scenario "Save stores what is on screen, and saves again into the same chart" */
      it("writes back to it rather than creating a second", async () => {
        const { result } = mountHook();
        await act(async () => {
          await result.current.save({ draft: DRAFT, name: "Traces per day" });
        });
        mocks.create.mutateAsync.mockClear();

        await act(async () => {
          await result.current.save({ draft: EDITED });
        });

        expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          id: "chart-1",
          definition: {
            version: 1,
            sql: EDITED.sql,
            parameters: EDITED.parameters,
          },
        });
        expect(mocks.create.mutateAsync).not.toHaveBeenCalled();
      });
    });

    describe("when the member asks to save it as a new chart", () => {
      /** @scenario "Save as a new chart leaves the one that was open alone" */
      it("creates a second one and works on that from then on", async () => {
        const { result } = mountHook();
        await act(async () => {
          await result.current.save({ draft: DRAFT, name: "Traces per day" });
        });
        mocks.create.mutateAsync.mockClear();
        mocks.create.mutateAsync.mockResolvedValue({
          id: "chart-2",
          name: "Traces per week",
        });

        act(() => result.current.closeOpened());
        await act(async () => {
          await result.current.save({ draft: EDITED, name: "Traces per week" });
        });

        expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          name: "Traces per week",
          definition: {
            version: 1,
            sql: EDITED.sql,
            parameters: EDITED.parameters,
          },
        });
        // Nothing was written to the chart they had open, and Save now means
        // the new one.
        expect(mocks.update.mutateAsync).not.toHaveBeenCalled();
        expect(result.current.openedChartId).toBe("chart-2");
      });
    });
  });

  describe("given the member clicks Save twice before the first write lands", () => {
    describe("when no chart is open yet", () => {
      // `isSaving` cannot cover this: it is React state, so the second click
      // reads its pre-render value and would create a second chart.
      it("creates one chart rather than two", async () => {
        // Every call gets its resolver collected, not just the last: if the
        // guard ever regresses, the second write must still settle so the test
        // fails on the call count rather than hanging for the timeout and
        // taking the rest of the file down with it.
        const pending: ((created: { id: string; name: string }) => void)[] = [];
        mocks.create.mutateAsync.mockImplementation(
          () =>
            new Promise<{ id: string; name: string }>((resolve) => {
              pending.push(resolve);
            }),
        );
        const release = (created: { id: string; name: string }) => {
          for (const resolve of pending.splice(0)) resolve(created);
        };

        const { result, onError } = mountHook();

        await act(async () => {
          const first = result.current.save({
            draft: DRAFT,
            name: "Traces per day",
          });
          const second = result.current.save({
            draft: DRAFT,
            name: "Traces per day",
          });
          release({ id: "chart-1", name: "Traces per day" });
          await Promise.all([first, second]);
        });

        expect(mocks.create.mutateAsync).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
        expect(result.current.openedChartId).toBe("chart-1");
      });
    });
  });

  describe("given the first Save fails outright", () => {
    describe("when the member fixes the problem and saves again", () => {
      // The in-flight guard has to release on the failing path too, or one
      // refused save would leave Save dead for the rest of the session.
      it("lets the second attempt through", async () => {
        mocks.create.mutateAsync.mockRejectedValueOnce(new Error("nope"));

        const { result, onError } = mountHook();

        await act(async () => {
          await result.current.save({ draft: DRAFT, name: "Traces per day" });
        });
        expect(onError).toHaveBeenCalledWith(expect.anything(), "Couldn't save the chart");

        await act(async () => {
          await result.current.save({ draft: DRAFT, name: "Traces per day" });
        });

        expect(mocks.create.mutateAsync).toHaveBeenCalledTimes(2);
        expect(result.current.openedChartId).toBe("chart-1");
      });
    });
  });

  describe("given the write succeeds but refreshing the list then fails", () => {
    describe("when the member saves", () => {
      /**
       * The chart is on the server by this point. Reporting the refresh failure
       * as a failed save sends them back to press Save again — and because the
       * hook now holds the new chart as the open one, the second press writes
       * back rather than duplicating, but the copy they were shown was a lie
       * either way.
       */
      it("does not tell them the save failed", async () => {
        const { result, onError } = mountHook();
        mocks.utils.analytics.savedWorkbenchCharts.getAll.invalidate.mockRejectedValue(
          new Error("network"),
        );

        await act(async () => {
          await result.current.save({ draft: DRAFT, name: "Traces per day" });
        });

        // The write itself happened and the chart is the open one.
        expect(mocks.create.mutateAsync).toHaveBeenCalled();
        expect(result.current.openedChartId).toBe("chart-1");

        // Reported, but as a stale list — never as a lost save.
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]?.[1]).toBe("Saved, but the chart list didn't refresh");
      });
    });

    describe("when the member renames or deletes", () => {
      /**
       * The same shape as the save path, and the same lie: the write is on the
       * server before the refresh is attempted, so a rejected refresh must not
       * be reported as a rename or delete that did not happen.
       */
      it.each([
        [
          "rename",
          "Renamed, but the chart list didn't refresh",
          async (r: ReturnType<typeof mountHook>["result"]) => {
            await r.current.rename({ id: "chart-1", name: "Renamed" });
          },
        ],
        [
          "delete",
          "Deleted, but the chart list didn't refresh",
          async (r: ReturnType<typeof mountHook>["result"]) => {
            await r.current.remove("chart-1");
          },
        ],
      ])("does not report the %s as failed", async (_case, reported, act_) => {
        mocks.remove.mutateAsync.mockResolvedValue({ id: "chart-1" });
        const { result, onError } = mountHook();
        mocks.utils.analytics.savedWorkbenchCharts.getAll.invalidate.mockRejectedValue(
          new Error("network"),
        );

        await act(async () => {
          await act_(result);
        });

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]?.[1]).toBe(reported);
      });
    });
  });
});
