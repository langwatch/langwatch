/**
 * @vitest-environment jsdom
 *
 * The drawer of one connected agent: what it accepts, which processes hold
 * it, and one test turn.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 * @see specs/agents/agent-test-run.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentRow = {
  id: "agent_1",
  name: "support-agent",
  type: "connected",
  environment: "production",
  hostLabel: null,
  lastSeenAt: null,
  status: "online",
  owner: null,
  instances: [
    {
      instanceId: "inst_1",
      hostname: "build-box",
      username: "runner",
      pid: 4242,
      label: "eu-pod",
      sdk: { name: "langwatch-python", version: "1.2.3", language: "python" },
      connectedAt: new Date("2026-08-30T09:00:00Z"),
      inflight: 0,
      maxConcurrency: 4,
    },
  ],
  parameters: [
    {
      name: "model",
      type: "string",
      options: ["gpt-5", "gpt-5-mini"],
      defaultValue: "gpt-5-mini",
      description: "Which model answers",
    },
  ],
  config: {
    description: "Answers support questions",
    sdk: { name: "langwatch-python", version: "1.2.3", language: "python" },
  },
};

const testMutate = vi.fn();
const testState = {
  mutate: testMutate,
  isPending: false,
  data: undefined as unknown,
  error: null as unknown,
};

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => true),
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => ({ agentId: "agent_1" }),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "project" },
    organization: { id: "org_1" },
    team: null,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getById: {
        useQuery: () => ({ data: agentRow, isLoading: false, error: null }),
      },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      testTurn: { useMutation: () => testState },
    },
    useUtils: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

async function renderDrawer() {
  const { ConnectedAgentDrawer } = await import("../ConnectedAgentDrawer");
  return render(<ConnectedAgentDrawer />, { wrapper: Wrapper });
}

describe("<ConnectedAgentDrawer />", () => {
  beforeEach(() => {
    testState.data = undefined;
    testState.error = null;
    testMutate.mockClear();
  });
  afterEach(cleanup);

  describe("given a connected agent that declares a parameter", () => {
    /** @scenario "The drawer lists the parameters the agent declares" */
    it("names the parameter, its type, its options and its default", async () => {
      await renderDrawer();

      await waitFor(() =>
        expect(
          screen.getByTestId("connected-agent-parameters"),
        ).toBeInTheDocument(),
      );
      const table = screen.getByTestId("connected-agent-parameters");
      expect(table).toHaveTextContent("model");
      expect(table).toHaveTextContent("string");
      expect(table).toHaveTextContent("gpt-5, gpt-5-mini");
      expect(table).toHaveTextContent("gpt-5-mini");
      expect(table).toHaveTextContent("Which model answers");
    });
  });

  describe("given one process holds the agent", () => {
    /** @scenario "The drawer lists the instances that hold the agent" */
    it("names the hostname, the label, the process id and when it connected", async () => {
      await renderDrawer();

      const table = await screen.findByTestId("connected-agent-instances");
      expect(table).toHaveTextContent("build-box");
      expect(table).toHaveTextContent("eu-pod");
      expect(table).toHaveTextContent("4242");
    });
  });

  describe("given the agent was registered from code", () => {
    /** @scenario "The drawer edits the description and nothing else" */
    it("offers the description and no field for the name, the environment or the parameters", async () => {
      await renderDrawer();

      expect(
        await screen.findByTestId("connected-agent-save-description"),
      ).toBeInTheDocument();
      const textboxes = screen.getAllByRole("textbox");
      // The description and the test message are the only two fields; the
      // name, the environment and the parameters are read from the code.
      expect(textboxes).toHaveLength(2);
    });
  });

  describe("when the test panel is opened", () => {
    /** @scenario "The connected agent drawer sends one test turn" */
    /** @scenario "The drawer sends one test turn to the agent" */
    it("reads ping, and sends the turn and shows the answer with the instance that served it", async () => {
      const user = userEvent.setup();
      const { rerender } = await renderDrawer();

      const input = await screen.findByTestId("agent-test-message");
      expect(input).toHaveValue("ping");
      await user.click(screen.getByTestId("agent-test-run"));
      expect(testMutate).toHaveBeenCalledWith({
        id: "agent_1",
        projectId: "project_1",
        message: "ping",
      });

      await user.clear(input);
      await user.type(input, "hi there");
      await user.click(screen.getByTestId("agent-test-run"));
      expect(testMutate).toHaveBeenLastCalledWith({
        id: "agent_1",
        projectId: "project_1",
        message: "hi there",
      });

      testState.data = {
        output: "Hello back",
        instance: { hostname: "build-box", label: "eu-pod" },
        durationMs: 120,
      };
      const { ConnectedAgentDrawer } = await import("../ConnectedAgentDrawer");
      rerender(
        <ChakraProvider value={defaultSystem}>
          <ConnectedAgentDrawer />
        </ChakraProvider>,
      );

      const result = await screen.findByTestId("agent-test-result");
      expect(result).toHaveTextContent("Hello back");
      expect(result).toHaveTextContent("build-box (eu-pod)");
    });
  });
});
