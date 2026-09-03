/**
 * @vitest-environment jsdom
 *
 * The "Test agent" panel at the bottom of the HTTP and code agent editor
 * drawers: shown for a saved agent, absent for a draft, and sending one turn.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testMutate = vi.fn();
let drawerParams: Record<string, string> = {};

vi.mock("../../../../behavior/next-router", () => ({
  useRouter: () => ({ push: vi.fn(), query: {}, asPath: "/test" }),
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
  useDrawerParams: () => drawerParams,
}));

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1" },
    organization: { id: "org_1" },
    team: { id: "team_1" },
  }),
}));

vi.mock("@langwatch/workflow-web", () => ({
  CodeEditorModal: () => null,
  ComponentIcon: () => null,
  DEFAULT_CODE:
    'class Code:\n    def __call__(self, input: str):\n        return {"output": input}\n',
  getCodeFromConfig: () => "class Code:\n    pass\n",
  buildCodeConfig: ({
    code,
    inputs,
    outputs,
  }: {
    code: string;
    inputs: unknown[];
    outputs: unknown[];
  }) => ({
    name: "Code",
    description: "Python code block",
    parameters: [{ identifier: "code", type: "code", value: code }],
    inputs,
    outputs,
  }),
}));

vi.mock(
  "@langwatch/workflow-web/optimization_studio/components/code/workflow-code-editor.transport",
  () => ({ CodeEditorModal: () => null }),
);

vi.mock("@langwatch/workflow-web/components/blocks/CodeBlockEditor", () => ({
  CodeBlockEditor: () => <div data-testid="code-block-editor" />,
}));

const httpAgent = {
  id: "agent_http",
  name: "ACME Support Agent",
  type: "http",
  config: {
    name: "ACME Support Agent",
    url: "https://acme.example/chat",
    method: "POST",
    headers: [],
    bodyTemplate: '{"input": "{{input}}"}',
    outputPath: "$.output",
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  },
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
};

const codeAgent = {
  id: "agent_code",
  name: "Echo",
  type: "code",
  config: {
    name: "Echo",
    parameters: [{ identifier: "code", type: "code", value: "def execute(input): ..." }],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  },
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
};

vi.mock("../../../../behavior/scenario-api", () => ({
  api: {
    agents: {
      getById: {
        useQuery: (args: { id: string }) => ({
          data:
            args.id === "agent_http" ? httpAgent : args.id === "agent_code" ? codeAgent : undefined,
          isLoading: false,
        }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      testTurn: {
        useMutation: () => ({
          mutate: testMutate,
          isPending: false,
          data: undefined,
          error: null,
        }),
      },
    },
    httpProxy: {
      execute: { useMutation: () => ({ mutateAsync: vi.fn() }) },
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

describe("the Test agent panel of the editor drawers", () => {
  beforeEach(() => {
    testMutate.mockClear();
    drawerParams = {};
  });
  afterEach(cleanup);

  describe("given a saved HTTP agent", () => {
    /** @scenario "The HTTP and code agent drawers test a saved agent" */
    it("shows the panel below the form and sends one turn from it", async () => {
      const user = userEvent.setup();
      drawerParams = { agentId: "agent_http" };
      const { AgentHttpEditorDrawer } = await import("../agent-http-editor-drawer");
      render(<AgentHttpEditorDrawer open={true} onClose={vi.fn()} />, {
        wrapper: Wrapper,
      });

      const panel = await screen.findByTestId("agent-test");
      expect(panel).toHaveTextContent("Test agent");
      expect(screen.getByTestId("agent-test-message")).toHaveValue("ping");

      await user.click(screen.getByTestId("agent-test-run"));
      expect(testMutate).toHaveBeenCalledWith({
        id: "agent_http",
        projectId: "project_1",
        message: "ping",
      });
    });
  });

  describe("given a saved code agent", () => {
    it("shows the panel below the form", async () => {
      drawerParams = { agentId: "agent_code" };
      const { AgentCodeEditorDrawer } = await import("../agent-code-editor-drawer");
      render(<AgentCodeEditorDrawer open={true} onClose={vi.fn()} />, {
        wrapper: Wrapper,
      });

      expect(await screen.findByTestId("agent-test")).toBeInTheDocument();
    });
  });

  describe("given the HTTP agent editor drawer open for a new agent", () => {
    /** @scenario "A draft has no test panel" */
    it("shows no panel: a draft has nothing to call", async () => {
      const { AgentHttpEditorDrawer } = await import("../agent-http-editor-drawer");
      render(<AgentHttpEditorDrawer open={true} onClose={vi.fn()} />, {
        wrapper: Wrapper,
      });

      expect(await screen.findByTestId("agent-name-input")).toBeInTheDocument();
      expect(screen.queryByTestId("agent-test")).not.toBeInTheDocument();
    });
  });
});
