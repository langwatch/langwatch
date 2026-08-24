/**
 * @vitest-environment jsdom
 *
 * The Agent Testing header is one line: the page title, then the tabs, then
 * the action of the tab that is open.
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
  render(
    <AgentTestingHeader
      tab="cases"
      onTabChange={vi.fn()}
      onNewTestCase={vi.fn()}
      onNewRunPlan={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper },
  );

/** True when `first` stands before `second` in the page. */
const comesBefore = (first: Element, second: Element) =>
  Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

describe("<AgentTestingHeader/>", () => {
  afterEach(cleanup);

  describe("given the page is open", () => {
    /** @scenario "The header holds the title, the tabs and the actions on one line" */
    it("holds the title, then the tabs, then the action", () => {
      renderHeader();

      const title = screen.getByRole("heading", { name: "Agent Testing" });
      const tabs = screen.getByRole("tablist");
      const action = screen.getByRole("button", { name: /New test case/ });

      expect(comesBefore(title, tabs)).toBe(true);
      expect(comesBefore(tabs, action)).toBe(true);
    });

    /** @scenario "The header holds the title, the tabs and the actions on one line" */
    it("offers the Test cases tab and the Results tab", () => {
      renderHeader();

      const tabNames = screen.getAllByRole("tab").map((tab) => tab.textContent);
      expect(tabNames).toEqual(["Test cases", "Results"]);
    });

    it("marks the open tab", () => {
      renderHeader({ tab: "results" });

      expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("reports the tab a person chooses", async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      renderHeader({ onTabChange });

      await user.click(screen.getByRole("tab", { name: "Results" }));

      expect(onTabChange).toHaveBeenCalledWith("results");
    });
  });

  describe("given the Test cases tab is open", () => {
    /** @scenario "The header action changes with the selected tab" */
    it("offers New test case and not New run plan", () => {
      renderHeader({ tab: "cases" });

      expect(
        screen.getByRole("button", { name: /New test case/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /New run plan/ }),
      ).not.toBeInTheDocument();
    });

    it("reports a new test case", async () => {
      const user = userEvent.setup();
      const onNewTestCase = vi.fn();
      renderHeader({ tab: "cases", onNewTestCase });

      await user.click(screen.getByRole("button", { name: /New test case/ }));

      expect(onNewTestCase).toHaveBeenCalledOnce();
    });
  });

  describe("given the Results tab is open", () => {
    /** @scenario "The header action changes with the selected tab" */
    it("offers New run plan and no longer offers New test case", () => {
      renderHeader({ tab: "results" });

      expect(
        screen.getByRole("button", { name: /New run plan/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /New test case/ }),
      ).not.toBeInTheDocument();
    });

    it("reports a new run plan", async () => {
      const user = userEvent.setup();
      const onNewRunPlan = vi.fn();
      renderHeader({ tab: "results", onNewRunPlan });

      await user.click(screen.getByRole("button", { name: /New run plan/ }));

      expect(onNewRunPlan).toHaveBeenCalledOnce();
    });
  });
});
