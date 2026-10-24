// @vitest-environment jsdom
// Spec: packages/design-system/specs/enterprise-pill.feature

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EnterprisePill } from "../src/components/brand/enterprise-pill.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("EnterprisePill", () => {
  describe("given the Enterprise chip", () => {
    /** @scenario The chip reads ENT and names the plan when asked */
    it("reads ENT with no mark and names the plan in its title", () => {
      const { container } = renderWithDesignSystem(<EnterprisePill />);
      expect(screen.getByText("ENT").getAttribute("title")).toBe("Enterprise plan feature");
      expect(container.querySelector("svg")).toBeNull();
    });
  });
});
