/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { TriggerAction } from "@langwatch/automation-contract";
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

/** What the two trace-preview queries return for the test at hand. */
const server = vi.hoisted(() => ({
  preview: {
    data: null as { totalHits: number; items: unknown[] } | null,
    isFetching: false,
    error: null as unknown,
  },
  cap: { data: null as { cap: number } | null },
}));

vi.mock("~/utils/api", () => ({
  api: {
    graphs: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "graph-1", name: "Latency", trigger: null }],
          isLoading: false,
        }),
      },
      getById: {
        useQuery: () => ({
          data: {
            id: "graph-1",
            name: "Latency",
            graph: {
              series: [{ name: "p95 latency", key: "latency", aggregation: "p95" }],
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
