// @vitest-environment jsdom
// Spec: packages/design-system/specs/enterprise-badge.feature

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EnterpriseBadge } from "../src/components/brand/enterprise-badge.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("EnterpriseBadge", () => {
  describe("given the Enterprise badge", () => {
    /** @scenario The badge reads Enterprise and names the plan when asked */
    it("reads Enterprise with no mark and names the plan in its title", () => {
      const { container } = renderWithDesignSystem(<EnterpriseBadge />);
      expect(screen.getByText("Enterprise").getAttribute("title")).toBe("Enterprise plan feature");
      expect(container.querySelector("svg")).toBeNull();
    });
  });

  describe("given the compact Enterprise badge", () => {
    /** @scenario The compact badge on a menu row is a lock named Enterprise */
    it("shows a lock with no text and is named Enterprise", () => {
      renderWithDesignSystem(<EnterpriseBadge compact />);
      const lock = screen.getByLabelText("Enterprise");
      expect(lock.tagName.toLowerCase()).toBe("svg");
      expect(lock.parentElement?.textContent).toBe("");
    });
  });
});
