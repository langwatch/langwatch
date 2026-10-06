/**
 * @vitest-environment jsdom
 *
 * The table body dims while a view switch re-queries and returns to full
 * strength when the new data arrives.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useRefreshUIStore } from "../../../../../behavior/refresh-ui.store.ts";
import { TraceTableLayout } from "../trace-table-layout.tsx";

vi.mock("../../hooks/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => ({ totalHits: 0, itemNoun: "traces", instantEval: null, summary: "" }),
}));
vi.mock("../column-education-dialog.tsx", () => ({ ColumnEducationDialog: () => null }));
vi.mock("../../traces-page/refresh-progress-bar.tsx", () => ({ RefreshProgressBar: () => null }));
vi.mock("../../hooks/use-trace-new-count.ts", () => ({
  useTraceNewCount: () => ({ count: 0, acknowledge: vi.fn() }),
}));

function tableBody(container: HTMLElement): HTMLElement {
  const body = container.querySelector<HTMLElement>('[data-spotlight="trace-table"]');
  if (!body) throw new Error("the table body did not render");
  return body;
}

beforeEach(() => {
  useRefreshUIStore.setState({ isReplacingData: false });
});

afterEach(cleanup);

describe("the trace table body while a view switch re-queries", () => {
  describe("given the All Traces lens is showing data", () => {
    /** @scenario Preset switch reduces opacity while loading */
    it("keeps the rows visible at reduced opacity, then returns to full opacity", () => {
      const { container } = renderWithDesignSystem(
        <TraceTableLayout>
          <div data-testid="rows">rows</div>
        </TraceTableLayout>,
      );
      expect(getComputedStyle(tableBody(container)).opacity).toBe("1");

      act(() => useRefreshUIStore.setState({ isReplacingData: true }));
      expect(container.querySelector('[data-testid="rows"]')).not.toBeNull();
      expect(tableBody(container)).toHaveAttribute("aria-busy", "true");
      expect(getComputedStyle(tableBody(container)).opacity).toBe("0.6");

      act(() => useRefreshUIStore.setState({ isReplacingData: false }));
      expect(tableBody(container)).not.toHaveAttribute("aria-busy");
      expect(getComputedStyle(tableBody(container)).opacity).toBe("1");
    });
  });
});
