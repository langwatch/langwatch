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
import { OFFLINE_AGENT_TEST_COPY } from "~/components/agents/offlineAgentCopy";

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
  ] as unknown[],
  parameterDefaults: {} as Record<string, string | number | boolean>,
  config: {
    sdk: { name: "langwatch-python", version: "1.2.3", language: "python" },
  },
};

/** The parameter set every test starts from; a test may replace it. */
const baseParameters = agentRow.parameters;

// One controllable mock of the user-default mutation: it records the variables
// it was called with, and drives onSuccess or onError so a test can prove the
// drawer keeps the previously saved value when a save is refused.
const setDefaultMutate = vi.fn();
const setDefaultState = { shouldError: false, error: null as unknown };
const getByIdInvalidate = vi.fn();

const testMutate = vi.fn();
const testState = {
  mutate: testMutate,
  isPending: false,
  data: undefined as unknown,
  error: null as unknown,
};

// One stable mock, so a test can assert the drawer was actually closed. A
// fresh `vi.fn()` per `useDrawer()` call records nothing a test can read.
const { closeDrawer } = vi.hoisted(() => ({ closeDrawer: vi.fn() }));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer,
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
      setParameterDefault: {
        useMutation: (opts?: {
          onSuccess?: () => void;
          onError?: (error: unknown) => void;
        }) => ({
          mutate: (vars: unknown) => {
            setDefaultMutate(vars);
            if (setDefaultState.shouldError) {
              opts?.onError?.(setDefaultState.error);
            } else {
              opts?.onSuccess?.();
            }
          },
          isPending: false,
        }),
      },
      testTurn: { useMutation: () => testState },
    },
    useUtils: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: getByIdInvalidate },
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
    setDefaultMutate.mockClear();
    getByIdInvalidate.mockClear();
    setDefaultState.shouldError = false;
    setDefaultState.error = null;
    agentRow.status = "online";
    agentRow.parameters = baseParameters;
    agentRow.parameterDefaults = {};
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
      const user = userEvent.setup();
      closeDrawer.mockClear();
      await renderDrawer();

      const close = await screen.findByTestId("connected-agent-close");
      expect(close).toHaveTextContent("Close");
      // The test message is the only field; the name, the environment and the
      // parameters are read from the code.
      expect(screen.getAllByRole("textbox")).toHaveLength(1);

      await user.click(close);
      expect(closeDrawer).toHaveBeenCalled();
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
        OFFLINE_AGENT_TEST_COPY,
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

  describe("when the owner edits a parameter's default and saves", () => {
    /** @scenario "A user sets a default value in the drawer and it applies to new runs" */
    it("writes the user default for that one parameter and refreshes", async () => {
      const user = userEvent.setup();
      await renderDrawer();

      const editor = await screen.findByTestId(
        "connected-agent-parameter-default-model",
      );
      await user.selectOptions(editor, "gpt-5");
      await user.click(
        screen.getByTestId("connected-agent-parameter-save-model"),
      );

      expect(setDefaultMutate).toHaveBeenCalledWith({
        projectId: "project_1",
        id: "agent_1",
        name: "model",
        value: "gpt-5",
      });
      expect(getByIdInvalidate).toHaveBeenCalled();
    });
  });

  describe("given a user default whose parameter the code no longer declares", () => {
    /** @scenario "A reconnect with a removed parameter shows the override as stale" */
    it("renders a stale row with the stored value and a way to clear it", async () => {
      agentRow.parameterDefaults = { plan: "pro" };
      await renderDrawer();

      const badge = await screen.findByTestId(
        "connected-agent-parameter-stale-plan",
      );
      expect(badge).toHaveTextContent("Stale");
      const table = screen.getByTestId("connected-agent-parameters");
      expect(table).toHaveTextContent("plan");
      expect(table).toHaveTextContent("pro");
      expect(
        screen.getByTestId("connected-agent-parameter-reset-plan"),
      ).toBeInTheDocument();
    });
  });

  describe("given a secret parameter", () => {
    /** @scenario "A secret parameter cannot have a user default" */
    it("shows its default read-only with no edit control", async () => {
      agentRow.parameters = [{ name: "token", type: "string", secret: true }];
      await renderDrawer();

      expect(
        await screen.findByTestId("connected-agent-parameter-secret-token"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("connected-agent-parameter-default-token"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when a save is refused by the server", () => {
    /** @scenario "An invalid user-supplied value is rejected at save time" */
    it("shows the error inline and does not refresh the read", async () => {
      const user = userEvent.setup();
      setDefaultState.shouldError = true;
      setDefaultState.error = {
        code: "agent_parameter_default_invalid",
        message: "agent_parameter_default_invalid",
      };
      await renderDrawer();

      const editor = await screen.findByTestId(
        "connected-agent-parameter-default-model",
      );
      await user.selectOptions(editor, "gpt-5");
      await user.click(
        screen.getByTestId("connected-agent-parameter-save-model"),
      );

      expect(
        await screen.findByTestId("connected-agent-parameter-error-model"),
      ).toBeInTheDocument();
      // The previously saved value is untouched: no read is invalidated, so the
      // rejected value is never shown as if it had been accepted.
      expect(getByIdInvalidate).not.toHaveBeenCalled();
    });
  });
});
