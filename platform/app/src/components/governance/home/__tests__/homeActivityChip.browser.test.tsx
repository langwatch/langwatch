/**
 * Real-Chromium layout test for the kind chip on a recent-activity row.
 *
 * WHY THIS FILE EXISTS.
 *
 * The overview's activity rows end in a category chip — Costs, Directory,
 * Sources, Agents, Dashboard — and the right-hand column they sit in is the
 * narrow half of a two-column grid. A chip carries horizontal padding the plain
 * text before it did not, so the design raises a question: when the column
 * tightens, what gives way? The answer is the name. It truncates with an
 * ellipsis while the chip stays whole, because a chip cut in half reads as a
 * different word and a shortened name still reads as a shortened name.
 *
 * jsdom cannot see any of that. It performs no layout, so every
 * `getBoundingClientRect` is zero and every `scrollWidth` is zero; a row that
 * truncates and a row whose text paints across its neighbour are byte-identical
 * to it. The sibling jsdom test in
 * `src/pages/governance/__tests__/governanceOverviewHero.integration.test.tsx`
 * asserts that the kind is its own badge element, and that is its ceiling.
 * Width is measurable only by a real engine, which is this file.
 *
 * WHAT HOLDS THE CHIP, because the obvious answer is wrong and was believed
 * here for a while.
 *
 * It is not a `flex-shrink: 0` on the chip. The chip carried one. Seven
 * configurations were measured in this browser to find out whether it did
 * anything — one-word label and two-word, `nowrap` and `normal`, the prop
 * present and absent — and all seven produced identical geometry at every
 * column width. The prop was removed rather than left standing with a comment
 * claiming it worked.
 *
 * The real mechanism is an asymmetry in automatic minimum sizes. The name
 * carries `min-width: 0` and `overflow: hidden`, either of which drops its
 * automatic minimum to zero and makes it the only item flexbox is willing to
 * shrink. The chip is left at `min-width: auto`, whose automatic minimum is its
 * own min-content, so it is never squeezed below its word. The chip holds
 * because nothing asked it to move.
 *
 * WHAT THESE ASSERTIONS CATCH. Both were produced by breaking the component and
 * watching the numbers, not by reading the CSS:
 *
 *   - Remove the name's `overflow: hidden` and it still shrinks, but its ink
 *     keeps painting at full length out of its own box and across the gap
 *     toward the chip. Geometry cannot see this — a Range over the text reports
 *     the same unclipped rectangle either way — so the gap is HIT-TESTED
 *     instead. Clipped ink takes no hits; unclipped ink does.
 *   - Remove `min-width: 0` as well and nothing in the row can shrink at all:
 *     the name stops truncating and the chip lands 44.1px outside its row at a
 *     150px column.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */

import { Box, ChakraProvider } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { system } from "~/pages/_app";
import { GovernanceHomeSections } from "../GovernanceHomeSections";

/**
 * The widest of the five kinds, so the row under test is the one with the least
 * room left over for its name.
 */
const WIDEST_KIND = "Dashboard";

/** Comfortably wider than the real column: nothing should truncate here. */
const ROOMY = 520;

/**
 * Narrower than the real column ever gets. The point is not to reproduce a
 * viewport — the production widths come from the grid — but to push past the
 * point where something has to give, so the test can say which of the two it
 * was. Measured: this row's name first truncates between 260px and 200px, and
 * 150px leaves a gap wide enough that unclipped ink lands squarely in it.
 */
const CRAMPED = 150;

function Column({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <ChakraProvider value={system}>
        <Box data-testid="column" width={`${ROOMY}px`}>
          {children}
        </Box>
      </ChakraProvider>
    </MemoryRouter>
  );
}

function mount() {
  render(
    <Column>
      <GovernanceHomeSections canSetUpInsights sample />
    </Column>,
  );
}

/** Squeezes the column and returns once the browser has re-laid it out. */
function narrowTo(width: number) {
  const column = screen.getByTestId("column");
  column.style.width = `${width}px`;
  // Reading a geometric property flushes the pending layout, so every
  // measurement after this call sees the new width rather than the old one.
  return column.getBoundingClientRect().width;
}

/** The chip, its row, and the name that shares the row with it. */
function activityRow() {
  const chip = screen.getByText(WIDEST_KIND);
  const row = chip.parentElement;
  if (!row) throw new Error(`the ${WIDEST_KIND} chip is not inside a row`);
  const name = Array.from(row.children).find(
    (el): el is HTMLElement => el !== chip && el.tagName === "P",
  );
  if (!name) throw new Error(`the ${WIDEST_KIND} row carries no name`);
  return { chip, row, name };
}

const widthOf = (el: Element) => el.getBoundingClientRect().width;
const isTruncated = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;
/** How far past its row's right edge an element paints. */
const overhangOf = (el: Element, row: Element) =>
  el.getBoundingClientRect().right - row.getBoundingClientRect().right;

/**
 * Whatever the browser would hand a click landing midway between the name's
 * right edge and the chip's left one. That gap is empty when the name is
 * properly clipped, and full of the name's overflowing text when it is not.
 */
function whatIsPaintedBetweenNameAndChip() {
  const { chip, name } = activityRow();
  const nameBox = name.getBoundingClientRect();
  const chipBox = chip.getBoundingClientRect();
  return document.elementFromPoint(
    (nameBox.right + chipBox.left) / 2,
    nameBox.top + nameBox.height / 2,
  );
}

afterEach(cleanup);

describe("given a recent-activity row in a real browser", () => {
  describe("when the column is roomy", () => {
    /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
    it("draws the whole chip and the whole name", () => {
      mount();
      const { chip, row, name } = activityRow();

      expect(widthOf(chip)).toBeGreaterThan(0);
      expect(isTruncated(name)).toBe(false);
      expect(overhangOf(chip, row)).toBeLessThanOrEqual(1);
    });
  });

  describe("when the column narrows", () => {
    /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
    it("keeps the chip at its full width and truncates the name instead", () => {
      mount();
      const { chip, name } = activityRow();
      const chipWhenRoomy = widthOf(chip);

      narrowTo(CRAMPED);

      // Same element, same text, less room around it, unchanged width.
      expect(widthOf(chip)).toBe(chipWhenRoomy);
      // And the proof the column really did tighten enough to force the
      // question. Without this the assertion above would also pass on a column
      // that never ran out of room — and it is the line that goes red when the
      // name loses the properties that let it shrink.
      expect(isTruncated(name)).toBe(true);
    });

    /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
    it("clips the truncated name rather than letting it run under the chip", () => {
      mount();
      const { name } = activityRow();

      narrowTo(CRAMPED);

      // Hit-testing rather than measuring, because measuring cannot tell these
      // two apart: the text's own rectangle is the same whether the box clips
      // it or not. What differs is whether that ink is painted, and the browser
      // will only hand back an element it actually drew at the point asked for.
      expect(whatIsPaintedBetweenNameAndChip()).not.toBe(name);
    });

    /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
    it("keeps the chip inside the row rather than painting past its edge", () => {
      mount();
      const { chip, row } = activityRow();
      const chipHeightWhenRoomy = chip.getBoundingClientRect().height;

      narrowTo(CRAMPED);

      expect(overhangOf(chip, row)).toBeLessThanOrEqual(1);
      // A chip that stayed inside the row by wrapping its own word would pass
      // the line above and still look broken, so height stands in for "the word
      // is intact".
      expect(chip.getBoundingClientRect().height).toBe(chipHeightWhenRoomy);
      expect(chip.scrollWidth).toBeLessThanOrEqual(chip.clientWidth + 1);
    });
  });
});
