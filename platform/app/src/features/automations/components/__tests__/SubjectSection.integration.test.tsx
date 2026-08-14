/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { TriggerAction } from "@langwatch/automations/enums";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_DRAFT } from "../../logic/draftReducer";
import { useAutomationStore } from "../../state/automationStore";
import { SubjectSection } from "../SubjectSection";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
  }),
}));

/** Spy shared with the failed-load retry test — declared via `vi.hoisted`
 *  since it's referenced inside the (hoisted) `~/utils/api` mock factory. */
const { mockGraphsRefetch } = vi.hoisted(() => ({
  mockGraphsRefetch: vi.fn(),
}));

/** What the subject's mocked queries — the trace preview, the plan-cap
 *  status, and the graph list — return for the test at hand.
 *  `graphs` and `graphsError` are independent — react-query's `isError`
 *  does NOT imply `data` is empty: a background refetch failure leaves the
 *  last good `data` in place, and a test needs to represent that state
 *  without the mock coupling the two together for it. */
const server = vi.hoisted(() => ({
  preview: {
    data: null as { totalHits: number; items: unknown[] } | null,
    isFetching: false,
    error: null as unknown,
  },
  cap: { data: null as { cap: number } | null },
  graphs: [{ id: "graph-1", name: "Latency", trigger: null as unknown }] as
    | Array<{ id: string; name: string; trigger: unknown }>
    | undefined,
  graphsLoading: false,
  graphsError: false,
}));

vi.mock("~/utils/api", () => ({
  api: {
    graphs: {
      getAll: {
        useQuery: () => ({
          data: server.graphs,
          isLoading: server.graphsLoading,
          isError: server.graphsError,
          refetch: mockGraphsRefetch,
        }),
      },
      getById: {
        useQuery: () => ({
          data: {
            id: "graph-1",
            name: "Latency",
            graph: {
              series: [
                { name: "p95 latency", key: "latency", aggregation: "p95" },
              ],
            },
          },
          isLoading: false,
        }),
      },
    },
    dashboards: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    tracesV2: { list: { useQuery: () => server.preview } },
    automation: { getDailyCap: { useQuery: () => server.cap } },
    useUtils: () => ({}),
  },
}));

// Heavy popover/virtualizer surface; the graph path under test never renders it.
vi.mock("~/components/filters/FieldsFilters", () => ({
  FieldsFilters: () => <div data-testid="fields-filters" />,
}));

// The query editors carry the traces-view suggestion engine, which is not what
// the preview and its advice are about.
vi.mock("../ConditionBuilder", () => ({
  ConditionBuilder: () => <div data-testid="condition-builder" />,
}));
vi.mock("../QueryFilterInput", () => ({
  QueryFilterInput: () => <div data-testid="query-filter-input" />,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function selectContainingOption(optionName: RegExp): HTMLSelectElement {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const match = selects.find((select) =>
    within(select)
      .queryAllByRole("option")
      .some((option) => optionName.test(option.textContent ?? "")),
  );
  if (!match) throw new Error(`No select with option ${String(optionName)}`);
  return match;
}

const seedGraphDraft = () =>
  useAutomationStore.getState().hydrate({
    ...INITIAL_DRAFT,
    source: "customGraph",
    customGraphId: "graph-1",
  });

/** A brand-new alert draft — no graph chosen yet (matches `INITIAL_DRAFT`'s
 *  `customGraphId: null`), distinct from `seedGraphDraft`'s already-picked
 *  graph. */
const seedFreshAlertDraft = () =>
  useAutomationStore.getState().hydrate({
    ...INITIAL_DRAFT,
    source: "customGraph",
  });

const seedTraceDraft = (action: TriggerAction) =>
  useAutomationStore.getState().hydrate({
    ...INITIAL_DRAFT,
    source: "trace",
    action,
    filterQuery: "status:error",
  });

/** 7-day totals the preview reports, at a plan ceiling of 100 a day. */
const OVER_CAP_HITS = 7000; // 1,000 a day
const WITHIN_CAP_HITS = 70; // 10 a day
const PLAN_CAP = 100;

const previewReturns = (totalHits: number) => {
  server.preview = {
    data: { totalHits, items: [] },
    isFetching: false,
    error: null,
  };
};

describe("SubjectSection", () => {
  beforeEach(() => {
    useAutomationStore.getState().reset();
    previewReturns(0);
    server.cap = { data: { cap: PLAN_CAP } };
    server.graphs = [{ id: "graph-1", name: "Latency", trigger: null }];
    server.graphsLoading = false;
    server.graphsError = false;
    mockGraphsRefetch.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  describe("given an alert draft", () => {
    it("renders the graph and series pickers", () => {
      seedGraphDraft();
      render(<SubjectSection />, { wrapper: Wrapper });

      expect(selectContainingOption(/select a graph/i)).toBeInTheDocument();
      expect(selectContainingOption(/select a series/i)).toBeInTheDocument();
    });

    describe("when opened prefilled from a graph card", () => {
      it("locks the graph select to the launching graph", () => {
        seedGraphDraft();
        render(<SubjectSection prefilledGraphId="graph-1" />, {
          wrapper: Wrapper,
        });

        expect(selectContainingOption(/select a graph/i)).toBeDisabled();
      });

      it("keeps the series select enabled", () => {
        seedGraphDraft();
        render(<SubjectSection prefilledGraphId="graph-1" />, {
          wrapper: Wrapper,
        });

        expect(selectContainingOption(/select a series/i)).toBeEnabled();
      });
    });

    describe("when a series is chosen", () => {
      it("records it on the draft", async () => {
        const user = userEvent.setup();
        seedGraphDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        await user.selectOptions(
          selectContainingOption(/select a series/i),
          "p95 latency",
        );

        expect(
          useAutomationStore.getState().draft.graphAlert.seriesName.length,
        ).toBeGreaterThan(0);
      });
    });

    describe("when the project has no custom graphs yet", () => {
      /** @scenario "A project with no custom graphs offers to create one" */
      it("explains there is nothing to watch yet and offers to create one", () => {
        server.graphs = [];
        seedFreshAlertDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(
          screen.getByText(/doesn.t have a custom graph yet/i),
        ).toBeInTheDocument();
        const link = screen.getByRole("link", {
          name: /create a custom graph/i,
        });
        expect(link).toHaveAttribute("href", "/proj/analytics/custom");
        // Opens in a new tab so the in-progress alert draft is not lost.
        expect(link).toHaveAttribute("target", "_blank");
      });

      it("does not show a graph or series picker", () => {
        server.graphs = [];
        seedFreshAlertDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(screen.queryAllByRole("combobox")).toHaveLength(0);
      });
    });

    describe("when an existing alert's graph is gone from the project", () => {
      it("keeps the picker with the selection, not the empty state", () => {
        server.graphs = [];
        seedGraphDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(selectContainingOption(/select a graph/i)).toBeInTheDocument();
        expect(
          screen.queryByText(/doesn.t have a custom graph yet/i),
        ).not.toBeInTheDocument();
      });
    });

    describe("when opened prefilled even though the project has no other graphs", () => {
      it("still shows the locked graph picker, not the empty state", () => {
        server.graphs = [];
        seedGraphDraft();
        render(<SubjectSection prefilledGraphId="graph-1" />, {
          wrapper: Wrapper,
        });

        expect(selectContainingOption(/select a graph/i)).toBeInTheDocument();
      });
    });

    describe("when the graph list fails to load with no data ever cached", () => {
      /** @scenario "A failed graph list shows a retry, not the empty-project state" */
      it("shows a load failure, not the no-graphs-yet empty state", () => {
        server.graphsError = true;
        server.graphs = undefined;
        seedFreshAlertDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(
          screen.getByText(/couldn.t be loaded right now/i),
        ).toBeInTheDocument();
        expect(
          screen.queryByText(/doesn.t have a custom graph yet/i),
        ).not.toBeInTheDocument();
      });

      it("does not name the underlying error", () => {
        server.graphsError = true;
        server.graphs = undefined;
        seedFreshAlertDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(screen.queryByText(/upstream|fetch|network/i)).toBeNull();
      });

      it("does not offer to create a graph the project may already have", () => {
        server.graphsError = true;
        server.graphs = undefined;
        seedFreshAlertDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(
          screen.queryByRole("link", { name: /create a custom graph/i }),
        ).not.toBeInTheDocument();
      });

      describe("when the user retries", () => {
        it("re-runs the graph list query", async () => {
          const user = userEvent.setup();
          server.graphsError = true;
          server.graphs = undefined;
          seedFreshAlertDraft();
          render(<SubjectSection />, { wrapper: Wrapper });

          await user.click(screen.getByRole("button", { name: /try again/i }));

          expect(mockGraphsRefetch).toHaveBeenCalledTimes(1);
        });
      });
    });

    describe("when a background refetch fails but a good graph list is still cached", () => {
      // react-query's v4 `error` reducer case sets `status: 'error'`
      // unconditionally while leaving the last good `data` in place — the
      // gap v5 split into isLoadingError/isRefetchError. A reconnect
      // refetch, or another surface invalidating `graphs.getAll` (the B3
      // fix does this after a graph create/update), can land here with a
      // populated, already-selected picker still on screen.
      it("keeps showing the working picker with the selection intact, not the failure screen", () => {
        server.graphsError = true; // data stays server.graphs's beforeEach default (non-empty)
        seedGraphDraft(); // customGraphId: "graph-1" — already selected
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(
          screen.queryByText(/couldn.t be loaded right now/i),
        ).not.toBeInTheDocument();
        const graphSelect = selectContainingOption(/select a graph/i);
        expect(graphSelect).toBeInTheDocument();
        expect(graphSelect).toHaveValue("graph-1");
      });
    });

    describe("given the graph list is still loading", () => {
      it("shows neither the empty state nor the picker's missing-graph error", () => {
        server.graphsLoading = true;
        seedFreshAlertDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(
          screen.queryByText(/doesn.t have a custom graph yet/i),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText("Pick a custom graph to continue."),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given a trace draft whose condition matches more than the plan allows", () => {
    describe("when the action writes a record per match", () => {
      /** @scenario "An over-ceiling condition on a persist action shows the advice" */
      it("warns that the condition is over the daily limit", () => {
        seedTraceDraft(TriggerAction.ADD_TO_DATASET);
        previewReturns(OVER_CAP_HITS);
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(screen.getByTestId("daily-cap-advice")).toHaveTextContent(
          "About 1,000 matches a day is over your plan's daily automation " +
            "limit of 100. Matches past the limit are skipped for the rest " +
            "of the day. Narrow the condition so it selects fewer traces.",
        );
      });

      it("warns for the annotation-queue action too", () => {
        seedTraceDraft(TriggerAction.ADD_TO_ANNOTATION_QUEUE);
        previewReturns(OVER_CAP_HITS);
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(screen.getByTestId("daily-cap-advice")).toBeInTheDocument();
      });

      /** @scenario "The advice offers a way out that is not narrowing" */
      it("links to the plans page, since a bigger plan is the other way out", () => {
        seedTraceDraft(TriggerAction.ADD_TO_DATASET);
        previewReturns(OVER_CAP_HITS);
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(screen.getByTestId("daily-cap-advice-upgrade")).toHaveAttribute(
          "href",
          "/settings/plans",
        );
      });
    });

    describe("when the action only notifies", () => {
      /** @scenario "A notify action shows nothing even over the ceiling" */
      it("says nothing about the daily limit", () => {
        seedTraceDraft(TriggerAction.SEND_SLACK_MESSAGE);
        previewReturns(OVER_CAP_HITS);
        render(<SubjectSection />, { wrapper: Wrapper });

        expect(screen.queryByTestId("daily-cap-advice")).toBeNull();
      });
    });

    describe("when the plan ceiling cannot be read", () => {
      /** @scenario "A failed ceiling read shows nothing and never blocks saving" */
      it("says nothing and leaves the draft alone", () => {
        seedTraceDraft(TriggerAction.ADD_TO_DATASET);
        previewReturns(OVER_CAP_HITS);
        server.cap = { data: null };
        const before = useAutomationStore.getState().draft;

        render(<SubjectSection />, { wrapper: Wrapper });

        expect(screen.queryByTestId("daily-cap-advice")).toBeNull();
        expect(useAutomationStore.getState().draft).toBe(before);
      });
    });
  });

  describe("given a trace draft whose condition matches less than the plan allows", () => {
    /** @scenario "A condition within the ceiling renders no warning in the drawer" */
    it("says nothing about the daily limit", () => {
      seedTraceDraft(TriggerAction.ADD_TO_DATASET);
      previewReturns(WITHIN_CAP_HITS);
      render(<SubjectSection />, { wrapper: Wrapper });

      // The preview itself rendered, so the absent advice is a decision.
      expect(screen.getByText(String(WITHIN_CAP_HITS))).toBeInTheDocument();
      expect(screen.queryByTestId("daily-cap-advice")).toBeNull();
    });
  });

  describe("given the condition preview failed", () => {
    /** @scenario "A failed preview shows nothing and never blocks saving" */
    it("says nothing and leaves the draft alone", () => {
      seedTraceDraft(TriggerAction.ADD_TO_DATASET);
      server.preview = {
        data: null,
        isFetching: false,
        error: new Error("upstream unavailable"),
      };
      const before = useAutomationStore.getState().draft;

      render(<SubjectSection />, { wrapper: Wrapper });

      expect(screen.queryByTestId("daily-cap-advice")).toBeNull();
      expect(useAutomationStore.getState().draft).toBe(before);
    });
  });
});
