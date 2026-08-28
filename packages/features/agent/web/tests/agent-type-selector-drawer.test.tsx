/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTypeSelectorDrawer } from "../src/features/editor/ui/sections/agent-type-selector-drawer";

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

    expect(screen.getByText("Choose Agent Type")).toBeTruthy();
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
});
