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
 * @see specs/analytics/governed-sql-saved-charts.feature
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

vi.mock("~/utils/api", () => ({
  api: {
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

import { useSavedWorkbenchCharts } from "../hooks/useSavedWorkbenchCharts";

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
});
