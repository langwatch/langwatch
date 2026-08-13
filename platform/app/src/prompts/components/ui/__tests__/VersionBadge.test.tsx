/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VersionBadge } from "../VersionBadge";

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("VersionBadge", () => {
  describe("when not outdated", () => {
    it("renders badge with version number", () => {
      renderWithChakra(<VersionBadge version={3} />);

      // Chakra may render multiple elements in test env
      expect(screen.getAllByText("v3").length).toBeGreaterThan(0);
    });

    it("renders regular badge when latestVersion equals current", () => {
      renderWithChakra(<VersionBadge version={3} latestVersion={3} />);

      expect(screen.getAllByText("v3").length).toBeGreaterThan(0);
    });
  });

  describe("when outdated with onUpgrade", () => {
    it("renders badge with version number", () => {
      const onUpgrade = vi.fn();
      renderWithChakra(
        <VersionBadge version={3} latestVersion={5} onUpgrade={onUpgrade} />,
      );

      expect(screen.getAllByText("v3").length).toBeGreaterThan(0);
    });

    it("renders clickable element with button role", () => {
      const onUpgrade = vi.fn();
      renderWithChakra(
        <VersionBadge version={3} latestVersion={5} onUpgrade={onUpgrade} />,
      );

      // Verify the button role is present for accessibility
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });
  });

  describe("when outdated without onUpgrade", () => {
    it("renders badge (no upgrade action)", () => {
      renderWithChakra(<VersionBadge version={3} latestVersion={5} />);

      // Without onUpgrade, still shows the version
      expect(screen.getAllByText("v3").length).toBeGreaterThan(0);
    });
  });
});
