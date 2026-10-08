/**
 * @vitest-environment jsdom
 *
 * @see specs/evaluations/experiments-online-evaluations-separation.feature
 * @see specs/evaluations/category-evaluator-performance.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("~/utils/compat/next-link");

import {
  type OnlineEvaluationRow,
  OnlineEvaluationsTable,
} from "../OnlineEvaluationsTable";

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="current-location">
      {location.pathname}
      {location.search}
    </output>
  );
};

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
    <LocationProbe />
  </MemoryRouter>
);

const rows: OnlineEvaluationRow[] = [
  {
    id: "monitor-up",
    name: "Answer quality",
    checkType: "langevals/llm_score",
    enabled: true,
    executionMode: "ON_MESSAGE",
    performance: {
      metric: "score",
      points: [0.68, 0.72, 0.75, 0.8, 0.86],
      current: 0.86,
      previous: 0.74,
    },
  },
  {
    id: "monitor-down",
    name: "Safety policy",
    checkType: "langevals/llm_boolean",
    enabled: true,
    executionMode: "AS_GUARDRAIL",
    performance: {
      metric: "pass_rate",
      points: [0.96, 0.94, 0.91, 0.88],
      current: 0.88,
      previous: 0.94,
    },
  },
  {
    id: "monitor-empty",
    name: "New evaluator",
    checkType: "langevals/llm_score",
    enabled: false,
    executionMode: "ON_MESSAGE",
    performance: {
      metric: "score",
      points: [],
      current: null,
      previous: null,
    },
  },
];

const categoryRow: OnlineEvaluationRow = {
  id: "monitor-category",
  name: "Conversation outcome",
  checkType: "langevals/llm_category",
  enabled: true,
  executionMode: "ON_MESSAGE",
  performance: {
    metric: "label",
    labels: [
      { label: "resolved", count: 60, share: 0.6 },
      { label: "escalated", count: 25, share: 0.25 },
      { label: "abandoned", count: 15, share: 0.15 },
    ],
    current: 0.6,
    previous: 0.48,
  },
};

const defaultProps = {
  projectSlug: "demo",
  rows,
  canManage: true,
  canViewAnalytics: true,
  onEdit: vi.fn(),
  onReplicate: vi.fn(),
  onToggle: vi.fn(),
  onDelete: vi.fn(),
};

describe("<OnlineEvaluationsTable />", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** @scenario Scan online evaluation performance in the configuration table */
  it("shows real score trends and an explicit no-data state", () => {
    render(<OnlineEvaluationsTable {...defaultProps} />, { wrapper: Wrapper });

    expect(screen.getByText("Answer quality")).toBeInTheDocument();
    expect(screen.getByText("Safety policy")).toBeInTheDocument();
    expect(screen.getByText("Guardrail")).toBeInTheDocument();
    expect(screen.getByText("0.86")).toBeInTheDocument();
    expect(screen.getByText("↑ 0.12")).toHaveAttribute("data-trend", "up");
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByText("↓ 6 pp")).toHaveAttribute("data-trend", "down");
    expect(screen.getByText("No data yet")).toHaveAttribute(
      "data-trend",
      "neutral",
    );
    expect(
      screen.getByRole("img", { name: "Performance trend for Answer quality" }),
    ).toBeInTheDocument();
  });

  /** @scenario Open analytics for one online evaluation */
  it("links both the performance preview and row menu to filtered analytics", async () => {
    const user = userEvent.setup();
    render(<OnlineEvaluationsTable {...defaultProps} />, { wrapper: Wrapper });

    const analyticsHref = "/demo/analytics/evaluations?evaluationId=monitor-up";
    expect(
      screen.getByRole("link", {
        name: "View analytics for Answer quality",
      }),
    ).toHaveAttribute("href", analyticsHref);

    await user.click(
      screen.getByRole("button", { name: "Actions for Answer quality" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "View analytics" }),
    ).toHaveAttribute("href", analyticsHref);
  });

  it("navigates to analytics without reloading the application shell", async () => {
    const user = userEvent.setup();
    render(<OnlineEvaluationsTable {...defaultProps} />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("link", {
        name: "View analytics for Answer quality",
      }),
    );

    expect(screen.getByTestId("current-location")).toHaveTextContent(
      "/demo/analytics/evaluations?evaluationId=monitor-up",
    );
  });

  it("keeps configuration actions available from the row menu", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<OnlineEvaluationsTable {...defaultProps} onEdit={onEdit} />, {
      wrapper: Wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "Actions for Safety policy" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    expect(onEdit).toHaveBeenCalledWith("monitor-down");
  });

  /** @scenario A viewer without analytics access does not wait forever */
  it("shows a stable permission state without an empty action menu", () => {
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        canManage={false}
        canViewAnalytics={false}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getAllByText("Analytics access required")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Actions for Answer quality" }),
    ).not.toBeInTheDocument();
  });

  it("shows an explicit state when performance analytics cannot load", () => {
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        rows={[
          { ...rows[0]!, performance: undefined, hasPerformanceError: true },
        ]}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Performance unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  describe("when a monitor classifies instead of scoring", () => {
    /** @scenario "The row shows the labels instead of an empty state" */
    it("shows the label distribution and the leading label", () => {
      render(
        <OnlineEvaluationsTable {...defaultProps} rows={[categoryRow]} />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("group", {
          name: "Label distribution for Conversation outcome",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText("resolved")).toBeInTheDocument();
      expect(screen.getByText("60%, ↑ 12 pp")).toHaveAttribute(
        "data-trend",
        "up",
      );
      expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
    });

    /** @scenario "The distribution names every label it drew" */
    it("names every label with its share", () => {
      render(
        <OnlineEvaluationsTable {...defaultProps} rows={[categoryRow]} />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("img", { name: "resolved, 60%" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "escalated, 25%" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "abandoned, 15%" }),
      ).toBeInTheDocument();
    });

    it("says how much of the period the leading label held when there is nothing to compare", () => {
      render(
        <OnlineEvaluationsTable
          {...defaultProps}
          rows={[
            {
              ...categoryRow,
              performance: {
                metric: "label",
                labels: [{ label: "resolved", count: 3, share: 1 }],
                current: 1,
                previous: null,
              },
            },
          ]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("100% of results")).toBeInTheDocument();
    });

    /** @scenario "A row with no results still says there is no data" */
    it("still says there is no data when the classifier produced none", () => {
      render(
        <OnlineEvaluationsTable
          {...defaultProps}
          rows={[
            {
              ...categoryRow,
              performance: {
                metric: "label",
                labels: [],
                current: null,
                previous: null,
              },
            },
          ]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("No data yet")).toHaveAttribute(
        "data-trend",
        "neutral",
      );
    });
  });

  /** @scenario "A scoring row is unchanged" */
  it("keeps showing a scoring monitor as a sparkline and a score", () => {
    render(<OnlineEvaluationsTable {...defaultProps} rows={[rows[0]!]} />, {
      wrapper: Wrapper,
    });

    expect(
      screen.getByRole("img", { name: "Performance trend for Answer quality" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0.86")).toBeInTheDocument();
    expect(screen.getByText("↑ 0.12")).toHaveAttribute("data-trend", "up");
    expect(
      screen.queryByRole("group", {
        name: "Label distribution for Answer quality",
      }),
    ).not.toBeInTheDocument();
  });

  it("centers a flat performance trend", () => {
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        rows={[
          {
            ...rows[0]!,
            performance: {
              metric: "score",
              points: [0.8, 0.8, 0.8],
              current: 0.8,
              previous: 0.8,
            },
          },
        ]}
      />,
      { wrapper: Wrapper },
    );

    expect(
      screen
        .getByRole("img", { name: "Performance trend for Answer quality" })
        .querySelector("polyline"),
    ).toHaveAttribute("points", "3,19 56,19 109,19");
  });
});
