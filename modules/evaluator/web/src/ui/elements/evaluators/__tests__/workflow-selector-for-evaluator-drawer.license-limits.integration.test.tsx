/**
 * @vitest-environment jsdom
 * Creating a workflow evaluator creates TWO things, and either one can be over
 * its plan's limit. The upgrade dialog is opened by the application's licence
 * interceptor; what this file proves is the drawer's half — which limit it runs
 * into first, and that it says nothing on top of an answered refusal.
 * @see specs/licensing/enforcement-resources.feature
 */
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { markHandledGlobally } from "@langwatch/ui-host/errors";
import { setUiFeedbackHost } from "@langwatch/ui-host/toaster";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  createWorkflow: vi.fn(),
  createEvaluator: vi.fn(),
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

vi.mock("@langwatch/ui-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "project-1" },
    organization: { id: "org-1" },
    team: null,
  }),
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({ push: calls.push, replace: vi.fn(), query: {}, asPath: "/", isReady: true }),
}));

vi.mock("@langwatch/workflow-web/surfaces/workflow-api", () => ({
  api: {
    useUtils: () => ({ evaluators: { getAll: { invalidate: vi.fn() } } }),
    workflow: {
      create: { useMutation: () => ({ mutateAsync: calls.createWorkflow, isPending: false }) },
    },
    evaluators: {
      create: {
        useMutation: (options?: { onSuccess?: (evaluator: unknown) => void }) => ({
          mutateAsync: async (input: unknown) => {
            const evaluator = await calls.createEvaluator(input);
            options?.onSuccess?.(evaluator);
            return evaluator;
          },
          isPending: false,
        }),
      },
    },
  },
}));

const { WorkflowSelectorForEvaluatorDrawer } =
  await import("../workflow-selector-for-evaluator-drawer.tsx");

/** A limit refusal the licence interceptor has already answered. */
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

const renderDrawer = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <WorkflowSelectorForEvaluatorDrawer open={true} onClose={vi.fn()} />
    </ChakraProvider>,
  );

const submit = () => {
  fireEvent.change(screen.getByPlaceholderText("Enter evaluator name"), {
    target: { value: "Answer relevance" },
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
  calls.createEvaluator.mockResolvedValue({
    id: "evaluator-1",
    name: "Answer relevance",
    workflowId: "workflow-1",
  });
});

afterEach(() => {
  setUiFeedbackHost(void 0);
  vi.clearAllMocks();
  cleanup();
});

describe("creating a workflow evaluator", () => {
  describe("given the organization is already at its workflow limit", () => {
    /** @scenario "Creating workflow evaluator checks workflows limit first" */
    it("stops at the workflow and never reaches the evaluator", async () => {
      calls.createWorkflow.mockImplementation(answeredLimitRefusal("workflows"));

      renderDrawer();
      submit();

      await waitFor(() => expect(calls.createWorkflow).toHaveBeenCalled());
      expect(calls.createEvaluator).not.toHaveBeenCalled();
      expect(toasts).toEqual([]);
    });
  });

  describe("given the workflow limit allows but the evaluator limit does not", () => {
    /** @scenario "Creating workflow evaluator checks evaluators limit second" */
    it("creates the workflow, then stops at the evaluator", async () => {
      calls.createEvaluator.mockImplementation(answeredLimitRefusal("evaluators"));

      renderDrawer();
      submit();

      await waitFor(() => expect(calls.createEvaluator).toHaveBeenCalled());
      expect(calls.createWorkflow).toHaveBeenCalled();
      expect(toasts).toEqual([]);
    });
  });

  describe("given both limits allow", () => {
    /** @scenario "Creating workflow evaluator succeeds when both limits allow" */
    it("creates the workflow and the evaluator, and opens the studio on it", async () => {
      renderDrawer();
      submit();

      await waitFor(() => expect(calls.createEvaluator).toHaveBeenCalled());
      expect(calls.createWorkflow).toHaveBeenCalled();
      expect(calls.push).toHaveBeenCalledWith("/project-1/studio/workflow-1");
      expect(toasts).toEqual([]);
    });
  });

  describe("given the refusal has nothing to do with the licence", () => {
    it("reports it to the reader, because nothing else did", async () => {
      calls.createWorkflow.mockRejectedValue(new Error("network down"));

      renderDrawer();
      submit();

      await waitFor(() => expect(toasts).toEqual(["Couldn't create workflow evaluator"]));
    });
  });
});
