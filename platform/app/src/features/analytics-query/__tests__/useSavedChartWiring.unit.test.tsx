/**
 * @vitest-environment jsdom
 *
 * What a save carries when the member never opened the chart tab.
 *
 * Chart mode is loaded on demand and mounts only once a result exists, so the
 * specification reader it registers is simply absent for a member who opens a
 * saved chart, edits the SQL and presses Save. Reading "no reader" as "no
 * specification" writes back a definition without one — which does not leave
 * the stored specification alone, it destroys it.
 *
 * Only the tRPC client and the toaster are faked; the wiring and the saved-chart
 * hook underneath it are real, so what `update` is called with is what would
 * reach the server.
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

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

import type { UseLangWatchQLQuery } from "../hooks/useLangWatchQLQuery";
import { useSavedChartWiring } from "../hooks/useSavedChartWiring";
import type { LangWatchQLParameterValue } from "../logic/lwqlRequestState";

const PROJECT_ID = "proj-1";

const SPEC = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { name: "query_result" },
  mark: "bar",
};

const SAVED_CHART = {
  id: "chart-1",
  name: "Traces per day",
  definition: {
    version: 1,
    sql: "SELECT count() AS value FROM analytics.traces",
    parameters: { since: "2026-02-01 00:00:00" },
    vegaLiteSpec: SPEC,
  },
};

/**
 * A stand-in for the query hook that records what the wiring writes into it,
 * which is how a chart "opens": the wiring pushes the saved SQL and parameters
 * back through the same setters the editor uses.
 */
function fakeQuery(): UseLangWatchQLQuery {
  let draft: {
    readonly sql: string;
    readonly parameters: Readonly<Record<string, LangWatchQLParameterValue>>;
  } = { sql: "", parameters: {} };

  return {
    get state() {
      return {
        draft,
        submitted: null,
        submissionId: 0,
        isInFlight: false,
        outcome: null,
      };
    },
    isStale: false,
    actionLabel: "Run query",
    setSql: (sql) => {
      draft = { ...draft, sql };
    },
    setParameters: (parameters) => {
      draft = { ...draft, parameters };
    },
    setTimeWindow: vi.fn(),
    runQuery: vi.fn(),
    reload: vi.fn(),
    cancelQuery: vi.fn(),
  };
}

function mountWiring() {
  const query = fakeQuery();
  const { result } = renderHook(() =>
    useSavedChartWiring({ projectId: PROJECT_ID, query }),
  );
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.utils.analytics.savedWorkbenchCharts.getById.fetch.mockResolvedValue(SAVED_CHART);
  mocks.update.mutateAsync.mockResolvedValue({
    id: "chart-1",
    name: "Traces per day",
  });
  mocks.create.mutateAsync.mockResolvedValue({
    id: "chart-2",
    name: "Untitled chart",
  });
});

describe("saving a chart that was opened but never charted", () => {
  describe("given the member opened a saved chart and never visited the chart tab", () => {
    describe("when they save", () => {
      /** @scenario "Save stores what is on screen, and saves again into the same chart" */
      it("writes back the specification it was opened with", async () => {
        const { result } = mountWiring();
        await act(async () => {
          await result.current.saved.open("chart-1");
        });

        await act(async () => {
          await result.current.saved.save({
            draft: result.current.currentDraft(),
          });
        });

        expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          id: "chart-1",
          definition: {
            version: 1,
            sql: SAVED_CHART.definition.sql,
            parameters: SAVED_CHART.definition.parameters,
            vegaLiteSpec: SPEC,
          },
        });
      });
    });
  });

  describe("given the chart mode has registered its reader", () => {
    describe("when they save", () => {
      it("writes back what the reader hands over, not the opened copy", async () => {
        const { result } = mountWiring();
        await act(async () => {
          await result.current.saved.open("chart-1");
        });
        const edited = { ...SPEC, mark: "line" };
        act(() => result.current.registerSpecReader(() => edited));

        await act(async () => {
          await result.current.saved.save({
            draft: result.current.currentDraft(),
          });
        });

        expect(mocks.update.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            definition: expect.objectContaining({ vegaLiteSpec: edited }),
          }),
        );
      });
    });
  });

  describe("given the chart mode unmounted after an edit was already saved", () => {
    describe("when they save a second time", () => {
      /** @scenario "Save stores what is on screen, and saves again into the same chart" */
      it("keeps the edit rather than reverting to the opened copy", async () => {
        const { result } = mountWiring();
        await act(async () => {
          await result.current.saved.open("chart-1");
        });

        const edited = { ...SPEC, mark: "line" };
        act(() => result.current.registerSpecReader(() => edited));
        await act(async () => {
          await result.current.saved.save({
            draft: result.current.currentDraft(),
          });
        });

        // Leaving chart mode takes the reader with it. The edit is already
        // stored, so a second Save must not reach back past it.
        act(() => result.current.registerSpecReader(null));
        await act(async () => {
          await result.current.saved.save({
            draft: result.current.currentDraft(),
          });
        });

        expect(mocks.update.mutateAsync).toHaveBeenLastCalledWith(
          expect.objectContaining({
            definition: expect.objectContaining({ vegaLiteSpec: edited }),
          }),
        );
      });

      /** @scenario "Save stores what is on screen, and saves again into the same chart" */
      it("does not carry that edit into a different chart", async () => {
        const { result } = mountWiring();
        await act(async () => {
          await result.current.saved.open("chart-1");
        });
        const edited = { ...SPEC, mark: "line" };
        act(() => result.current.registerSpecReader(() => edited));
        act(() => {
          result.current.currentDraft();
        });

        // A second chart is opened with no chart mode mounted. Its own stored
        // specification is the only honest answer here.
        act(() => result.current.registerSpecReader(null));
        await act(async () => {
          await result.current.saved.open("chart-1");
        });
        await act(async () => {
          await result.current.saved.save({
            draft: result.current.currentDraft(),
          });
        });

        expect(mocks.update.mutateAsync).toHaveBeenLastCalledWith(
          expect.objectContaining({
            definition: expect.objectContaining({ vegaLiteSpec: SPEC }),
          }),
        );
      });
    });
  });

  describe("given nothing is open", () => {
    describe("when they save a query they have only just written", () => {
      it("saves the query alone, inventing no specification", async () => {
        const { result } = mountWiring();

        await act(async () => {
          await result.current.saved.save({
            draft: result.current.currentDraft(),
            name: "Traces per day",
          });
        });

        expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          name: "Traces per day",
          definition: { version: 1, sql: "", parameters: {} },
        });
      });
    });
  });
});
