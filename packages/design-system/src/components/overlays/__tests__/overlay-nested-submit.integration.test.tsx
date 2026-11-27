/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { Dialog } from "../dialog.tsx";
import { Drawer } from "../drawer.tsx";

// A portalled overlay's form still sits inside its opener's form in the React tree, and React
// bubbles `submit` along that tree: the opener's save ran and the overlay's entry was lost.
describe("given an overlay with its own form, opened from inside another form", () => {
  afterEach(cleanup);

  describe("when the dialog's submit button is pressed", () => {
    /** @scenario "A footer submit action submits the right form once" */
    it("submits only the dialog's form", () => {
      const outer = vi.fn((event: React.FormEvent) => event.preventDefault());
      const inner = vi.fn();
      renderWithDesignSystem(
        <form onSubmit={outer}>
          <Dialog
            open
            onClose={() => undefined}
            title="Add model"
            onSubmit={inner}
            primaryAction={{ label: "Add model", type: "submit" }}
          >
            <input aria-label="Model ID" />
          </Dialog>
        </form>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Add model" }));

      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).not.toHaveBeenCalled();
    });
  });

  describe("when the drawer's form is submitted", () => {
    /** @scenario "A footer submit action submits the right form once" */
    it("submits only the drawer's form", () => {
      const outer = vi.fn((event: React.FormEvent) => event.preventDefault());
      const inner = vi.fn();
      renderWithDesignSystem(
        <form onSubmit={outer}>
          <Drawer open onClose={() => undefined} title="Edit" onSubmit={inner}>
            <button type="submit">Apply</button>
          </Drawer>
        </form>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      expect(inner).toHaveBeenCalledTimes(1);
      expect(outer).not.toHaveBeenCalled();
    });
  });
});
