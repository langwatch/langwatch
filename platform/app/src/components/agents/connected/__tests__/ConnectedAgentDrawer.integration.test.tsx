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
    agentRow.status = "online";
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
    });

    /** @scenario "The drawer lists the parameters the agent declares" */
    it("leaves the description of a parameter to the code that declares it", async () => {
      await renderDrawer();

      const table = await screen.findByTestId("connected-agent-parameters");
      expect(table).not.toHaveTextContent("Description");
      expect(table).not.toHaveTextContent("Which model answers");
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
    /** @scenario "The drawer edits nothing the process registered" */
    it("offers no field of its own and closes from the bottom right", async () => {
      await renderDrawer();

      expect(
        await screen.findByTestId("connected-agent-close"),
      ).toHaveTextContent("Close");
      // The test message is the only field; the name, the environment and the
      // parameters are read from the code.
      expect(screen.getAllByRole("textbox")).toHaveLength(1);
    });
  });

  describe("given no process holds the agent", () => {
    /** @scenario "An offline agent says on hover why it cannot be tested" */
    it("says on hover over the Test button that the agent is offline", async () => {
      const user = userEvent.setup();
      agentRow.status = "offline";
      await renderDrawer();

      const test = await screen.findByTestId("agent-test-run");
      expect(test).toBeDisabled();
      await user.hover(test);

      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "This agent is offline",
      );
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
