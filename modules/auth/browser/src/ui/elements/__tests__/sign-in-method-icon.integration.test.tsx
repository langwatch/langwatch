/**
 * @vitest-environment jsdom
 * A provider mark carries its own width and height: WebKit draws a size-less svg flex child at 0x0.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BRAND_MARK_SIZE, SignInMethodIcon } from "../sign-in-method-icon.tsx";

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

        const svg = screen.getByTestId("sign-in-method-mark").querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg).toHaveAttribute("width", String(BRAND_MARK_SIZE));
        expect(svg).toHaveAttribute("height", String(BRAND_MARK_SIZE));
      },
    );
  });
});
