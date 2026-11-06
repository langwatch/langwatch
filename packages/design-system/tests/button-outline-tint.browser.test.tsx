/** Measured outline-button colour in real Chromium: a hue tints it, no hue keeps it neutral. */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../src/components/forms/button.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const ORANGE_SOLID = "rgb(237, 137, 38)";
const ORANGE_FG = "rgb(123, 52, 30)";
const GRAY_200 = "rgb(226, 232, 240)";

afterEach(cleanup);

const style = (name: string) => getComputedStyle(screen.getByRole("button", { name }));

describe("an outline button", () => {
  describe("given the orange colour palette", () => {
    /** @scenario "An outline button with a hue draws its border and label in that hue" */
    it("draws the orange border and label", () => {
      renderWithDesignSystem(
        <Button variant="outline" colorPalette="orange" size="sm">
          Contact us to upgrade
        </Button>,
      );

      expect(style("Contact us to upgrade").borderTopColor).toBe(ORANGE_SOLID);
      expect(style("Contact us to upgrade").color).toBe(ORANGE_FG);
    });
  });

  describe("given no colour palette or the gray one", () => {
    /** @scenario "An outline button without a hue stays neutral" */
    it("keeps the neutral border and label", () => {
      renderWithDesignSystem(
        <>
          <Button variant="outline" size="sm">
            Manage seats
          </Button>
          <Button variant="outline" colorPalette="gray" size="sm">
            Manage subscription
          </Button>
        </>,
      );

      for (const name of ["Manage seats", "Manage subscription"]) {
        expect(style(name).borderTopColor).toBe(GRAY_200);
        expect(style(name).color).not.toBe(ORANGE_FG);
      }
    });
  });
});
