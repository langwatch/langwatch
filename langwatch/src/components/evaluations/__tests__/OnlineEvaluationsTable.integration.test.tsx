/**
 * @vitest-environment jsdom
 *
 * @see specs/evaluations/experiments-online-evaluations-separation.feature
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

  it("does not render an empty action menu when the viewer has no row actions", () => {
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        canManage={false}
        canViewAnalytics={false}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getAllByText("Analytics unavailable")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Actions for Answer quality" }),
    ).not.toBeInTheDocument();
  });

  it("shows an explicit state when performance analytics cannot load", () => {
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        rows={[{ ...rows[0]!, performance: undefined, performanceError: true }]}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Performance unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
