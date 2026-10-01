import { TriggerAction } from "@langwatch/automation-contract";
/**
 * @vitest-environment jsdom
 * The wizard's surface: rail summaries, the review overview, the locked subject on
 * edit, and the two seats of the ceiling advice (ADR-093 §4).
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutomationStore } from "../ui/sections/automation-store.ts";
import { AutomationWizard } from "../ui/sections/automation-wizard.tsx";
import { type AutomationDraft, INITIAL_DRAFT } from "../ui/sections/draft-model.ts";

vi.mock("../../../behavior/automation-session.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

vi.mock("../../../behavior/automation-feedback.ts", () => ({
  useDescribeError:
    () =>
    ({ fallbackTitle }: { fallbackTitle?: string }) =>
      fallbackTitle ?? "Something went wrong",
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

vi.mock("../../../behavior/automation-api.ts", () => ({
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
            graph: { series: [{ name: "p95 latency", key: "latency", aggregation: "p95" }] },
          },
          isLoading: false,
        }),
      },
    },
    dashboards: { getAll: { useQuery: () => ({ data: [], isLoading: false }) } },
    traces: { list: { useQuery: () => server.preview } },
    automation: { getDailyCap: { useQuery: () => server.cap } },
    useUtils: () => ({}),
  },
}));

vi.mock("../ui/blocks/condition-builder.tsx", () => ({
  ConditionBuilder: () => <div data-testid="condition-builder" />,
}));
// A live stand-in: "the filter stays editable" travels through value/onChange.
vi.mock("../ui/elements/query-filter-input.tsx", () => ({
  QueryFilterInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input
      data-testid="query-filter-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

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

const renderWizard = (props: Partial<ComponentProps<typeof AutomationWizard>> = {}) =>
  renderWithDesignSystem(
    <AutomationWizard projectId="project-1" isEdit={false} subjectLocked={false} {...props} />,
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
      // The landing on review is bound on the drawer suite; this pins the content.
      it("shows every section summarised on the review overview", () => {
        useAutomationStore.getState().hydrate(persistDraft);
        useAutomationStore.getState().setStep("review");
        renderWizard({ isEdit: true, subjectLocked: true });

        expect(screen.getByText("Watches")).toBeInTheDocument();
        // The rail and the overview read one summary function.
        expect(screen.getAllByText("Trace filter · status:error").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Delivery").length).toBeGreaterThan(0);
        expect(
          screen.getByRole("button", { name: "Edit what this automation watches" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Edit delivery" })).toBeInTheDocument();
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

        await user.click(screen.getByRole("button", { name: "Edit what this automation watches" }));

        expect(screen.getByRole("button", { name: /A graph/ })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        expect(screen.getByText(/What this automation watches cannot change/)).toBeInTheDocument();
        expect(screen.getByText("Which traces")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Code" }));
        const queryInput = screen.getByTestId("query-filter-input");
        await user.clear(queryInput);
        await user.type(queryInput, "status:ok");
        expect(useAutomationStore.getState().draft.filterQuery).toBe("status:ok");
        // The drawer suite pins that the transition resets the draft.
        const offer = screen.getByRole("button", { name: "New automation" });
        expect(offer).toBeEnabled();
        await user.click(offer);
        expect(onCreateNew).toHaveBeenCalledTimes(1);
        expect(useAutomationStore.getState().draft).toEqual({
          ...persistDraft,
          filterQuery: "status:ok",
        });
      });
    });
  });
});
