/**
 * @vitest-environment jsdom
 *
 * The drawer that connects an agent from code, opened from the new
 * agent flow.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectFromCodeDrawer } from "../connect-from-code-drawer";

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
}));

// The agent-setup menu reaches the API and the Langy store; the drawer
// only mounts it, so the boundary is mocked here.
vi.mock("@langwatch/trace-web/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: ({ surface }: { surface: string }) => (
    <button data-testid="setup-with-agent" data-surface={surface}>
      Setup via Agent
    </button>
  ),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ConnectFromCodeDrawer />", () => {
  afterEach(cleanup);

  describe("given the drawer is open", () => {
    /** @scenario "The connect drawer leads with the agent setup" */
    it("offers the agent setup for the connect-agent surface first", () => {
      render(<ConnectFromCodeDrawer open />, { wrapper: Wrapper });

      const setup = screen.getByTestId("setup-with-agent");
      expect(setup).toBeInTheDocument();
      expect(setup.dataset.surface).toBe("connectedAgents");
    });

    /** @scenario "The connect drawer offers the snippets and listens" */
    it("offers a Python snippet, a TypeScript snippet and a listening indicator", () => {
      render(<ConnectFromCodeDrawer open />, { wrapper: Wrapper });

      expect(screen.getByText("Python")).toBeInTheDocument();
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(screen.getByText(/@langwatch\.connect_agent/)).toBeInTheDocument();
      expect(screen.getByTestId("connect-agent-listening")).toBeInTheDocument();
    });
  });
});
