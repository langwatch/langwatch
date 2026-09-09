import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { markHandledGlobally } from "@langwatch/ui-host/errors";
import { setUiFeedbackHost } from "@langwatch/ui-host/toaster";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  createWorkflow: vi.fn(),
  createAgent: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: () => false,
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

vi.mock("@langwatch/scenario-web/screens/simulations", () => ({
  useScenarioHost: () => ({
    project: () => ({ id: "project-1", slug: "project-1" }),
    organization: { id: "org-1" },
    team: null,
  }),
  scenarioApi: {
    workflow: {
      create: { useMutation: () => ({ mutateAsync: calls.createWorkflow, isPending: false }) },
    },
  },
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({ push: calls.push, replace: vi.fn(), query: {}, asPath: "/", isReady: true }),
}));

vi.mock("@langwatch/agent-web/agent-client", () => ({
  agentApi: {
    useUtils: () => ({ agents: { getAll: { invalidate: vi.fn() } } }),
    workflow: {
      create: { useMutation: () => ({ mutateAsync: calls.createWorkflow, isPending: false }) },
    },
    agents: {
      create: {
        useMutation: (options?: { onSuccess?: (agent: unknown) => void }) => ({
          mutateAsync: async (input: unknown) => {
            const agent = await calls.createAgent(input);
            options?.onSuccess?.(agent);
            return agent;
          },
          isPending: false,
        }),
      },
    },
  },
}));

const { WorkflowSelectorDrawer } = await import("../workflow-selector-drawer.tsx");

const limitRefusal = ({
  limitType,
  current,
  max,
}: {
  limitType: string;
  current: number;
  max: number;
}) => {
  const error = new Error("Refused");
  (error as { data?: unknown }).data = {
    code: "FORBIDDEN",
    httpStatus: 403,
    cause: { limitType, current, max },
  };
  return error;
};

const toasts: string[] = [];

const answeredElsewhere = (error: Error) => async () => {
  markHandledGlobally(error);
  throw error;
};

const failing = (error: Error) => async () => {
  throw error;
};

const renderDrawer = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <WorkflowSelectorDrawer open={true} onClose={vi.fn()} />
    </ChakraProvider>,
  );

const submit = async () => {
  fireEvent.change(screen.getByPlaceholderText(/agent name/i), {
    target: { value: "Support triage" },
  });
  const buttons = screen.getAllByRole("button", { name: "Create & Open Editor" });
  fireEvent.click(buttons[buttons.length - 1]!);
};

beforeEach(() => {
  toasts.length = 0;
  setUiFeedbackHost({
    succeeded: () => undefined,
    failed: (failure) => void toasts.push(failure.fallbackTitle ?? ""),
  });
  calls.createWorkflow.mockResolvedValue({ workflow: { id: "workflow-1" } });
  calls.createAgent.mockResolvedValue({ id: "agent-1" });
});

afterEach(() => {
  setUiFeedbackHost(void 0);
  vi.clearAllMocks();
  cleanup();
});

describe("creating a workflow agent", () => {
  describe("given the organization is already at its workflow limit", () => {
    it("opens the upgrade dialog on workflows and never reaches the agent", async () => {
      calls.createWorkflow.mockImplementation(
        answeredElsewhere(limitRefusal({ limitType: "workflows", current: 3, max: 3 })),
      );

      renderDrawer();
      await submit();

      await waitFor(() => expect(calls.createWorkflow).toHaveBeenCalled());
      expect(calls.createAgent).not.toHaveBeenCalled();
      expect(toasts).toEqual([]);
    });
  });

  describe("given the workflow limit allows but the agent limit does not", () => {
    it("opens the upgrade dialog on agents, after the workflow was created", async () => {
      calls.createAgent.mockImplementation(
        answeredElsewhere(limitRefusal({ limitType: "agents", current: 3, max: 3 })),
      );

      renderDrawer();
      await submit();

      await waitFor(() => expect(calls.createAgent).toHaveBeenCalled());
      expect(calls.createWorkflow).toHaveBeenCalled();
      expect(toasts).toEqual([]);
    });
  });

  describe("given both limits allow", () => {
    it("creates the workflow and the agent, and opens neither dialog", async () => {
      renderDrawer();
      await submit();

      await waitFor(() => expect(calls.createAgent).toHaveBeenCalled());
      expect(calls.createWorkflow).toHaveBeenCalled();
      expect(calls.push).toHaveBeenCalledWith("/project-1/studio/workflow-1");
      expect(toasts).toEqual([]);
    });
  });

  describe("given the refusal has nothing to do with the licence", () => {
    it("reports it to the reader, because nothing else did", async () => {
      calls.createWorkflow.mockImplementation(failing(new Error("network down")));

      renderDrawer();
      await submit();

      await waitFor(() => expect(toasts).toEqual(["Couldn't create workflow agent"]));
    });
  });
});
