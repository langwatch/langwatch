/**
 * @vitest-environment jsdom
 *
 * specs/automations/source-merge.feature
 * specs/automations/automation-authoring-cap-advice.feature
 *
 * The wizard's own surface: the step rail's summaries, the review overview,
 * the locked subject on edit, and the two seats the ceiling advice moved to
 * when the single drawer became three steps (ADR-093 §4).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { TriggerAction } from "@langwatch/automations/enums";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AutomationDraft,
  INITIAL_DRAFT,
} from "../../../logic/draftReducer";
import { useAutomationStore } from "../../../state/automationStore";
import { AutomationWizard } from "../AutomationWizard";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

/** What the preview and ceiling reads return for the test at hand. */
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
          isError: false,
          refetch: vi.fn(),
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
    useContext: () => ({}),
  },
}));

// Heavy popover / suggestion surfaces; neither is what these tests are about.
vi.mock("~/components/filters/FieldsFilters", () => ({
  FieldsFilters: () => <div data-testid="fields-filters" />,
}));
vi.mock("../../ConditionBuilder", () => ({
  ConditionBuilder: () => <div data-testid="condition-builder" />,
}));
vi.mock("../../QueryFilterInput", () => ({
  // A live stand-in, not an inert div: the suggestion machinery is not what
  // these tests are about, but "the filter stays editable" is — so the stub
  // keeps the value/onChange wiring a real edit travels through.
  QueryFilterInput: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      data-testid="query-filter-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** 7-day totals the preview reports, at a plan ceiling of 100 a day. */
const OVER_CAP_HITS = 7000; // 1,000 a day
const PLAN_CAP = 100;

const persistDraft: AutomationDraft = {
  ...INITIAL_DRAFT,
  name: "Error dataset",
  source: "trace",
  action: TriggerAction.ADD_TO_DATASET,
  filterQuery: "status:error",
};

const renderWizard = (
  props: Partial<React.ComponentProps<typeof AutomationWizard>> = {},
) =>
  render(
    <AutomationWizard
      projectId="project-1"
      isEdit={false}
      subjectLocked={false}
      {...props}
    />,
    { wrapper: Wrapper },
  );

describe("AutomationWizard", () => {
  beforeEach(() => {
    useAutomationStore.getState().reset();
    server.preview = {
      data: { totalHits: OVER_CAP_HITS, items: [] },
      isFetching: false,
      error: null,
    };
    server.cap = { data: { cap: PLAN_CAP } };
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a persist action whose condition is over the plan's ceiling", () => {
    describe("when the author reaches the review step at create", () => {
      /** @scenario "The ceiling advice renders on the review step at create" */
      it("shows the daily-limit advice with both numbers", () => {
        useAutomationStore.getState().hydrate(persistDraft);
        useAutomationStore.getState().setStep("review");
        renderWizard();

        const advice = screen.getByTestId("daily-cap-advice");
        expect(advice).toHaveTextContent("1,000 matches a day");
        expect(advice).toHaveTextContent("daily automation limit of 100");
      });
    });

    describe("when a saved automation is re-opened on the watch step", () => {
      /** @scenario "The ceiling advice renders in the watch step on edit" */
      it("shows the daily-limit advice there, where the saved delivery names the action", () => {
        useAutomationStore.getState().hydrate(persistDraft);
        useAutomationStore.getState().setStep("watch");
        renderWizard({ isEdit: true, subjectLocked: true });

        const advice = screen.getByTestId("daily-cap-advice");
        expect(advice).toHaveTextContent("1,000 matches a day");
        expect(advice).toHaveTextContent("daily automation limit of 100");
      });
    });
  });

  describe("given a saved automation being edited", () => {
    describe("when the wizard opens", () => {
      // The binding for "Editing an automation opens the review overview"
      // lives on the drawer test that lets the drawer choose the step; this
      // one hand-sets it, so it pins the overview's CONTENT, not the landing.
      it("shows every section summarised on the review overview", () => {
        useAutomationStore.getState().hydrate(persistDraft);
        useAutomationStore.getState().setStep("review");
        renderWizard({ isEdit: true, subjectLocked: true });

        expect(screen.getByText("Watches")).toBeInTheDocument();
        // The rail and the overview say the same line about the same step —
        // which is the point of both reading one summary function.
        expect(
          screen.getAllByText("Trace filter · status:error").length,
        ).toBeGreaterThan(0);
        expect(screen.getAllByText("Delivery").length).toBeGreaterThan(0);
        expect(
          screen.getByRole("button", {
            name: "Edit what this automation watches",
          }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Edit delivery" }),
        ).toBeInTheDocument();
      });
    });

    describe("when the author opens the watch section", () => {
      /** @scenario "What a saved automation watches cannot change" */
      it("locks the filter-or-graph choice, keeps the filter editable, and offers a new automation", async () => {
        const onCreateNew = vi.fn();
        const user = userEvent.setup();
        useAutomationStore.getState().hydrate(persistDraft);
        useAutomationStore.getState().setStep("review");
        renderWizard({ isEdit: true, subjectLocked: true, onCreateNew });

        await user.click(
          screen.getByRole("button", {
            name: "Edit what this automation watches",
          }),
        );

        // The choice reads as locked, with the reason in prose rather than
        // only in a tooltip nobody hovers.
        expect(screen.getByRole("button", { name: /A graph/ })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        expect(
          screen.getByText(/What this automation watches cannot change/),
        ).toBeInTheDocument();
        // The filter itself stays editable — proven by editing it, not by
        // the section heading alone: a read-only filter would render the
        // heading just the same.
        expect(screen.getByText("Which traces")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Code" }));
        const queryInput = screen.getByTestId("query-filter-input");
        await user.clear(queryInput);
        await user.type(queryInput, "status:ok");
        expect(useAutomationStore.getState().draft.filterQuery).toBe(
          "status:ok",
        );
        // And the way out is offered — as the create entry point the drawer
        // wires it to. That the transition genuinely resets the draft (rather
        // than carrying this saved automation into the new one) is pinned on
        // the drawer itself, where the store and the hydration latches live:
        // AutomationDrawer.integration.test.tsx, "opens a pristine create
        // instead of carrying the edited draft into it".
        const offer = screen.getByRole("button", { name: "New automation" });
        expect(offer).toBeEnabled();
        await user.click(offer);
        expect(onCreateNew).toHaveBeenCalledTimes(1);
        // The lock is not a dead end: the automation being edited is left
        // exactly as it was by asking for a new one — including the filter
        // edit typed above, which asking for a new automation must not undo.
        expect(useAutomationStore.getState().draft).toEqual({
          ...persistDraft,
          filterQuery: "status:ok",
        });
      });
    });
  });
});
