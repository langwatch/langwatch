// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SectionNavigationFrame } from "../src/components/section-navigation-frame.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

const LINKS = [
  { label: "Overview", href: "/section" },
  { label: "Details", href: "/section/details" },
];

describe("SectionNavigationFrame", () => {
  describe("given the links it is handed and the page it frames", () => {
    it("renders each link to its address beside the content", () => {
      renderWithDesignSystem(
        <SectionNavigationFrame label="Section" links={LINKS} activeHref="/section">
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      const rail = screen.getByRole("navigation", { name: "Section navigation" });
      expect(rail.textContent).toContain("Section");
      expect(screen.getByRole("link", { name: "Details" }).getAttribute("href")).toBe(
        "/section/details",
      );
      expect(screen.getByText("Page body")).toBeTruthy();
    });

    it("marks only the active entry as the current page", () => {
      renderWithDesignSystem(
        <SectionNavigationFrame label="Section" links={LINKS} activeHref="/section/details">
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      expect(screen.getByRole("link", { name: "Details" }).getAttribute("aria-current")).toBe(
        "page",
      );
      expect(screen.getByRole("link", { name: "Overview" }).hasAttribute("aria-current")).toBe(
        false,
      );
    });
  });
});
