// @vitest-environment jsdom
// Spec: packages/design-system/specs/branded-card.feature

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrandedCard, BrandedCardPage } from "../src/components/branded-card.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BrandedCard", () => {
  describe("given a page rendered inside the branded card", () => {
    /** @scenario "A page under the branded card shows the logo and a centred title" */
    it("shows the logo, the title, the intro and the body", () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("prefers-reduced-motion") && !query.includes("no-preference"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }));

      const { container } = renderWithDesignSystem(
        <BrandedCardPage>
          <BrandedCard title="Link not valid" intro="It has expired.">
            <p>Body text</p>
          </BrandedCard>
        </BrandedCardPage>,
      );

      expect(screen.getByRole("heading", { name: "Link not valid" })).toBeTruthy();
      expect(screen.getByText("It has expired.")).toBeTruthy();
      expect(screen.getByText("Body text")).toBeTruthy();
      expect(container.querySelector("svg")).not.toBeNull();
    });
  });

  describe("given a page that brings its own ground", () => {
    it("draws that ground under the card instead of the ambient one", () => {
      renderWithDesignSystem(
        <BrandedCardPage ground={<div data-testid="own-ground" />}>
          <BrandedCard title="Forgot your password?" />
        </BrandedCardPage>,
      );

      expect(screen.getByTestId("own-ground")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Forgot your password?" })).toBeTruthy();
    });
  });
});
