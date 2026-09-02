import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * A dataset value too long for its row collapses behind a fade overlay and
 * expands over the page on click, the same affordance the target and Winner
 * cells offer in the same table.
 *
 * What is pinned here is the way back out. The expanded view sits on a fixed,
 * full-viewport backdrop that swallows every pointer event, so an overlay that
 * survives Escape does not merely ignore a keystroke: the toolbar above the
 * table stops responding until the reader happens to click the backdrop. All
 * three cells of this table have to answer Escape, or the table teaches the
 * reader a rule it then breaks one column over.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ExpandableDatasetCell } from "../expandable-dataset-cell";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

/** Long enough to trip the cell's overflow heuristic and offer the fade overlay. */
const OVERFLOWING_VALUE = Array.from(
  { length: 8 },
  (_, line) =>
    `Line ${line + 1}: the customer pasted a whole support thread into this dataset field.`,
).join(" ");

const BACKDROP = "expanded-input-backdrop";

describe("a dataset value too long to fit its row", () => {
  /** Renders the cell and clicks it open. */
  const expandCell = async () => {
    const user = userEvent.setup();

    render(<ExpandableDatasetCell value={OVERFLOWING_VALUE} columnName="input" />, {
      wrapper: Wrapper,
    });

    await user.click(screen.getByText(OVERFLOWING_VALUE));

    return user;
  };

  describe("given the reader has expanded it over the table", () => {
    describe("when Escape is pressed", () => {
      it("takes the backdrop out of the page along with the overlay", async () => {
        const user = await expandCell();
        expect(screen.getByTestId(BACKDROP)).toBeDefined();

        await user.keyboard("{Escape}");

        expect(screen.queryByTestId(BACKDROP)).toBeNull();
      });
    });

    describe("when the backdrop is clicked", () => {
      it("takes the backdrop out of the page along with the overlay", async () => {
        const user = await expandCell();

        await user.click(screen.getByTestId(BACKDROP));

        expect(screen.queryByTestId(BACKDROP)).toBeNull();
      });
    });
  });
});
