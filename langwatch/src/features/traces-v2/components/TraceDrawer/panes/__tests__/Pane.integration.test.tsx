/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pane } from "../Pane";

afterEach(cleanup);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Pane", () => {
  describe("given a default render", () => {
    /** @scenario Each pane has a header bar */
    /** @scenario Pane header uses gray background */
    describe("when mounted", () => {
      it("renders the title in the header toolbar", () => {
        render(
          <Pane title="Visualization">
            <div data-testid="content">body</div>
          </Pane>,
          { wrapper },
        );

        const toolbar = screen.getByRole("toolbar", {
          name: /Visualization pane controls/i,
        });
        expect(within(toolbar).getByText(/visualization/i)).toBeInTheDocument();
        expect(screen.getByTestId("content")).toBeInTheDocument();
      });
    });
  });

  describe("given the user clicks the collapse control", () => {
    /** @scenario Collapsing a pane reduces it to header-only */
    describe("when onToggleCollapsed is wired", () => {
      it("fires the handler", () => {
        const onToggleCollapsed = vi.fn();
        render(
          <Pane title="Details" onToggleCollapsed={onToggleCollapsed}>
            <div>body</div>
          </Pane>,
          { wrapper },
        );

        fireEvent.click(screen.getByLabelText(/Collapse pane/i));
        expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the pane is collapsed", () => {
    /** @scenario Re-expanding a collapsed pane */
    describe("when re-rendered with collapsed=true", () => {
      it("hides the body and switches the chevron label to Expand", () => {
        const { rerender } = render(
          <Pane title="Details" onToggleCollapsed={vi.fn()}>
            <div data-testid="body">body</div>
          </Pane>,
          { wrapper },
        );
        expect(screen.getByTestId("body")).toBeInTheDocument();

        rerender(
          <ChakraProvider value={defaultSystem}>
            <Pane title="Details" collapsed onToggleCollapsed={vi.fn()}>
              <div data-testid="body">body</div>
            </Pane>
          </ChakraProvider>,
        );
        expect(screen.queryByTestId("body")).not.toBeInTheDocument();
        expect(screen.getByLabelText(/Expand pane/i)).toBeInTheDocument();
      });
    });
  });

  describe("given the user double-clicks the header", () => {
    describe("when onToggleCollapsed is wired", () => {
      it("toggles collapse (the maximize gesture was removed)", () => {
        const onToggleCollapsed = vi.fn();
        render(
          <Pane title="Visualization" onToggleCollapsed={onToggleCollapsed}>
            <div>body</div>
          </Pane>,
          { wrapper },
        );

        const toolbar = screen.getByRole("toolbar", {
          name: /Visualization pane controls/i,
        });
        fireEvent.doubleClick(toolbar);
        expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the pane is rendered", () => {
    describe("when checked for a maximize control", () => {
      it("does not render one (removed per operator feedback)", () => {
        render(
          <Pane title="Conversation Context">
            <div>body</div>
          </Pane>,
          { wrapper },
        );

        expect(
          screen.queryByLabelText(/Maximize pane|Restore pane/i),
        ).not.toBeInTheDocument();
      });
    });
  });
});
