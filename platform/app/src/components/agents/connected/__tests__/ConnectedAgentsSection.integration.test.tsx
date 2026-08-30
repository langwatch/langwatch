/**
 * @vitest-environment jsdom
 *
 * The connected agents of a project, as the agents page draws them.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function renderSection(
  agents: ConnectedAgentView[],
  handlers: {
    onOpen?: (agent: ConnectedAgentView) => void;
    onDelete?: (agent: ConnectedAgentView) => void;
  } = {},
) {
  return render(
    <ConnectedAgentsSection
      agents={agents}
      onOpen={handlers.onOpen ?? vi.fn()}
      onDelete={handlers.onDelete}
    />,
    { wrapper: Wrapper },
  );
}

describe("<ConnectedAgentsSection />", () => {
  afterEach(cleanup);

  describe("given the same name is registered in two environments", () => {
    /** @scenario "Every connected agent is a card of the agents page" */
    it("draws one card for each and names its environment", () => {
      renderSection([
        agent({ id: "agent_1", environment: "production" }),
        agent({ id: "agent_2", environment: "development", status: "offline" }),
      ]);

      expect(
        screen.getByTestId("connected-agent-card-agent_1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("connected-agent-card-agent_2"),
      ).toBeInTheDocument();
      expect(screen.getAllByText("support-agent")).toHaveLength(2);
      expect(screen.getByText("production")).toBeInTheDocument();
      expect(screen.getByText("development")).toBeInTheDocument();
    });

    /** @scenario "The environment reads in a colour of its own" */
    it("draws each environment in the colour of that environment", () => {
      renderSection([
        agent({ id: "agent_1", environment: "production" }),
        agent({ id: "agent_2", environment: "development" }),
        agent({ id: "agent_3", environment: "staging" }),
      ]);

      const classOf = (environment: string) =>
        screen.getByText(environment).className;
      expect(classOf("production")).not.toEqual(classOf("development"));
      expect(classOf("staging")).not.toEqual(classOf("production"));
      expect(classOf("staging")).not.toEqual(classOf("development"));
    });
  });

  describe("given three processes hold one agent", () => {
    /** @scenario "An online agent reads how many instances hold it" */
    it("marks the card online and reads the instance count", () => {
      renderSection([
        agent({ instances: [instance(), instance(), instance()] }),
      ]);

      expect(
        screen.getByTestId("connected-agent-status-online"),
      ).toHaveAttribute("aria-label", "Online · 3 instances");
      expect(
        screen.getByText("langwatch-python 1.2.3 · 3 instances"),
      ).toBeInTheDocument();
    });
  });

  describe("given one process holds the agent", () => {
    /** @scenario "An agent with one instance reads it in the singular" */
    it("reads one instance in the singular", () => {
      renderSection([agent({ instances: [instance()] })]);

      expect(
        screen.getByTestId("connected-agent-status-online"),
      ).toHaveAttribute("aria-label", "Online · 1 instance");
    });
  });

  describe("given no process holds the agent", () => {
    /** @scenario "An offline agent reads when it was last seen" */
    it("marks the card offline and reads when it was last seen", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      renderSection([
        agent({ status: "offline", instances: [], lastSeenAt: twoHoursAgo }),
      ]);

      expect(
        screen.getByTestId("connected-agent-status-offline"),
      ).toHaveAttribute("aria-label", "Offline · last seen 2 hours ago");
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
    /** @scenario "A card names the SDK and the parameters the agent declares" */
    it("names the SDK, its version and the parameter", () => {
      renderSection([
        agent({
          parameters: [
            { name: "model", type: "string", options: ["gpt-5", "gpt-5-mini"] },
          ],
        }),
      ]);

      expect(
        screen.getByText("langwatch-python 1.2.3 · 1 instance"),
      ).toBeInTheDocument();
      expect(screen.getByText("model")).toBeInTheDocument();
    });
  });

  describe("when the card is clicked", () => {
    /** @scenario "A click on the card opens the connected agent" */
    it("opens the agent it stands for", async () => {
      const onOpen = vi.fn();
      renderSection([agent()], { onOpen });

      await userEvent.click(screen.getByTestId("connected-agent-card-agent_1"));

      expect(onOpen).toHaveBeenCalledWith(
        expect.objectContaining({ id: "agent_1" }),
      );
    });
  });

  describe("when the menu of the card is opened", () => {
    /** @scenario "The card menu opens the agent and deletes it" */
    it("offers to open and to delete the agent, above the card", async () => {
      const onOpen = vi.fn();
      const onDelete = vi.fn();
      renderSection([agent()], { onOpen, onDelete });

      await userEvent.click(
        screen.getByRole("button", { name: "Actions for support-agent" }),
      );

      expect(
        await screen.findByRole("menuitem", { name: "Open" }),
      ).toBeInTheDocument();
      const remove = screen.getByRole("menuitem", { name: "Delete" });
      // The menu floats over the cards: it is drawn outside the card, so the
      // card can never cut it.
      const card = screen.getByTestId("connected-agent-card-agent_1");
      expect(within(card).queryByRole("menuitem")).toBeNull();

      await userEvent.click(remove);
      expect(onDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: "agent_1" }),
      );
      expect(onOpen).not.toHaveBeenCalled();
    });
  });
});
