/**
 * The Agent Testing header is one line: the page title, then the tabs in the middle.
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/page-structure.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentTestingHeader } from "../agent-testing-header.tsx";

const TAB_HREFS = { cases: "/acme/agent-testing", results: "/acme/agent-testing/results" };

const renderHeader = (props: Partial<React.ComponentProps<typeof AgentTestingHeader>> = {}) =>
  renderWithDesignSystem(
    <AgentTestingHeader tab="cases" onTabChange={vi.fn()} tabHrefs={TAB_HREFS} {...props} />,
  );

/** True when `first` stands before `second` in the page. */
const comesBefore = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("<AgentTestingHeader/>", () => {
  afterEach(cleanup);

  describe("given the page is open", () => {
    /** @scenario "The header holds the title and the tabs on one line" */
    it("holds the title, then the tabs", () => {
      renderHeader({ tab: "results" });

      const title = screen.getByRole("heading", { name: "Agent testing" });
      const tabs = screen.getByRole("navigation", { name: "Agent testing pages" });

      expect(comesBefore(title, tabs)).toBe(true);
    });

    /** @scenario "Each tab name carries how many rows it holds" */
    it("counts the scenarios and the run plans beside the tab names", () => {
      renderHeader({ casesCount: 12, plansCount: 3 });

      expect(screen.getByRole("link", { name: /Scenarios/ })).toHaveTextContent("12");
      expect(screen.getByRole("link", { name: /Results/ })).toHaveTextContent("3");
    });

    /** @scenario "The header holds the title and the tabs on one line" */
    it("offers the Scenarios tab and the Results tab", () => {
      renderHeader();

      const tabNames = screen.getAllByRole("link").map((tab) => tab.textContent);
      expect(tabNames).toEqual(["Scenarios", "Results"]);
    });

    it("marks the open tab", () => {
      renderHeader({ tab: "results" });

      expect(screen.getByRole("link", { name: /Results/ })).toHaveAttribute("aria-current", "page");
    });

    it("reports the tab a person chooses", async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      renderHeader({ onTabChange });

      await user.click(screen.getByRole("link", { name: /Results/ }));

      expect(onTabChange).toHaveBeenCalledWith("results");
    });
  });

  describe("given the Scenarios tab is open", () => {
    /** @scenario "The header carries no action on either tab" */
    it("offers no action of its own", () => {
      renderHeader({ tab: "cases" });

      // New scenario belongs to the panel header, beside the set it files
      // into, so the page header carries nothing here.
      expect(screen.queryByRole("button", { name: /New scenario/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New run plan/i })).not.toBeInTheDocument();
    });
  });

  describe("given a run plan is open", () => {
    /** @scenario "The title reads the run plan while one is open" */
    /** @scenario "The page title names the open run plan" */
    it("reads the name of the plan, with what the plan is beside it", () => {
      renderHeader({
        tab: "results",
        openPlan: { name: "Checkout", note: "Run plan" },
      });

      const title = screen.getByRole("heading", { name: "Checkout" });
      expect(title).toBeInTheDocument();
      expect(screen.getByTestId("agent-testing-title-note")).toHaveTextContent("Run plan");
      expect(
        comesBefore(title, screen.getByRole("navigation", { name: "Agent testing pages" })),
      ).toBe(true);
      expect(screen.queryByRole("heading", { name: "Agent testing" })).not.toBeInTheDocument();
    });

    /** @scenario "A long run plan name stays on one line" */
    it("carries the full name on hover and keeps the note whole", () => {
      const name = "Default support-agent · development (Dogfood) vs support-agent · production";
      renderHeader({
        tab: "results",
        openPlan: { name, note: "Run plan" },
      });

      const title = screen.getByTestId("agent-testing-title");
      expect(title).toHaveAttribute("title", name);
      expect(screen.getByTestId("agent-testing-title-note")).toHaveTextContent("Run plan");
    });

    /** @scenario "Leaving the run plan gives the page title back" */
    it("reads the page title again once the plan is left", () => {
      const view = renderHeader({
        tab: "results",
        openPlan: { name: "Checkout", note: "Run plan" },
      });

      view.rerender(
        <AgentTestingHeader
          tab="results"
          onTabChange={vi.fn()}
          tabHrefs={TAB_HREFS}
          openPlan={null}
        />,
      );

      expect(screen.getByRole("heading", { name: "Agent testing" })).toBeInTheDocument();
      expect(screen.queryByTestId("agent-testing-title-note")).not.toBeInTheDocument();
    });
  });

  describe("given the Results tab is open", () => {
    /** @scenario "The header carries no action on either tab" */
    it("offers no action of its own", () => {
      renderHeader({ tab: "results" });

      // New run plan belongs to the Test Runs section header, beside the list
      // it adds to.
      expect(screen.queryByRole("button", { name: /New run plan/i })).not.toBeInTheDocument();
    });
  });
});
