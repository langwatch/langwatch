/**
 * @vitest-environment jsdom
 *
 * The Agent Testing header is one line: the page title, then the tabs. The
 * actions of each tab sit in the section header above their own table.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTestingHeader } from "../agent-testing-header";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderHeader = (props: Partial<React.ComponentProps<typeof AgentTestingHeader>> = {}) =>
  render(<AgentTestingHeader tab="cases" onTabChange={vi.fn()} {...props} />, {
    wrapper: Wrapper,
  });

/** True when `first` stands before `second` in the page. */
const comesBefore = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The CSS the emitted classes of an element carry, as one string. */
const rulesFor = (element: Element): string => {
  const classes = Array.from(element.classList);
  const texts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(cssRules)) texts.push(rule.cssText);
  }
  for (const style of Array.from(document.querySelectorAll("style"))) {
    texts.push(style.textContent ?? "");
  }
  return texts.filter((text) => classes.some((className) => text.includes(className))).join("\n");
};

describe("<AgentTestingHeader/>", () => {
  afterEach(cleanup);

  describe("given the page is open", () => {
    /** @scenario "The header holds the title and the tabs on one line" */
    it("holds the title, then the tabs", () => {
      renderHeader({ tab: "results" });

      const title = screen.getByRole("heading", { name: "Agent Testing" });
      const tabs = screen.getByRole("tablist");

      expect(comesBefore(title, tabs)).toBe(true);
    });

    /** @scenario "The selected tab is underlined on the header's own border" */
    it("runs the tabs the full height of the header", () => {
      renderHeader({ tab: "results" });

      // The underline is drawn at the foot of the trigger, so a trigger that
      // fills the header puts it on the header's own bottom border. The height
      // is a rule on the emitted class rather than an inline style, so the
      // rules of that class are what the assertion reads.
      const list = screen.getByRole("tablist");
      const tabs = screen.getAllByRole("tab");

      for (const element of [list, ...tabs]) {
        expect(rulesFor(element)).toMatch(/height:\s*(100%|var\(--chakra-sizes-full\))/);
      }
    });

    /** @scenario "Each tab name carries how many rows it holds" */
    it("counts the scenarios and the run plans beside the tab names", () => {
      renderHeader({ casesCount: 12, plansCount: 3 });

      expect(screen.getByRole("tab", { name: /Scenarios/ })).toHaveTextContent("12");
      expect(screen.getByRole("tab", { name: /Results/ })).toHaveTextContent("3");
    });

    /** @scenario "The header holds the title and the tabs on one line" */
    it("offers the Scenarios tab and the Results tab", () => {
      renderHeader();

      const tabNames = screen.getAllByRole("tab").map((tab) => tab.textContent);
      expect(tabNames).toEqual(["Scenarios", "Results"]);
    });

    it("marks the open tab", () => {
      renderHeader({ tab: "results" });

      expect(screen.getByRole("tab", { name: /Results/ })).toHaveAttribute("aria-selected", "true");
    });

    it("reports the tab a person chooses", async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      renderHeader({ onTabChange });

      await user.click(screen.getByRole("tab", { name: /Results/ }));

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
      expect(comesBefore(title, screen.getByRole("tablist"))).toBe(true);
      expect(screen.queryByRole("heading", { name: "Agent Testing" })).not.toBeInTheDocument();
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
    it("reads Agent Testing again once the plan is left", () => {
      const view = renderHeader({
        tab: "results",
        openPlan: { name: "Checkout", note: "Run plan" },
      });

      view.rerender(
        <ChakraProvider value={defaultSystem}>
          <AgentTestingHeader tab="results" onTabChange={vi.fn()} openPlan={null} />
        </ChakraProvider>,
      );

      expect(screen.getByRole("heading", { name: "Agent Testing" })).toBeInTheDocument();
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
