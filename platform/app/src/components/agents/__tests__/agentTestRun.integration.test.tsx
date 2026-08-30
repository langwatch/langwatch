/**
 * @vitest-environment jsdom
 *
 * "Test agent" from the agents page: the menu item on a card and on a
 * connected row, the run it schedules, and the run drawer it opens.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { AgentCard } from "../AgentCard";
import { useAgentTestRun } from "../useAgentTestRun";

const openDrawer = vi.fn();
const testRunMutate = vi.fn();
const showErrorToast = vi.fn();
let mutationOptions: {
  onSuccess?: (data: { scenarioRunId: string; batchRunId: string }) => void;
  onError?: (error: unknown) => void;
} = {};

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer,
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

vi.mock("~/features/errors", () => ({
  showErrorToast: (args: unknown) => showErrorToast(args),
}));

vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      testRun: {
        useMutation: (options: typeof mutationOptions) => {
          mutationOptions = options;
          return { mutate: testRunMutate, isPending: false };
        },
      },
    },
  },
}));

vi.mock("~/features/langy/components/LangyContextTarget", () => ({
  LangyContextTarget: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

const httpAgent = {
  id: "agent_http",
  name: "ACME Support Agent",
  type: "http",
  config: {},
  updatedAt: new Date("2026-08-30T09:00:00Z"),
  createdAt: new Date("2026-08-30T09:00:00Z"),
  copiedFromAgentId: null,
} as unknown as TypedAgent;

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** The agents page wiring in miniature: the card hands its id to the hook. */
function renderCardWithTestRun() {
  function Page() {
    const { testAgent } = useAgentTestRun({ projectId: "project_1" });
    return (
      <AgentCard agent={httpAgent} onTest={() => testAgent(httpAgent.id)} />
    );
  }
  return render(<Page />, { wrapper: Wrapper });
}

describe("Test agent from the agents page", () => {
  beforeEach(() => {
    openDrawer.mockClear();
    testRunMutate.mockClear();
    showErrorToast.mockClear();
    mutationOptions = {};
  });
  afterEach(cleanup);

  describe("when Test agent is chosen from the card menu", () => {
    /** @scenario "The card menu offers Test agent and opens the run drawer" */
    it("requests a test run for the agent and opens the run drawer on the run it answered", async () => {
      const user = userEvent.setup();
      renderCardWithTestRun();

      await user.click(screen.getByLabelText("Actions for ACME Support Agent"));
      await user.click(await screen.findByTestId("agent-test-agent_http"));

      expect(testRunMutate).toHaveBeenCalledWith({
        projectId: "project_1",
        agentId: "agent_http",
      });

      mutationOptions.onSuccess?.({
        scenarioRunId: "run_1",
        batchRunId: "batch_1",
      });
      expect(openDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
        urlParams: { scenarioRunId: "run_1" },
      });
    });

    /** @scenario "A refused test run is explained in the words of the registry" */
    it("hands a refusal to the error toast, never a raw message", async () => {
      const user = userEvent.setup();
      renderCardWithTestRun();

      await user.click(screen.getByLabelText("Actions for ACME Support Agent"));
      await user.click(await screen.findByTestId("agent-test-agent_http"));
      const refusal = new Error("agent_test_refused");
      mutationOptions.onError?.(refusal);

      expect(showErrorToast).toHaveBeenCalledWith(
        expect.objectContaining({ error: refusal }),
      );
      expect(openDrawer).not.toHaveBeenCalled();
    });
  });

  describe("when Test agent is chosen from a connected row", () => {
    /** @scenario "The connected agent row offers Test agent" */
    it("requests a test run for that agent", async () => {
      const user = userEvent.setup();
      const { ConnectedAgentsSection } = await import(
        "../connected/ConnectedAgentsSection"
      );
      const onTest = vi.fn();
      render(
        <ConnectedAgentsSection
          agents={[
            {
              id: "agent_conn",
              name: "support-agent",
              type: "connected",
              environment: "production",
              hostLabel: null,
              lastSeenAt: null,
              status: "online",
              owner: null,
              instances: [],
              parameters: [],
              config: { description: "" },
            } as never,
          ]}
          onOpen={vi.fn()}
          onTest={onTest}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByLabelText("Actions for support-agent"));
      await user.click(await screen.findByTestId("agent-test-agent_conn"));

      expect(onTest).toHaveBeenCalledWith(
        expect.objectContaining({ id: "agent_conn" }),
      );
    });
  });
});
