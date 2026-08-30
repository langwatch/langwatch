/**
 * @vitest-environment jsdom
 *
 * What the agents page shows while no agent is connected from code.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectAgentPanel } from "../ConnectAgentPanel";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ConnectAgentPanel />", () => {
  afterEach(cleanup);

  describe("given the project has no connected agent", () => {
    /** @scenario "The page offers the connect snippets when no agent is connected" */
    it("offers a Python snippet, a TypeScript snippet and a listening indicator", () => {
      render(<ConnectAgentPanel />, { wrapper: Wrapper });

      expect(
        screen.getByText("Connect an agent from code"),
      ).toBeInTheDocument();
      expect(screen.getByText("Python")).toBeInTheDocument();
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(screen.getByText(/@langwatch\.connect_agent/)).toBeInTheDocument();
      expect(screen.getByTestId("connect-agent-listening")).toBeInTheDocument();
    });

    /** @scenario "The connect empty state keeps the way to the other agent kinds" */
    it("keeps a control that opens the new agent flow", () => {
      const onCreateOtherAgent = vi.fn();
      render(<ConnectAgentPanel onCreateOtherAgent={onCreateOtherAgent} />, {
        wrapper: Wrapper,
      });

      const control = screen.getByTestId("connect-agent-other-kinds");
      control.click();
      expect(onCreateOtherAgent).toHaveBeenCalled();
    });
  });
});
