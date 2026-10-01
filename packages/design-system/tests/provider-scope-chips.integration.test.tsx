/** @vitest-environment jsdom */
// Tests System chip for env-var-fed providers.
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderScopeChips, scopeChipTooltip } from "../src/components/provider-scope-chips.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("ProviderScopeChips", () => {
  describe("when no scopes are attached", () => {
    /** @scenario System chip renders for env-var-fed providers */
    it("renders a 'System' chip when system=true", () => {
      renderWithDesignSystem(<ProviderScopeChips scopes={[]} system />);
      expect(screen.getByText("System")).toBeInTheDocument();
    });

    it("renders nothing when system is not set (in-progress drawer state)", () => {
      const { container } = renderWithDesignSystem(<ProviderScopeChips scopes={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when scopes are undefined and system is unset", () => {
      const { container } = renderWithDesignSystem(<ProviderScopeChips />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("when scopes are attached", () => {
    it("renders the scope chip and ignores system flag", () => {
      renderWithDesignSystem(
        <ProviderScopeChips
          system
          scopes={[{ scopeType: "ORGANIZATION", scopeId: "org-1", name: "Acme" }]}
        />,
      );
      // The Acme chip wins; no System fallback.
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.queryByText("System")).not.toBeInTheDocument();
    });
  });
});

describe("given a set of scope chips", () => {
  describe("when a chip names something", () => {
    it("shows the name and says the kind on hover", () => {
      renderWithDesignSystem(
        <ProviderScopeChips
          scopes={[{ scopeType: "TEAM", scopeId: "team_1", name: "Platform" }]}
        />,
      );

      expect(screen.getByText("Platform")).toBeDefined();
      expect(scopeChipTooltip({ scopeType: "TEAM", name: "Platform" })).toBe("Team: Platform");
    });
  });

  describe("when a caller has the scope type but no name", () => {
    it("falls back to the bare kind rather than an empty chip", () => {
      expect(scopeChipTooltip({ scopeType: "PROJECT" })).toContain("Project");
    });
  });

  describe("when identifying detail would crowd the chip", () => {
    it("moves it into the tooltip after the name", () => {
      expect(scopeChipTooltip({ scopeType: "VIRTUAL_KEY", name: "ci", detail: "lw_sk_ab" })).toBe(
        "Virtual key: ci · lw_sk_ab",
      );
    });
  });
});
