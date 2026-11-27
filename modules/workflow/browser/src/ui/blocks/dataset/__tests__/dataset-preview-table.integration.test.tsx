import type { DatasetColumns } from "@langwatch/dataset-contract";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DatasetPreviewTable } from "../dataset-preview-table.tsx";

afterEach(() => cleanup());

const columnsNamed = (names: string[]): DatasetColumns =>
  names.map((name) => ({ name, type: "string" }));

describe("given a dataset preview", () => {
  describe("when the dataset has more columns than fit", () => {
    /** @scenario "Every dataset preview keeps its columns at a readable width" */
    it("floors the table at a minimum width per visible column and scrolls sideways", () => {
      const names = Array.from({ length: 30 }, (_, i) => `column_${i}`);
      renderWithDesignSystem(
        <DatasetPreviewTable rows={[{ column_0: "hello" }]} columns={columnsNamed(names)} />,
      );

      const table = screen.getByTestId("dataset-preview-table");
      const rowNumberColumnPx = 48;
      const visibleColumns = 8;
      expect(Number.parseInt(table.style.minWidth, 10)).toBeGreaterThanOrEqual(
        rowNumberColumnPx + visibleColumns * 160,
      );
      expect(getComputedStyle(table.parentElement!).overflowX).toBe("auto");
    });
  });

  describe("when a column name is too long for its header", () => {
    /** @scenario "A column name too long for a preview header is cut short, not overlapped" */
    it("truncates the name on one line and offers the full name on hover", () => {
      const longName = "gold_skill_reason_for_the_thread_analysis";
      renderWithDesignSystem(
        <DatasetPreviewTable rows={[{ [longName]: "x" }]} columns={columnsNamed([longName])} />,
      );

      const label = screen.getByText(longName);
      expect(label.closest("th")).toHaveAttribute("title", longName);
      expect(getComputedStyle(label).textOverflow).toBe("ellipsis");
      expect(getComputedStyle(label).whiteSpace).toBe("nowrap");
      expect(getComputedStyle(label).minWidth).toBe("0px");
      expect(getComputedStyle(label.parentElement!).minWidth).toBe("0px");
    });
  });
});
