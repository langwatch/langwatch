// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

describe("Drawer.Actions", () => {
  afterEach(cleanup);

  describe("given a secondary action", () => {
    it("shows it in Cancel's place, beside the primary", () => {
      renderWithDesignSystem(
        <Drawer.Root open>
          <Drawer.Content>
            <Drawer.Actions
              start={<button type="button">Discard</button>}
              secondary={<button type="button">Save</button>}
              primary={<button type="button">Apply</button>}
            />
          </Drawer.Content>
        </Drawer.Root>,
      );

      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      const names = screen.getAllByRole("button").map((button) => button.textContent);
      expect(names.slice(-3)).toEqual(["Discard", "Save", "Apply"]);
    });
  });

  describe("given bare", () => {
    it("renders only the row, so a host may show it outside a drawer", () => {
      const { container } = renderWithDesignSystem(
        <Drawer.Actions
          bare
          secondary={<button type="button">Save</button>}
          primary={<button type="button">Apply</button>}
        />,
      );

      expect(container.querySelector("[data-part='footer']")).toBeNull();
      expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    });
  });
});
