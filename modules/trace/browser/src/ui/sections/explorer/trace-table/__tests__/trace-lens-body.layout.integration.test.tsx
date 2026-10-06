/**
 * @vitest-environment jsdom
 *
 * How the trace table is laid out: pinned header and select column, horizontal
 * scroll, and the I/O preview sub-row under a trace's header row.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useDensityStore } from "../../../../../behavior/density.store.ts";
import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import type { LensConfig } from "../../../../../behavior/view.slice.ts";
import type { TraceListItem } from "../../types/trace.ts";
import { buildTracePlaceholderRows } from "../skeleton-placeholders.ts";
import { TraceLensBody } from "../trace-lens-body.tsx";
import { TraceTableLayout } from "../trace-table-layout.tsx";

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), currentDrawer: null, openDrawer: vi.fn() }),
  useDrawerParams: () => ({}),
}));
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));
vi.mock("../../hooks/use-open-trace-drawer.ts", () => ({ useOpenTraceDrawer: () => vi.fn() }));
vi.mock("../../hooks/use-evaluator-options.ts", () => ({
  useEvaluatorOptions: () => ({ options: [], nameByKey: new Map() }),
}));
vi.mock("../../hooks/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => ({ totalHits: 0, itemNoun: "traces", instantEval: null, summary: "" }),
}));
vi.mock("../column-education-dialog.tsx", () => ({ ColumnEducationDialog: () => null }));
vi.mock("../../traces-page/refresh-progress-bar.tsx", () => ({ RefreshProgressBar: () => null }));
vi.mock("../../hooks/use-trace-new-count.ts", () => ({
  useTraceNewCount: () => ({ count: 0, acknowledge: vi.fn() }),
}));

const lens = (over: Partial<LensConfig> = {}): LensConfig => ({
  id: "all-traces",
  name: "All Traces",
  isBuiltIn: true,
  columns: ["time", "trace", "service", "duration", "cost", "tokens", "model", "labels"],
  addons: ["io-preview"],
  grouping: "flat",
  sort: { columnId: "time", direction: "desc" },
  filterText: "",
  ...over,
});

function trace(over: Partial<TraceListItem> = {}): TraceListItem {
  const [placeholder] = buildTracePlaceholderRows(1);
  if (!placeholder) throw new Error("no placeholder row built");
  return {
    ...placeholder,
    traceId: "t1",
    name: "checkout",
    serviceName: "api",
    status: "ok",
    input: "what is the weather",
    output: "sunny",
    ...over,
  };
}

function renderTable({
  traces,
  config = lens(),
}: {
  traces: TraceListItem[];
  config?: LensConfig;
}) {
  return renderWithDesignSystem(
    <TraceTableLayout visibleCount={traces.length}>
      <TraceLensBody traces={traces} lens={config} newIds={new Set()} />
    </TraceTableLayout>,
  );
}

const BOX_PROPERTIES = ["offsetHeight", "offsetWidth"] as const;

/** The trace's header row and the sub-row an addon renders beneath it. */
function bodyRows(container: HTMLElement): { main: HTMLElement; sub: HTMLElement } {
  const [main, sub] = container.querySelectorAll<HTMLElement>("tbody > tr");
  if (!main || !sub) throw new Error("the trace rendered no sub-row");
  return { main, sub };
}

beforeEach(() => {
  useExplorerStore.getState().clearAll();
  // jsdom measures every element as zero, which windows the virtualised table down to no rows.
  for (const property of BOX_PROPERTIES) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => (property === "offsetHeight" ? 800 : 1200),
    });
  }
});

afterEach(() => {
  cleanup();
  useDensityStore.setState({ density: "comfortable" });
  for (const property of BOX_PROPERTIES) Reflect.deleteProperty(HTMLElement.prototype, property);
});

describe("the trace table body", () => {
  /** @scenario "Table header row is sticky during vertical scroll" */
  it("pins the header row to the top of the scroll area", () => {
    const { container } = renderTable({ traces: [trace()] });

    const head = container.querySelector("thead") as HTMLElement;
    expect(getComputedStyle(head).position).toBe("sticky");
    expect(getComputedStyle(head).top).toBe("0px");
  });

  /** @scenario "The row-select column is sticky during horizontal scroll" */
  it("pins only the leftmost row-select cell, header and body, to the left edge", () => {
    const { container } = renderTable({ traces: [trace()] });

    const headCells = container.querySelectorAll("thead th");
    const cells = container.querySelectorAll("tbody > tr:first-of-type > td");
    expect(getComputedStyle(headCells[0] as HTMLElement).position).toBe("sticky");
    expect(getComputedStyle(headCells[0] as HTMLElement).left).toBe("0px");
    expect(getComputedStyle(cells[0] as HTMLElement).position).toBe("sticky");
    expect(getComputedStyle(cells[0] as HTMLElement).left).toBe("0px");
    expect(getComputedStyle(cells[1] as HTMLElement).position).not.toBe("sticky");
    expect(getComputedStyle(headCells[1] as HTMLElement).position).not.toBe("sticky");
  });

  /** @scenario "Table scrolls horizontally when columns exceed viewport" */
  it("sets a minimum table width past the viewport inside a scrolling container", () => {
    const { container } = renderTable({ traces: [trace()] });

    const scroller = container.querySelector('[data-spotlight="trace-table"]') as HTMLElement;
    const table = container.querySelector("table") as HTMLElement;
    expect(getComputedStyle(scroller).overflow).toBe("auto");
    const minWidth = Number.parseInt(getComputedStyle(table).minWidth, 10);
    expect(minWidth).toBeGreaterThan(window.innerWidth);
  });
});

describe("the I/O preview sub-row", () => {
  /** @scenario "LLM trace row renders the IOPreviewAddon below the header" */
  it("sits below an unexpanded trace row and carries the row's status border", () => {
    const { container } = renderTable({ traces: [trace({ status: "error" })] });

    expect(container.querySelectorAll("tbody > tr")).toHaveLength(2);
    const { main, sub } = bodyRows(container);
    expect(main).toHaveTextContent("api");
    expect(main).not.toHaveTextContent("what is the weather");
    expect(sub).toHaveTextContent("what is the weather");
    expect(sub).toHaveTextContent("sunny");
    const accent = (el: Element) => getComputedStyle(el as HTMLElement);
    const subEdge = accent(sub.querySelector("td") as Element);
    expect(subEdge.borderLeftWidth).toBe("2px");
    expect(subEdge.borderLeftColor).not.toBe("transparent");
    expect(subEdge.borderLeftColor).toBe(
      accent(main.querySelector("td") as Element).borderLeftColor,
    );
  });

  /** @scenario "The I/O preview stops before Labels, Evals, Prompt, or Events" */
  it("spans the columns before Labels, stays out of sticky, and wraps its text", () => {
    const { container } = renderTable({ traces: [trace()] });

    const { main, sub } = bodyRows(container);
    const mainCells = [...main.querySelectorAll("td")];
    const labelsAt = lens().columns.indexOf("labels") + 1;
    const [content, filler] = sub.querySelectorAll<HTMLTableCellElement>("td");
    if (!content || !filler) throw new Error("the sub-row did not split around Labels");
    expect(content.colSpan).toBe(labelsAt);
    expect(content.colSpan).toBeLessThan(mainCells.length);
    expect(filler.colSpan).toBe(mainCells.length - labelsAt);
    expect(content.style.position).toBe("static");
    const text = [...content.querySelectorAll("p, span")].find((el) =>
      el.textContent?.includes("what is the weather"),
    ) as HTMLElement;
    expect(getComputedStyle(text).whiteSpace).toBe("pre-line");
  });
});

/** Every rule of a sheet, descending into at-rules such as `@layer` blocks. */
function flattenRules(rules: CSSRule[]): CSSRule[] {
  return rules.flatMap((rule) => [
    rule,
    ...("cssRules" in rule ? flattenRules([...(rule as CSSGroupingRule).cssRules]) : []),
  ]);
}

describe("the hover over a trace with an I/O sub-row", () => {
  /** @scenario "Two-zone hover treats both lines as one unit" */
  it("groups the header row and the I/O row under one hover rule", () => {
    const { container } = renderTable({ traces: [trace()] });

    const { main, sub } = bodyRows(container);
    const group = main.parentElement as HTMLElement;
    expect(sub.parentElement).toBe(group);
    expect(group.tagName).toBe("TBODY");
    const rules = [...document.styleSheets].flatMap((sheet) => flattenRules([...sheet.cssRules]));
    const hoverRule = rules.find(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        [...group.classList].some((name) => rule.selectorText.startsWith(`.${name}:`)) &&
        rule.selectorText.includes(":hover") &&
        rule.selectorText.endsWith(">tr>td"),
    );
    expect(hoverRule?.style.background).toContain("--chakra-colors-gray-subtle");
  });
});

describe("the error detail sub-row", () => {
  /** @scenario Erroring span on root shows "(root)" */
  it("names the root as the erroring span when no child span carries the error", () => {
    useDensityStore.setState({ density: "compact" });
    const { container } = renderTable({
      traces: [
        trace({ status: "error", error: "TimeoutError: upstream", errorSpanName: undefined }),
      ],
      config: lens({ addons: ["error-detail"] }),
    });

    const { sub } = bodyRows(container);
    expect(sub).toHaveTextContent("(root)");
    expect(sub).toHaveTextContent("TimeoutError: upstream");
  });
});
