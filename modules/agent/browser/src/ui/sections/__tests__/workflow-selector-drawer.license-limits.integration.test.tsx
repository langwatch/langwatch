/**
 * @vitest-environment jsdom
 * Creating a workflow agent creates TWO things, either of which can be over
 * its plan's limit. This proves the drawer's half: which limit it hits first,
 * and that it adds nothing atop a refusal the licence handler already answered.
 * @see specs/licensing/enforcement-resources.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  createWorkflow: vi.fn(),
  createAgent: vi.fn(),
  navigate: vi.fn(),
  stack: [] as { drawer: string }[],
  closeDrawer: vi.fn(),
  goBack: vi.fn(),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    closeDrawer: calls.closeDrawer,
    openDrawer: vi.fn(),
    goBack: calls.goBack,
    canGoBack: false,
  }),
  getDrawerStack: () => calls.stack,
}));

vi.mock("../../../model/agent-management-host.ts", () => ({
  useAgentManagementHost: () => ({
    project: () => ({ id: "project_1", slug: "acme" }),
    navigate: calls.navigate,
    failed: vi.fn(),
  }),
}));

vi.mock("../../../behavior/agent-api.ts", () => ({
  agentApi: {
    useUtils: () => ({ agents: { getAll: { invalidate: () => Promise.resolve() } } }),
    agents: {
      create: { useMutation: () => ({ mutateAsync: calls.createAgent, isPending: false }) },
    },
    workflow: {
      create: { useMutation: () => ({ mutateAsync: calls.createWorkflow, isPending: false }) },
    },
  },
}));

vi.mock("../../../model/workflow/templates/blank.template.ts", () => ({
  blankTemplate: { name: "Blank", nodes: [] },
}));

vi.mock("../../../model/workflow/random-workflow-icon.ts", () => ({
  getRandomWorkflowIcon: () => "🧩",
}));

vi.mock("../workflow/optimization_studio/properties/modals/emoji-picker-modal.tsx", () => ({
  EmojiPickerModal: () => null,
}));

vi.mock("../workflow/code/render-code.tsx", () => ({ RenderCode: () => null }));
vi.mock("../../elements/workflow/code/workflow-code-editor.tsx", () => ({
  WorkflowCodeEditorModal: () => null,
}));
vi.mock("../../../behavior/lent-setup-with-agent-button.tsx", () => ({
  SetupWithAgentButton: () => null,
}));
vi.mock("../../../behavior/lent-parameter-line-field.tsx", () => ({
  ParameterLineField: () => null,
}));

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { markHandledGlobally } = await import("@langwatch/browser-host/errors");
const { setUiFeedbackHost } = await import("@langwatch/browser-host/toaster");
const { RoutedWorkflowSelectorDrawer } = await import("../routed-agent-drawers.tsx");

/** A limit refusal the licence handler has already answered with its upgrade modal. */
const answeredLimitRefusal = (limitType: string) => async () => {
  const error = new Error("Refused");
  (error as { data?: unknown }).data = {
    code: "FORBIDDEN",
    httpStatus: 403,
    cause: { limitType, current: 3, max: 3 },
  };
  markHandledGlobally(error);
  throw error;
};

const toasts: string[] = [];

const submit = async () => {
  const user = userEvent.setup();
  render(<RoutedWorkflowSelectorDrawer />, {
    wrapper: ({ children }) => (
      <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
    ),
  });
  await user.type(screen.getByTestId("agent-name-input"), "Support flow");
  await user.click(screen.getByTestId("save-agent-button"));
};

beforeEach(() => {
  toasts.length = 0;
  setUiFeedbackHost({
    succeeded: () => undefined,
    failed: (failure) => void toasts.push(failure.fallbackTitle ?? ""),
  });
  calls.createWorkflow.mockResolvedValue({ workflow: { id: "workflow_new" } });
  calls.createAgent.mockResolvedValue({ id: "agent_new" });
});

afterEach(() => {
  setUiFeedbackHost(void 0);
  vi.clearAllMocks();
  cleanup();
});

describe("creating a workflow agent", () => {
  describe("given the organization is already at its workflow limit", () => {
    beforeEach(async () => {
      calls.createWorkflow.mockImplementation(answeredLimitRefusal("workflows"));
      await submit();
    });

    /** @scenario "Creating workflow agent checks workflows limit first" */
    it("stops at the workflow and never reaches the agent", async () => {
      await vi.waitFor(() => expect(calls.createWorkflow).toHaveBeenCalled());
      expect(calls.createAgent).not.toHaveBeenCalled();
      expect(calls.navigate).not.toHaveBeenCalled();
      expect(toasts).toEqual([]);
    });

    /** @scenario "Workflow agent creation error toast suppressed when license modal shown" */
    it("adds no toast of its own to the refusal the licence handler answered", async () => {
      await vi.waitFor(() => expect(screen.getByTestId("save-agent-button")).toBeEnabled());
      expect(toasts).not.toContain("Couldn't create workflow agent");
    });
  });

  describe("given the workflow limit allows but the agent limit does not", () => {
    /** @scenario "Creating workflow agent checks agents limit second" */
    it("creates the workflow, then stops at the agent", async () => {
      calls.createAgent.mockImplementation(answeredLimitRefusal("agents"));

      await submit();

      await vi.waitFor(() => expect(calls.createAgent).toHaveBeenCalled());
      expect(calls.createWorkflow).toHaveBeenCalled();
      expect(calls.navigate).not.toHaveBeenCalled();
      expect(toasts).toEqual([]);
    });
  });

  describe("given both limits allow", () => {
    /** @scenario "Creating workflow agent succeeds when both limits allow" */
    it("creates the workflow and the agent, and opens the studio on it", async () => {
      await submit();

      await vi.waitFor(() =>
        expect(calls.navigate).toHaveBeenCalledWith("/acme/studio/workflow_new"),
      );
      expect(calls.createWorkflow).toHaveBeenCalled();
      expect(calls.createAgent).toHaveBeenCalled();
      expect(toasts).toEqual([]);
    });
  });

  describe("given the refusal has nothing to do with the licence", () => {
    it("reports it to the reader, because nothing else did", async () => {
      calls.createWorkflow.mockRejectedValue(new Error("network down"));

      await submit();

      await vi.waitFor(() => expect(toasts).toEqual(["Couldn't create workflow agent"]));
    });
  });
});
