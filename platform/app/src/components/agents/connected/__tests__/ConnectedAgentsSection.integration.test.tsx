/**
 * @vitest-environment jsdom
 *
 * The connected agents of a project, as the agents page draws them.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectedAgentsSection } from "../ConnectedAgentsSection";
import type {
  ConnectedAgentInstance,
  ConnectedAgentView,
} from "../connected-agent-rows";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function instance(
  overrides: Partial<ConnectedAgentInstance> = {},
): ConnectedAgentInstance {
  return {
    instanceId: `inst_${Math.random().toString(36).slice(2)}`,
    hostname: "build-box",
    username: "runner",
    pid: 4242,
    label: null,
    sdk: { name: "langwatch-python", version: "1.2.3", language: "python" },
    connectedAt: new Date("2026-08-30T09:00:00Z"),
    inflight: 0,
    maxConcurrency: 4,
    ...overrides,
  };
}

function agent(
  overrides: Partial<ConnectedAgentView> = {},
): ConnectedAgentView {
  return {
    id: "agent_1",
    name: "support-agent",
    environment: "production",
    hostLabel: null,
    lastSeenAt: null,
    status: "online",
    instances: [instance()],
    owner: null,
    parameters: [],
    config: {
      sdk: { name: "langwatch-python", version: "1.2.3", language: "python" },
    },
    ...overrides,
  };
}

function renderSection(agents: ConnectedAgentView[]) {
  return render(<ConnectedAgentsSection agents={agents} onOpen={vi.fn()} />, {
    wrapper: Wrapper,
  });
}

describe("<ConnectedAgentsSection />", () => {
  afterEach(cleanup);

  describe("given the same name is registered in two environments", () => {
    /** @scenario "Connected agents of one name group under that name" */
    it("holds both rows under one group and names each environment", () => {
      renderSection([
        agent({ id: "agent_1", environment: "production" }),
        agent({ id: "agent_2", environment: "development", status: "offline" }),
      ]);

      const group = screen.getByTestId("connected-agent-group-support-agent");
      expect(group).toBeInTheDocument();
      expect(
        screen.getByTestId("connected-agent-row-agent_1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("connected-agent-row-agent_2"),
      ).toBeInTheDocument();
      expect(screen.getByText("production")).toBeInTheDocument();
      expect(screen.getByText("development")).toBeInTheDocument();
    });
  });

  describe("given three processes hold one agent", () => {
    /** @scenario "An online agent reads how many instances hold it" */
    it("reads Online with the instance count", () => {
      renderSection([
        agent({ instances: [instance(), instance(), instance()] }),
      ]);

      expect(screen.getByText("Online · 3 instances")).toBeInTheDocument();
    });
  });

  describe("given one process holds the agent", () => {
    /** @scenario "An agent with one instance reads it in the singular" */
    it("reads Online with one instance", () => {
      renderSection([agent({ instances: [instance()] })]);

      expect(screen.getByText("Online · 1 instance")).toBeInTheDocument();
    });
  });

  describe("given no process holds the agent", () => {
    /** @scenario "An offline agent reads when it was last seen" */
    it("reads when it was last seen", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      renderSection([
        agent({ status: "offline", instances: [], lastSeenAt: twoHoursAgo }),
      ]);

      expect(
        screen.getByText("Offline · last seen 2 hours ago"),
      ).toBeInTheDocument();
    });
  });

  describe("given a development agent that belongs to a person", () => {
    /** @scenario "A personal development agent reads its owner" */
    it("carries a chip with the owner's name", () => {
      renderSection([
        agent({
          environment: "development",
          owner: { userId: "user_1", name: "Ana" },
        }),
      ]);

      expect(screen.getByText("Ana")).toBeInTheDocument();
    });
  });

  describe("given a development agent that belongs to a machine", () => {
    /** @scenario "A shared development agent reads the machine that holds it" */
    it("carries a chip with the machine name", () => {
      renderSection([
        agent({ environment: "development", hostLabel: "build-box" }),
      ]);

      expect(screen.getByText("build-box")).toBeInTheDocument();
    });
  });

  describe("given the agent declares a parameter", () => {
    /** @scenario "A row names the SDK and the parameters the agent declares" */
    it("names the SDK, its version and the parameter", () => {
      renderSection([
        agent({
          parameters: [
            { name: "model", type: "string", options: ["gpt-5", "gpt-5-mini"] },
          ],
        }),
      ]);

      expect(screen.getByText("langwatch-python 1.2.3")).toBeInTheDocument();
      expect(screen.getByText("model")).toBeInTheDocument();
    });
  });
});
