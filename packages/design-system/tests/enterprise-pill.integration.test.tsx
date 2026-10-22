// @vitest-environment jsdom
// Spec: packages/design-system/specs/enterprise-pill.feature

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EnterprisePill } from "../src/components/brand/enterprise-pill.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("EnterprisePill", () => {
  describe("given the Enterprise pill for Braids", () => {
    /** @scenario The pill shows the word Enterprise beside the feature's mark in one colour */
    it("shows the word beside a decorative one-colour mark", () => {
      const { container } = renderWithDesignSystem(<EnterprisePill feature="braids" />);
      expect(screen.getByText("Enterprise")).toBeTruthy();
      const mark = container.querySelector("svg[data-feature='braids']");
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
      expect(mark?.getAttribute("data-variant")).toBe("mono");
    });
  });

  describe("given the Enterprise pill with no feature", () => {
    /** @scenario The pill without a feature is the word alone */
    it("shows the word with no mark", () => {
      const { container } = renderWithDesignSystem(<EnterprisePill />);
      expect(screen.getByText("Enterprise")).toBeTruthy();
      expect(container.querySelector("svg")).toBeNull();
    });
  });
});
