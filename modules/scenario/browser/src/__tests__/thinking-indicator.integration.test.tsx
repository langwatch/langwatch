/**
 * Integration tests for the ThinkingIndicator component. Verifies the three-dot
 * animated indicator renders correctly with proper alignment and accessibility.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThinkingIndicator } from "../ui/elements/thinking-indicator.tsx";

describe("<ThinkingIndicator/>", () => {
  afterEach(cleanup);

  describe("when rendered", () => {
    it("renders three dots", () => {
      renderWithDesignSystem(<ThinkingIndicator />);

      const dots = screen.getAllByText("●");
      expect(dots).toHaveLength(3);
    });

    it("has an accessible status label", () => {
      renderWithDesignSystem(<ThinkingIndicator />);

      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("is left-aligned", () => {
      renderWithDesignSystem(<ThinkingIndicator />);

      const container = screen.getByRole("status");
      expect(container).toHaveStyle({ justifyContent: "flex-start" });
    });
  });
});
