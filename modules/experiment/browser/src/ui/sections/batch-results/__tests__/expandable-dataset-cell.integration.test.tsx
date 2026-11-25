import "@testing-library/jest-dom/vitest";
/**
 * Dataset values collapse behind a fade and expand on click, like other cells.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ExpandableDatasetCell } from "../expandable-dataset-cell.tsx";

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

    renderWithDesignSystem(<ExpandableDatasetCell value={OVERFLOWING_VALUE} columnName="input" />);

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
