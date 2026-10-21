// @vitest-environment jsdom
// Spec: packages/design-system/specs/feature-lockup.feature

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FeatureLockup } from "../src/components/brand/feature-lockup.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("FeatureLockup", () => {
  describe("given the Braids lockup", () => {
    /** @scenario The lockup shows the mark and the feature's name in the display face */
    it("sets the name in the display face beside a decorative mark", () => {
      const { container } = renderWithDesignSystem(<FeatureLockup feature="braids" />);
      const name = screen.getByText("Braids");
      expect(getComputedStyle(name).fontFamily).toBe("var(--chakra-fonts-display)");
      const mark = container.querySelector("svg[data-feature='braids']");
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("given the Braids lockup with its tagline", () => {
    /** @scenario The lockup shows the launch tagline when asked */
    it("shows the tagline", () => {
      renderWithDesignSystem(<FeatureLockup feature="braids" tagline />);
      expect(screen.getByText("One trace. Every project.")).toBeTruthy();
    });

    it("leaves the tagline out by default", () => {
      renderWithDesignSystem(<FeatureLockup feature="braids" />);
      expect(screen.queryByText("One trace. Every project.")).toBeNull();
    });
  });

  describe("given the Braids lockup at its small size", () => {
    /** @scenario The small lockup draws the mark's small master */
    it("draws the small master", () => {
      const { container } = renderWithDesignSystem(<FeatureLockup feature="braids" size="sm" />);
      expect(container.querySelector("svg[data-feature]")?.getAttribute("data-master")).toBe(
        "small",
      );
    });
  });
});
