/**
 * @vitest-environment jsdom
 *
 * What the value columns of the trace table show for a row, and what a click
 * on a value chip does.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExplorerStore } from "../../../../../../../../behavior/explorer.store.ts";
import { useTimeFormatStore } from "../../../../../../../../behavior/time-format.store.ts";
import { formatISOTimestamp } from "../../../../../../../../model/display-formatters.ts";
import { useDensityTokens } from "../../../../../hooks/use-density-tokens.ts";
import type { TraceListItem } from "../../../../../types/trace.ts";
import { buildTracePlaceholderRows } from "../../../../skeleton-placeholders.ts";
import { TraceStatisticsProvider } from "../../../../trace-statistics-context.tsx";
import type { CellDef } from "../../../types.ts";
import { CostCell } from "../cost-cell.tsx";
import { DurationCell } from "../duration-cell.tsx";
import { EvaluationsCell } from "../evaluations-cell.tsx";
import { LabelsCell } from "../labels-cell.tsx";
import { ModelCell } from "../model-cell.tsx";
import { ServiceCell } from "../service-cell.tsx";
import { SinceCell } from "../since-cell.tsx";
import { TimeCell } from "../time-cell.tsx";
import { TimestampCell } from "../timestamp-cell.tsx";
import { TokensCell } from "../tokens-cell.tsx";
import "@testing-library/jest-dom/vitest";

const openDrawer = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer }),
}));

/** A complete row, overridden by the one or two fields a case is about. */
function row(over: Partial<TraceListItem> = {}): TraceListItem {
  const [placeholder] = buildTracePlaceholderRows(1);
  if (!placeholder) throw new Error("no placeholder row built");
  return {
    ...placeholder,
    traceId: "t1",
    serviceName: "checkout",
    durationMs: 340,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    evaluations: [],
    ...over,
  };
}

/** The cell as the table renders it, inside a row whose click opens the drawer. */
const Cell: React.FC<{
  def: CellDef<TraceListItem>;
  item: TraceListItem;
  onRowClick: () => void;
}> = ({ def, item, onRowClick }) => (
  <TraceStatisticsProvider traces={[item]}>
    <table>
      <tbody>
        <tr data-testid="row" onClick={onRowClick} onKeyDown={onRowClick}>
          <td>
            {def.render({
              row: item,
              density: useDensityTokens(),
              densityMode: "compact",
              isExpanded: false,
              isSelected: false,
              isFocused: false,
              actions: {},
              enabledAddonIds: [],
            })}
          </td>
        </tr>
      </tbody>
    </table>
  </TraceStatisticsProvider>
);

function renderCell({ def, item }: { def: CellDef<TraceListItem>; item: TraceListItem }) {
  const onRowClick = vi.fn();
  const view = renderWithDesignSystem(<Cell def={def} item={item} onRowClick={onRowClick} />);
  return { ...view, onRowClick };
}

const queryText = () => useExplorerStore.getState().queryText;
const MINUTE_MS = 60_000;

beforeEach(() => {
  useExplorerStore.getState().clearAll();
  useTimeFormatStore.setState({ format: "relative" });
  openDrawer.mockReset();
});

afterEach(cleanup);

describe("the time columns", () => {
  describe("given a trace that occurred two minutes ago", () => {
    const occurred = Date.now() - 2 * MINUTE_MS - 5_000;

    /** @scenario Time column shows compact relative time */
    it("shows the Time column as 2m", () => {
      const { container } = renderCell({ def: TimeCell, item: row({ timestamp: occurred }) });

      expect(container.textContent).toBe("2m");
    });

    /** @scenario Since column shows verbose relative time */
    it("shows the Since column as 2 minutes ago", () => {
      const { container } = renderCell({ def: SinceCell, item: row({ timestamp: occurred }) });

      expect(container.textContent).toBe("2 minutes ago");
    });
  });

  describe("given the Timestamp column", () => {
    /** @scenario Timestamp column shows ISO 8601 */
    it("shows the full ISO 8601 stamp of the trace", () => {
      const timestamp = Date.UTC(2026, 5, 2, 13, 14, 15, 123);
      const { container } = renderCell({ def: TimestampCell, item: row({ timestamp }) });

      expect(container.textContent).toBe("2026-06-02T13:14:15.123Z");
      expect(container.textContent).toBe(formatISOTimestamp(timestamp));
    });
  });
});

describe("the measure columns", () => {
  describe("given a duration of 340 milliseconds", () => {
    /** @scenario Duration column shows inline proportional bar */
    it("shows the formatted duration with a proportional bar under it", () => {
      const slow = row({ traceId: "slow", durationMs: 1200 });
      const quick = row({ traceId: "quick", durationMs: 340 });
      const first = renderWithDesignSystem(
        <TraceStatisticsProvider traces={[quick, slow]}>
          <div data-testid="quick">{DurationCell.render(cellContext(quick))}</div>
          <div data-testid="slow">{DurationCell.render(cellContext(slow))}</div>
        </TraceStatisticsProvider>,
      );

      expect(first.getByTestId("quick").textContent).toBe("340ms");
      expect(first.getByTestId("slow").textContent).toBe("1.2s");
      expect(first.getByTestId("quick").querySelectorAll("div[class]").length).toBeGreaterThan(1);
    });
  });

  describe("given costs of different sizes", () => {
    /** @scenario Cost column shows appropriate precision */
    it("reads a dollar-range cost with two decimals and a sub-cent cost with more", () => {
      const dollars = renderCell({ def: CostCell, item: row({ totalCost: 1.24 }) });
      expect(dollars.container.textContent).toBe("$1.24");
      cleanup();

      const subCent = renderCell({ def: CostCell, item: row({ totalCost: 0.003 }) });
      expect(subCent.container.textContent).toMatch(/^\$0\.003\d?$/);
    });
  });

  describe("given token counts of different sizes", () => {
    /** @scenario Tokens column shows compact format */
    it("reads thousands as 1.2K and small counts plainly", () => {
      const thousands = renderCell({ def: TokensCell, item: row({ totalTokens: 1200 }) });
      expect(thousands.container.textContent).toBe("1.2K");
      cleanup();

      const small = renderCell({ def: TokensCell, item: row({ totalTokens: 450 }) });
      expect(small.container.textContent).toBe("450");
    });
  });
});

describe("the descriptive columns", () => {
  describe("given a trace that used two models", () => {
    /** @scenario Model column shows badge for multiple models */
    it("shows the primary model with a +1 badge", () => {
      const { container } = renderCell({
        def: ModelCell,
        item: row({ models: ["gpt-5-mini", "claude-sonnet"] }),
      });

      expect(container.textContent).toContain("gpt-5-mini");
      expect(container.textContent).toContain("+1");
      expect(container.textContent).not.toContain("claude-sonnet");
    });
  });

  describe("given a trace with the labels billing and refund", () => {
    /** @scenario Labels column shows colour-coded badges */
    it("shows a badge per label, and the same label reads the same colour on every row", () => {
      const first = renderCell({ def: LabelsCell, item: row({ labels: ["billing", "refund"] }) });
      expect(screen.getByRole("button", { name: 'Filter by label "billing"' })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: 'Filter by label "refund"' })).toBeInTheDocument();
      const billingFirst = screen.getByRole("button", { name: 'Filter by label "billing"' })
        .firstElementChild!.className;
      first.unmount();

      renderCell({ def: LabelsCell, item: row({ traceId: "t2", labels: ["billing"] }) });
      const billingAgain = screen.getByRole("button", { name: 'Filter by label "billing"' })
        .firstElementChild!.className;
      expect(billingAgain).toBe(billingFirst);
    });
  });

  describe("given a trace with no labels", () => {
    /** @scenario Labels column shows an em dash when there are no labels */
    it("shows an em dash and no label button", () => {
      const { container } = renderCell({ def: LabelsCell, item: row({ labels: [] }) });

      expect(container.textContent).toBe("—");
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("given a trace with no service", () => {
    /** @scenario Null column values show dash */
    it("shows an em dash in the Service column", () => {
      const { container } = renderCell({ def: ServiceCell, item: row({ serviceName: "" }) });

      expect(container.textContent).toBe("—");
    });
  });
});

describe("clicking a value chip", () => {
  describe("given a row showing the label billing", () => {
    /** @scenario Clicking a label chip filters by that label */
    it("filters by that label and does not reach the row", () => {
      const { onRowClick } = renderCell({ def: LabelsCell, item: row({ labels: ["billing"] }) });

      fireEvent.click(screen.getByRole("button", { name: 'Filter by label "billing"' }));

      expect(queryText()).toBe("label:billing");
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  describe("given a row showing the model gpt-5-mini", () => {
    /** @scenario Clicking a model chip filters by that model */
    it("filters by that model and does not reach the row", () => {
      const { onRowClick } = renderCell({ def: ModelCell, item: row({ models: ["gpt-5-mini"] }) });

      fireEvent.click(screen.getByRole("button", { name: 'Filter by model "gpt-5-mini"' }));

      expect(queryText()).toBe("model:gpt-5-mini");
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  describe("given a row showing an evaluation", () => {
    /** @scenario Clicking an evaluation chip filters by that evaluator */
    it("filters by the evaluator id and does not reach the row", () => {
      const { onRowClick } = renderCell({
        def: EvaluationsCell,
        item: row({
          evaluations: [
            {
              evaluatorId: "ragas/faithfulness",
              evaluatorName: "Faithfulness",
              status: "processed",
              score: 0.9,
              passed: true,
              label: null,
            },
          ],
        }),
      });

      fireEvent.click(screen.getAllByTitle('Filter by evaluator "Faithfulness"')[0]!);

      expect(queryText()).toBe('evaluator:"ragas/faithfulness"');
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });
});

function evaluation(evaluatorId: string): TraceListItem["evaluations"][number] {
  return {
    evaluatorId,
    evaluatorName: "Faithfulness",
    status: "processed",
    score: 0.9,
    passed: true,
    label: null,
  };
}

async function openEvaluationCard() {
  const chips = screen.getAllByTitle('Filter by evaluator "Faithfulness"');
  await userEvent.setup({ pointerEventsCheck: 0 }).hover(chips[chips.length - 1]!);
}

async function clickViewDefinition() {
  const actions = await screen.findAllByText("View definition");
  fireEvent.click(actions[actions.length - 1]!);
}

describe("an evaluation chip's definition link", () => {
  describe("given a configured evaluator whose id has no slash", () => {
    /** @scenario Online evaluation can open its definition */
    it("offers View definition, opening the evaluator editor for an evaluator_ id and the online-evaluation drawer for others", async () => {
      renderCell({
        def: EvaluationsCell,
        item: row({ evaluations: [evaluation("evaluator_abc")] }),
      });
      await openEvaluationCard();
      await clickViewDefinition();
      expect(openDrawer).toHaveBeenCalledWith("evaluatorEditor", { evaluatorId: "evaluator_abc" });
      cleanup();

      renderCell({ def: EvaluationsCell, item: row({ evaluations: [evaluation("monitor_1")] }) });
      await openEvaluationCard();
      await clickViewDefinition();
      expect(openDrawer).toHaveBeenCalledWith("onlineEvaluation", { monitorId: "monitor_1" });
    });
  });

  describe("given a langevals built-in evaluator type such as ragas/faithfulness", () => {
    /** @scenario Built-in evaluator type has no definition link */
    it("offers no View definition action", async () => {
      renderCell({
        def: EvaluationsCell,
        item: row({ evaluations: [evaluation("ragas/faithfulness")] }),
      });
      await openEvaluationCard();

      expect(await screen.findAllByText("Passed")).not.toHaveLength(0);
      expect(screen.queryByText("View definition")).toBeNull();
    });
  });
});

/** The context a registry cell is rendered with, for cells placed outside a table row. */
function cellContext(item: TraceListItem) {
  return {
    row: item,
    density: {} as never,
    densityMode: "compact" as const,
    isExpanded: false,
    isSelected: false,
    isFocused: false,
    actions: {},
    enabledAddonIds: [],
  };
}
