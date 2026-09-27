/**
 * @vitest-environment jsdom
 * @see specs/features/agents/connected-agents-ui.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectedAgentBrowser } from "../../../model/agent-client.ts";

const turns: unknown[] = [];

vi.mock("../../../behavior/agent-api.ts", async () => {
  const { useState } = await import("react");
  return {
    agentApi: {
      agents: {
        testTurn: {
          useMutation: () => {
            const [data, setData] = useState<unknown>(undefined);
            return {
              mutate: (input: unknown) => {
                turns.push(input);
                setData({
                  output: "Hello from the agent",
                  durationMs: 42,
                  instance: { hostname: "worker-7", label: "blue" },
                });
              },
              data,
              error: null,
              isPending: false,
            };
          },
        },
      },
    },
  };
});

vi.mock("../../../behavior/lent-parameter-line-field.tsx", () => ({
  ParameterLineField: () => null,
}));

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { ConnectedAgentDrawer } = await import("../connected-agent-drawer.tsx");
const { OFFLINE_AGENT_TEST_COPY } = await import("../../blocks/connected-agents-section.tsx");

function connectedAgent(overrides: Partial<ConnectedAgentBrowser> = {}): ConnectedAgentBrowser {
  return {
    id: "agent_1",
    name: "support-agent",
    environment: "production",
    hostLabel: null,
    lastSeenAt: null,
    status: "online",
    instances: [
      {
        instanceId: "instance_1",
        hostname: "worker-7",
        username: "service",
        label: "blue",
        pid: 4242,
        sdk: { name: "langwatch", version: "1.0.0", language: "python" },
        inflight: 0,
        maxConcurrency: 4,
        connectedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    ],
    owner: null,
    selectable: true,
    notSelectableReason: null,
    parameters: [
      {
        name: "model",
        type: "string",
        options: ["small", "large"],
        defaultValue: "small",
        description: "Which model answers",
      },
    ],
    config: {},
    ...overrides,
  };
}

function renderDrawer(agent: ConnectedAgentBrowser) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConnectedAgentDrawer
        agent={agent}
        isLoading={false}
        projectId="project_1"
        onClose={vi.fn()}
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  turns.length = 0;
});

describe("the connected agent drawer", () => {
  describe("given a connected agent that declares a parameter", () => {
    /** @scenario "The drawer lists the parameters the agent declares" */
    it("names the parameter, its type, its options and its default, with no description column", () => {
      renderDrawer(connectedAgent());
      const table = within(screen.getByTestId("connected-agent-parameters"));

      expect(table.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
        "Name",
        "Type",
        "Options",
        "Default",
      ]);
      expect(table.getByRole("row", { name: /model/ })).toHaveTextContent(
        "modelstringsmall, largesmall",
      );
    });
  });

  describe("given a connected agent with one connected instance", () => {
    /** @scenario "The drawer lists the instances that hold the agent" */
    it("names the hostname, the label, the process id and when it connected", () => {
      renderDrawer(connectedAgent());
      const table = within(screen.getByTestId("connected-agent-instances"));

      expect(table.getByRole("row", { name: /worker-7/ })).toHaveTextContent(
        "worker-7blue42425 minutes ago",
      );
    });
  });

  describe("given any connected agent", () => {
    /** @scenario "The drawer edits nothing the process registered" */
    it("offers no field for its name, environment or parameters, and closes from the bottom right", () => {
      renderDrawer(connectedAgent());

      const values = screen
        .getAllByRole("textbox")
        .map((input) => (input as HTMLInputElement).value);
      expect(values).not.toContain("support-agent");
      expect(values).not.toContain("production");
      expect(values).not.toContain("model");
      const close = screen.getByTestId("connected-agent-close");
      expect(close.parentElement?.lastElementChild).toBe(close);
    });
  });

  describe("given an offline connected agent", () => {
    /** @scenario "An offline agent says on hover why it cannot be tested" */
    it("explains on hover that the process has to be started", async () => {
      renderDrawer(connectedAgent({ status: "offline", instances: [] }));

      await userEvent
        .setup()
        .hover(screen.getByTestId("agent-test-run").parentElement as HTMLElement);

      expect(await screen.findByText(OFFLINE_AGENT_TEST_COPY)).toBeInTheDocument();
      expect(screen.getByTestId("agent-test-run")).toBeDisabled();
    });
  });

  describe("given an online connected agent", () => {
    /** @scenario "The drawer sends one test turn to the agent" */
    it("sends the typed message and shows the answer with the instance that served it", async () => {
      renderDrawer(connectedAgent());
      const user = userEvent.setup();

      await user.clear(screen.getByTestId("agent-test-message"));
      await user.type(screen.getByTestId("agent-test-message"), "Are you there?");
      await user.click(screen.getByTestId("agent-test-run"));

      expect(turns).toEqual([
        expect.objectContaining({
          id: "agent_1",
          projectId: "project_1",
          message: "Are you there?",
        }),
      ]);
      const result = screen.getByTestId("agent-test-result");
      expect(result).toHaveTextContent("worker-7 (blue) answered in 42 ms");
      expect(result).toHaveTextContent("Hello from the agent");
    });
  });
});
