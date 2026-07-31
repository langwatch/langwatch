/**
 * Real-Chromium QA for the section shell's narrow-viewport layout.
 *
 * The behaviour is entirely a media query: the rail is a fixed 220px
 * column from `md` up and a full-width strip below it. jsdom evaluates no
 * media queries, so a jsdom assertion on the responsive values can only
 * ever restate the props — it passes whether or not the breakpoint works.
 * This drives a real browser at two widths and measures the boxes.
 *
 * @see specs/navigation/shared-section-navigation-layout.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SectionNavigationFrame } from "../SectionNavigationLayout";

afterEach(() => cleanup());

function renderFrame() {
  render(
    <MemoryRouter initialEntries={["/automations"]}>
      <ChakraProvider value={defaultSystem}>
        <SectionNavigationFrame
          sectionLabel="Automations"
          navigationItems={[
            { label: "Overview", href: "/automations" },
            { label: "Alerts", href: "/automations/alerts" },
            { label: "Runs", href: "/automations/runs" },
            { label: "Settings", href: "/automations/settings" },
          ]}
        >
          <div style={{ width: "1200px" }}>Wide page content</div>
        </SectionNavigationFrame>
      </ChakraProvider>
    </MemoryRouter>,
  );
  return {
    nav: screen.getByRole("navigation", { name: "Automations navigation" }),
    content: screen.getByTestId("section-navigation-content"),
  };
}

describe("SectionNavigationFrame in real Chromium", () => {
  describe("given a phone-width viewport", () => {
    /** @scenario "The local navigation stops taking a column on a narrow viewport" */
    it("stacks the navigation above the content and leaves it the full width", async () => {
      await page.viewport(390, 900);
      const { nav, content } = renderFrame();

      const navBox = nav.getBoundingClientRect();
      const contentBox = content.getBoundingClientRect();

      // Stacked, not columned: the rail ends before the content begins.
      expect(navBox.bottom).toBeLessThanOrEqual(contentBox.top + 1);

      // The content column is what the fixed rail used to starve. It gets
      // essentially the whole page now, rather than the handful of pixels
      // left over beside a 220px rail.
      expect(contentBox.width).toBeGreaterThan(300);
      expect(Math.abs(navBox.width - contentBox.width)).toBeLessThan(2);

      // The links scroll sideways instead of pushing the content down.
      const strip = screen.getByTestId("section-navigation-links");
      expect(getComputedStyle(strip).overflowX).toBe("auto");
      expect(getComputedStyle(strip).flexDirection).toBe("row");
    });

    it("hides the section label, which the page heading already carries", async () => {
      await page.viewport(390, 900);
      renderFrame();
      expect(screen.getByTestId("section-navigation-title")).not.toBeVisible();
    });
  });

  describe("given a desktop viewport", () => {
    /** @scenario "The local navigation stops taking a column on a narrow viewport" */
    it("keeps the rail beside the content at its fixed width", async () => {
      await page.viewport(1400, 900);
      const { nav, content } = renderFrame();

      const navBox = nav.getBoundingClientRect();
      const contentBox = content.getBoundingClientRect();

      expect(navBox.width).toBeCloseTo(220, 0);
      // Side by side: the content starts to the right of the rail, on the
      // same row.
      expect(contentBox.left).toBeGreaterThan(navBox.right - 1);
      expect(navBox.top).toBeCloseTo(contentBox.top, 0);
      expect(screen.getByTestId("section-navigation-title")).toBeVisible();
    });
  });
});
