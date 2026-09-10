import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCodeEditorDrawer } from "../agent-code-drawer";
import { WorkflowSelectorDrawer } from "../workflow-selector-drawer";
import { AgentHttpEditorDrawer } from "../agent-http-drawer";

const state = vi.hoisted(() => ({ open: "" }));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
    drawerOpen: (name: string) => name === state.open,
  }),
  useDrawerParams: () => ({}),
}));
vi.mock("@langwatch/ui-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/ui-host/capabilities")>()),
  useUiCapabilities: () => ({ session: { activeScope: () => ({ projectId: "project-1" }) } }),
}));
vi.mock("@langwatch/ui-host/use-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@langwatch/scenario-web/simulations", () => ({
  useScenarioHost: () => ({ project: () => ({ id: "project-1", slug: "project" }) }),
  scenarioApi: {
    workflow: { create: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) } },
    httpProxy: { execute: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) } },
  },
}));
vi.mock("@langwatch/agent-web/agent-client", () => ({
  agentApi: {
    useUtils: () => ({
      agents: { getAll: { invalidate: vi.fn() }, getById: { invalidate: vi.fn() } },
    }),
    agents: {
      getById: { useQuery: () => ({ data: void 0, isLoading: false }) },
      create: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      testTurn: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
  },
}));
vi.mock("@langwatch/workflow-web/surfaces/code-editor-transport", () => ({
  CodeEditorModal: () => null,
}));
vi.mock("@langwatch/workflow-web/surfaces/code-block-editor", () => ({
  CodeBlockEditor: () => <div>Code editor</div>,
}));

afterEach(cleanup);

describe("agent drawer addresses", () => {
  it("opens the HTTP editor and Scenario Mappings from its URL", () => {
    state.open = "agentHttpEditor";
    render(
      <ChakraProvider value={defaultSystem}>
        <AgentHttpEditorDrawer />
      </ChakraProvider>,
    );
    expect(screen.getByText("New HTTP Agent")).toBeVisible();
    expect(screen.getByText("Scenario Mappings")).toBeVisible();
  });

  it("keeps the HTTP editor closed when another drawer is active", () => {
    state.open = "workflowSelector";
    render(
      <ChakraProvider value={defaultSystem}>
        <AgentHttpEditorDrawer />
      </ChakraProvider>,
    );
    expect(screen.queryByText("New HTTP Agent")).not.toBeInTheDocument();
  });
  it("opens the code editor when its URL names agentCodeEditor", () => {
    state.open = "agentCodeEditor";
    render(
      <ChakraProvider value={defaultSystem}>
        <AgentCodeEditorDrawer />
      </ChakraProvider>,
    );
    expect(screen.getByText("Agent Name")).toBeVisible();
  });

  it("opens workflow creation when its URL names workflowSelector", () => {
    state.open = "workflowSelector";
    render(
      <ChakraProvider value={defaultSystem}>
        <WorkflowSelectorDrawer />
      </ChakraProvider>,
    );
    expect(screen.getByRole("heading", { name: "Create Workflow Agent" })).toBeVisible();
  });

  it("keeps workflow creation closed when another drawer is active", () => {
    state.open = "agentCodeEditor";
    render(
      <ChakraProvider value={defaultSystem}>
        <WorkflowSelectorDrawer />
      </ChakraProvider>,
    );
    expect(
      screen.queryByRole("heading", { name: "Create Workflow Agent" }),
    ).not.toBeInTheDocument();
  });
});
