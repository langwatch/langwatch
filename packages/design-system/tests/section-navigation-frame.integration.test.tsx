// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
        <SectionNavigationFrame
          label="Section"
          links={LINKS}
          activeHref="/section"
          onNavigate={() => {}}
        >
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
        <SectionNavigationFrame
          label="Section"
          links={LINKS}
          activeHref="/section/details"
          onNavigate={() => {}}
        >
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

  describe("when the reader clicks an entry", () => {
    /** @scenario "A section rail routes its entries in place" */
    it("routes a plain click through onNavigate and leaves a modified click to the browser", () => {
      const onNavigate = vi.fn<(href: string) => void>();
      renderWithDesignSystem(
        <SectionNavigationFrame
          label="Section"
          links={LINKS}
          activeHref="/section"
          onNavigate={onNavigate}
        >
          <p>Page body</p>
        </SectionNavigationFrame>,
      );

      const details = screen.getByRole("link", { name: "Details" });
      const followed = fireEvent.click(details);
      fireEvent.click(details, { metaKey: true });

      expect(followed).toBe(false);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("/section/details");
    });
  });
});
