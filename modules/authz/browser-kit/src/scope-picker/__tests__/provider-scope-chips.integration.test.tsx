/** @vitest-environment jsdom */
// Tests System chip for env-var-fed providers.

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderScopeChips } from "../provider-scope-chips.tsx";

afterEach(() => cleanup());

function renderChip(node: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);
}

describe("ProviderScopeChips", () => {
  describe("when no scopes are attached", () => {
    /** @scenario System chip renders for env-var-fed providers */
    it("renders a 'System' chip when system=true", () => {
      renderChip(<ProviderScopeChips scopes={[]} system />);
      expect(screen.getByText("System")).toBeInTheDocument();
    });

    it("renders nothing when system is not set (in-progress drawer state)", () => {
      const { container } = renderChip(<ProviderScopeChips scopes={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when scopes are undefined and system is unset", () => {
      const { container } = renderChip(<ProviderScopeChips />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("when scopes are attached", () => {
    it("renders the scope chip and ignores system flag", () => {
      renderChip(
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
