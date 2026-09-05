/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/shared-section-navigation-layout.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationsLayout } from "../automations-layout";

afterEach(cleanup);

function renderLayout() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AutomationsLayout basePath="/demo/automations">page content</AutomationsLayout>
    </ChakraProvider>,
  );
}

describe("given the Automations workspace", () => {
  describe("when it renders", () => {
    /** @scenario "A rail of page-local destinations stays" */
    it("renders its own local navigation rail", () => {
      renderLayout();

      const nav = screen.getByRole("navigation", { name: "Automations navigation" });
      const links = Array.from(nav.querySelectorAll("a")).map((link) => link.textContent);

      expect(links).toEqual(["Overview", "Automations", "Alerts", "Schedules"]);
    });

    it("puts the page's own content in the content column", () => {
      renderLayout();

      expect(screen.getByTestId("section-navigation-content").textContent).toBe("page content");
    });
  });
});
