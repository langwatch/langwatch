/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/shared-section-navigation-layout.feature
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import { AutomationsLayout } from "../automations-layout.tsx";

afterEach(cleanup);

function renderLayout(host = fakeAutomationHost()) {
  return renderWithAutomationHost(
    <AutomationsLayout title="Reports" basePath="/demo/automations" section="reports">
      page content
    </AutomationsLayout>,
    { host },
  );
}

describe("given the Automations workspace", () => {
  describe("when it renders", () => {
    /** @scenario "A rail of page-local destinations stays" */
    it("renders its own local navigation rail", () => {
      renderLayout();

      const nav = screen.getByRole("navigation", { name: "Automations navigation" });
      const links = Array.from(nav.querySelectorAll("a")).map((link) => link.textContent);

      expect(links).toEqual(["Overview", "Automations", "Reports"]);
    });

    it("puts the page's own content in the content column", () => {
      renderLayout();

      expect(screen.getByTestId("section-navigation-content").textContent).toBe("page content");
    });

    it("marks the current tab and routes a click in place through the host", () => {
      const host = fakeAutomationHost();
      renderLayout(host);

      expect(screen.getByRole("link", { name: "Reports" }).getAttribute("aria-current")).toBe(
        "page",
      );
      fireEvent.click(screen.getByRole("link", { name: "Automations" }));

      expect(host.recording.navigations).toEqual(["/demo/automations/automations"]);
    });
  });
});
