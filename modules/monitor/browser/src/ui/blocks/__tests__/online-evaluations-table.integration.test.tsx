/**
 * @vitest-environment jsdom
 *
 * @see specs/evaluations/experiments-online-evaluations-separation.feature
 * @see modules/monitor/specs/monitor-auto-pause.feature
 * @see modules/monitor/specs/monitor-created-by.feature
 * @see modules/evaluation/specs/category-evaluator-performance.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MonitorHostApi, MonitorHostProvider } from "../../../model/monitor-host.ts";
import { type OnlineEvaluationRow, OnlineEvaluationsTable } from "../online-evaluations-table.tsx";

const navigate = vi.fn();

class TestMonitorHost extends MonitorHostApi {
  scope() {
    return { projectId: "proj_1", projectSlug: "demo" };
  }
  hasPermission() {
    return true;
  }
  copyTargets() {
    return [];
  }
  timeZone() {
    return "UTC";
  }
  route() {
    return { params: {}, query: {} };
  }
  navigate(to: string) {
    navigate(to);
  }
  openOverlay() {}
  succeeded() {}
  failed() {}
}

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MonitorHostProvider value={new TestMonitorHost()}>
    <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
  </MonitorHostProvider>
);

const rows: OnlineEvaluationRow[] = [
  {
    id: "monitor-up",
    name: "Answer quality",
    checkType: "langevals/llm_score",
    enabled: true,
    executionMode: "ON_MESSAGE",
    performance: {
      monitorId: "monitor-up",
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
      monitorId: "monitor-down",
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
      monitorId: "monitor-empty",
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
    monitorId: "monitor-category",
    metric: "label",
    points: [],
    labels: [
      { label: "resolved", count: 60, share: 0.6, grouped: false },
      { label: "escalated", count: 25, share: 0.25, grouped: false },
      { label: "abandoned", count: 15, share: 0.15, grouped: false },
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
    expect(screen.getByText("No data yet")).toHaveAttribute("data-trend", "neutral");
    expect(
      screen.getByRole("figure", { name: "Performance trend for Answer quality" }),
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

    await user.click(screen.getByRole("button", { name: "Actions for Answer quality" }));

    expect(await screen.findByRole("menuitem", { name: "View analytics" })).toHaveAttribute(
      "href",
      analyticsHref,
    );
  });

  it("navigates to analytics through the host, without a full page reload", async () => {
    const user = userEvent.setup();
    render(<OnlineEvaluationsTable {...defaultProps} />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("link", {
        name: "View analytics for Answer quality",
      }),
    );

    expect(navigate).toHaveBeenCalledWith("/demo/analytics/evaluations?evaluationId=monitor-up");
  });

  it("keeps configuration actions available from the row menu", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<OnlineEvaluationsTable {...defaultProps} onEdit={onEdit} />, {
      wrapper: Wrapper,
    });

    await user.click(screen.getByRole("button", { name: "Actions for Safety policy" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    expect(onEdit).toHaveBeenCalledWith("monitor-down");
  });

  /** @scenario A viewer without analytics access does not wait forever */
  it("shows a stable permission state without an empty action menu", () => {
    render(
      <OnlineEvaluationsTable {...defaultProps} canManage={false} canViewAnalytics={false} />,
      { wrapper: Wrapper },
    );

    expect(screen.getAllByText("Analytics access required")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Actions for Answer quality" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The monitor list shows that a monitor paused itself" */
  it("badges a monitor that paused itself, with the reason in its tooltip", async () => {
    const user = userEvent.setup();
    const reason = "95% of evaluations failed in the last hour (114 of 120)";
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        rows={[{ ...rows[2]!, autoPausedReason: reason }, rows[1]!]}
      />,
      { wrapper: Wrapper },
    );

    const badge = screen.getByTestId("monitor-auto-paused");
    expect(badge).toHaveTextContent("Paused automatically");
    expect(screen.getByText("Active")).toBeInTheDocument();

    await user.hover(badge);

    expect(
      await screen.findByText(`Paused automatically: ${reason}`, undefined, { timeout: 2_000 }),
    ).toBeInTheDocument();
  });

  it("shows an explicit state when performance analytics cannot load", () => {
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        rows={[{ ...rows[0]!, performance: undefined, hasPerformanceError: true }]}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Performance unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("centers a flat performance trend", () => {
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        rows={[
          {
            ...rows[0]!,
            performance: {
              monitorId: "monitor-up",
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
        .getByRole("figure", { name: "Performance trend for Answer quality" })
        .querySelector("polyline"),
    ).toHaveAttribute("points", "3,19 56,19 109,19");
  });

  /** @scenario "The online evaluations list shows who created each monitor" */
  it("names the creator beside the check type when one was recorded", () => {
    render(
      <OnlineEvaluationsTable
        {...defaultProps}
        rows={[
          { ...rows[0]!, createdByName: "Ada" },
          { ...rows[1]!, createdByName: null },
        ]}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("monitor-row-monitor-up")).toHaveTextContent("Created by Ada");
    expect(screen.getByTestId("monitor-row-monitor-down")).not.toHaveTextContent("Created by");
  });

  describe("when a monitor classifies instead of scoring", () => {
    /** @scenario "The row shows the labels instead of an empty state" */
    it("shows the label distribution and the leading label", () => {
      render(<OnlineEvaluationsTable {...defaultProps} rows={[categoryRow]} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.getByRole("group", { name: "Label distribution for Conversation outcome" }),
      ).toBeInTheDocument();
      expect(screen.getByText("resolved")).toBeInTheDocument();
      expect(screen.getByText("60%, ↑ 12 pp")).toHaveAttribute("data-trend", "up");
      expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
    });

    /** @scenario "The distribution names every label it drew" */
    it("names every label with its share", () => {
      render(<OnlineEvaluationsTable {...defaultProps} rows={[categoryRow]} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByRole("img", { name: "resolved, 60%" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "escalated, 25%" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "abandoned, 15%" })).toBeInTheDocument();
    });

    /** @scenario "The row says how much of the period the leading label held when there is nothing to compare" */
    it("says how much of the period the leading label held when there is nothing to compare", () => {
      render(
        <OnlineEvaluationsTable
          {...defaultProps}
          rows={[
            {
              ...categoryRow,
              performance: {
                monitorId: "monitor-category",
                metric: "label",
                points: [],
                labels: [{ label: "resolved", count: 3, share: 1, grouped: false }],
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
                monitorId: "monitor-category",
                metric: "label",
                points: [],
                labels: [],
                current: null,
                previous: null,
              },
            },
          ]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("No data yet")).toHaveAttribute("data-trend", "neutral");
    });
  });

  /** @scenario "A scoring row is unchanged" */
  it("keeps showing a scoring monitor as a sparkline and a score", () => {
    render(<OnlineEvaluationsTable {...defaultProps} rows={[rows[0]!]} />, { wrapper: Wrapper });

    expect(
      screen.getByRole("figure", { name: "Performance trend for Answer quality" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0.86")).toBeInTheDocument();
    expect(screen.getByText("↑ 0.12")).toHaveAttribute("data-trend", "up");
    expect(
      screen.queryByRole("group", { name: "Label distribution for Answer quality" }),
    ).not.toBeInTheDocument();
  });
});
