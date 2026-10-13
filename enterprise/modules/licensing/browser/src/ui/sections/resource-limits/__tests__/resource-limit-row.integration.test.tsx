/**
 * @vitest-environment jsdom
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResourceLimitRow } from "../resource-limit-row.tsx";

describe("ResourceLimitRow", () => {
  describe("when max is provided", () => {
    it("renders label and formatted usage with max", () => {
      renderWithDesignSystem(<ResourceLimitRow label="Members" current={5} max={10} />);

      expect(screen.getByText("Members")).toBeInTheDocument();
      expect(screen.getByText("/ 10")).toBeInTheDocument();
    });

    it("displays 'Unlimited' for large max values (>= 1M)", () => {
      renderWithDesignSystem(<ResourceLimitRow label="Projects" current={3} max={1_000_000} />);

      expect(screen.getByText("Projects")).toBeInTheDocument();
      expect(screen.getByText("/ Unlimited")).toBeInTheDocument();
    });

    it("formats numbers with locale separators", () => {
      renderWithDesignSystem(<ResourceLimitRow label="Messages" current={1000} max={5000} />);

      expect(screen.getByText("Messages")).toBeInTheDocument();
      expect(screen.getByText("/ 5,000")).toBeInTheDocument();
    });
  });

  describe("when max is omitted", () => {
    it("renders count only without slash separator", () => {
      const { container } = renderWithDesignSystem(
        <ResourceLimitRow label="Events" current={42} />,
      );

      expect(screen.getByText("Events")).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(container.textContent).not.toContain("/");
    });
  });
});
