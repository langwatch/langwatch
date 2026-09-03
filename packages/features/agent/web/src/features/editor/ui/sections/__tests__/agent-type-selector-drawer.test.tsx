/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTypeSelectorDrawer } from "../agent-type-selector-drawer";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

function renderDrawer(onSelect = vi.fn()) {
  return {
    onSelect,
    ...render(<AgentTypeSelectorDrawer open={true} onClose={vi.fn()} onSelect={onSelect} />, {
      wrapper: Wrapper,
    }),
  };
}

describe("AgentTypeSelectorDrawer", () => {
  it("renders the available agent types", () => {
    renderDrawer();

    expect(screen.getByText("Choose Agent Connection Type")).toBeTruthy();
    expect(screen.getByText("Code Agent")).toBeTruthy();
    expect(screen.getByText("Workflow Agent")).toBeTruthy();
    expect(screen.getByText("HTTP Agent")).toBeTruthy();
    expect(screen.queryByText("Prompt Agent")).toBeNull();
  });

  it("reports the selected type", async () => {
    const { onSelect } = renderDrawer();

    fireEvent.click(screen.getByTestId("agent-type-code"));

    expect(onSelect).toHaveBeenCalledWith("code");
  });

  it("reports workflow selection", async () => {
    const { onSelect } = renderDrawer();

    fireEvent.click(screen.getByTestId("agent-type-workflow"));

    expect(onSelect).toHaveBeenCalledWith("workflow");
  });

  describe("given the connect-from-code choice leads the list", () => {
    /** @scenario "Connect from code is the first choice of the new agent flow" */
    it("draws Connect from Code first, with the green dot before the words", () => {
      render(
        <AgentTypeSelectorDrawer open={true} onClose={vi.fn()} onConnectFromCode={vi.fn()} />,
        { wrapper: Wrapper },
      );

      const cards = screen.getAllByTestId(/^agent-type-/);
      expect(cards[0]).toHaveAttribute("data-testid", "agent-type-connected");
      expect(screen.getByTestId("agent-type-connected-dot")).toBeTruthy();
      expect(screen.getByText("Connect from Code")).toBeTruthy();
    });

    /** @scenario "Connect from code opens the connect drawer" */
    it("calls onConnectFromCode when clicked, without selecting a stored type", () => {
      const onConnectFromCode = vi.fn();
      const { onSelect } = {
        onSelect: vi.fn(),
      };
      render(
        <AgentTypeSelectorDrawer
          open={true}
          onClose={vi.fn()}
          onSelect={onSelect}
          onConnectFromCode={onConnectFromCode}
        />,
        { wrapper: Wrapper },
      );

      fireEvent.click(screen.getByTestId("agent-type-connected"));

      expect(onConnectFromCode).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
