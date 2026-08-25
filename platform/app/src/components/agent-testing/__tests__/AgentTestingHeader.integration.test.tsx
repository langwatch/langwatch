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
import { AgentTestingHeader } from "../AgentTestingHeader";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderHeader = (
  props: Partial<React.ComponentProps<typeof AgentTestingHeader>> = {},
) =>
  render(<AgentTestingHeader tab="cases" onTabChange={vi.fn()} {...props} />, {
    wrapper: Wrapper,
  });

/** True when `first` stands before `second` in the page. */
const comesBefore = (first: Element, second: Element) =>
  Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

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

    /** @scenario "The header holds the title and the tabs on one line" */
    it("counts the cases and the run plans beside the tab names", () => {
      renderHeader({ casesCount: 12, plansCount: 3 });

      expect(screen.getByRole("tab", { name: /Test cases/ })).toHaveTextContent(
        "12",
      );
      expect(screen.getByRole("tab", { name: /Results/ })).toHaveTextContent(
        "3",
      );
    });

    /** @scenario "The header holds the title and the tabs on one line" */
    it("offers the Test cases tab and the Results tab", () => {
      renderHeader();

      const tabNames = screen.getAllByRole("tab").map((tab) => tab.textContent);
      expect(tabNames).toEqual(["Test cases", "Results"]);
    });

    it("marks the open tab", () => {
      renderHeader({ tab: "results" });

      expect(screen.getByRole("tab", { name: /Results/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("reports the tab a person chooses", async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      renderHeader({ onTabChange });

      await user.click(screen.getByRole("tab", { name: /Results/ }));

      expect(onTabChange).toHaveBeenCalledWith("results");
    });
  });

  describe("given the Test cases tab is open", () => {
    /** @scenario "The header carries no action on either tab" */
    it("offers no action of its own", () => {
      renderHeader({ tab: "cases" });

      // New test case belongs to the panel header, beside the set it files
      // into, so the page header carries nothing here.
      expect(
        screen.queryByRole("button", { name: /New test case/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /New run plan/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the Results tab is open", () => {
    /** @scenario "The header carries no action on either tab" */
    it("offers no action of its own", () => {
      renderHeader({ tab: "results" });

      // New run plan belongs to the Test Runs section header, beside the list
      // it adds to.
      expect(
        screen.queryByRole("button", { name: /New run plan/i }),
      ).not.toBeInTheDocument();
    });
  });
});
