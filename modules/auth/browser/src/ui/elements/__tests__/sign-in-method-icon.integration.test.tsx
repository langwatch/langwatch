/**
 * @vitest-environment jsdom
 * A provider mark carries its own width and height: WebKit draws a size-less svg flex child at 0x0.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SignInMethodIcon } from "../sign-in-method-icon.tsx";

/** The button's mark box, in px: 18 wide and 18 tall. */
const MARK_BOX = "18";

afterEach(() => cleanup());

describe("given the sign-in screen offers a social provider", () => {
  describe("when its button's mark renders", () => {
    /** @scenario "Every provider mark on a sign-in button declares its own size" */
    it.each(["google", "github", "azure-ad", "microsoft"])(
      "draws the %s mark with a width and height equal to its box",
      (id) => {
        renderWithDesignSystem(
          <SignInMethodIcon method={{ id, kind: "federated", connectionId: null }} />,
        );

        const box = screen.getByTestId("sign-in-method-mark");
        expect(getComputedStyle(box).width).toBe(`${MARK_BOX}px`);
        expect(getComputedStyle(box).height).toBe(`${MARK_BOX}px`);
        const svg = box.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg).toHaveAttribute("width", MARK_BOX);
        expect(svg).toHaveAttribute("height", MARK_BOX);
      },
    );
  });
});
