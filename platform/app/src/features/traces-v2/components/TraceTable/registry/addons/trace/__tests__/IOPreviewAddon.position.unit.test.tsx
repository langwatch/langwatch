/**
 * @vitest-environment jsdom
 *
 * Guards the horizontal-scroll fix: the IO preview content cell must NOT
 * inherit the table shell's global sticky-first-column rule
 * (`tbody > tr > td:first-child { position: sticky }`). A sticky cell keeps
 * its full width while sliding to the viewport's left edge, so on horizontal
 * scroll it slid right and painted the preview text OVER the reserved columns
 * (labels / evals / events / prompt). The cell defeats the rule with an inline
 * `position: static` so it scrolls with the body and its colSpan-bounded right
 * edge stays glued to the reserved-column boundary.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { Row } from "@tanstack/react-table";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TraceListItem } from "../../../../../../types/trace";
import { ROW_STYLES } from "../../../../StatusRow";
import { IOPreviewAddon } from "../IOPreviewAddon";

// Force the compact path — that's the density the IO preview row renders in.
vi.mock("../../../../../../stores/densityStore", () => ({
  useDensityStore: (selector: (s: { density: string }) => unknown) =>
    selector({ density: "compact" }),
  getDrawerDensityTokens: () => ({}),
}));

vi.mock("../../../../../../hooks/useDensityTokens", () => ({
  useDensityTokens: () => ({ ioFontSize: "11px" }),
}));

const COLUMNS = ["select", "trace", "model", "labels", "evaluations", "events"];

function fakeRow(): Row<TraceListItem> {
  return {
    original: { input: "ping", output: "pong" } as TraceListItem,
    getVisibleCells: () =>
      COLUMNS.map((id) => ({ column: { id } })) as ReturnType<
        Row<TraceListItem>["getVisibleCells"]
      >,
  } as Row<TraceListItem>;
}

function renderAddonRow() {
  const tanstackRow = fakeRow();
  return render(
    <ChakraProvider value={defaultSystem}>
      <table>
        <tbody>
          {IOPreviewAddon.render({
            row: tanstackRow.original,
            density: {
              ioFontSize: "11px",
              ioPaddingTop: "6px",
              ioPaddingBottom: "6px",
            } as never,
            densityMode: "compact",
            colSpan: COLUMNS.length,
            style: ROW_STYLES.default,
            isExpanded: false,
            isSelected: false,
            tanstackRow,
            actions: {},
            // evals (index 4) rowSpans into this addon row.
            rowSpanClaimedIndices: [4],
          })}
        </tbody>
      </table>
    </ChakraProvider>,
  );
}

describe("IOPreviewAddon row positioning", () => {
  describe("given the addon row renders with labels/evals to its right", () => {
    describe("when the preview content cell paints", () => {
      it("does not let the content cell go sticky, so it can't slide over the reserved columns on scroll", () => {
        const { container } = renderAddonRow();
        const firstCell = container.querySelector("td");
        expect(firstCell).not.toBeNull();
        // Inline override beats the shell's `td:first-child { sticky }` rule.
        expect(firstCell!.style.position).toBe("static");
      });

      it("renders the preview text inside that leading content cell", () => {
        const { container } = renderAddonRow();
        const firstCell = container.querySelector("td");
        expect(firstCell).not.toBeNull();
        // The first cell is the bounded preview content, not a filler.
        expect(firstCell?.textContent).toContain("ping");
        expect(firstCell?.textContent).toContain("pong");
      });
    });
  });
});
