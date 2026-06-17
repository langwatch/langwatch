/**
 * @vitest-environment jsdom
 *
 * The code-evaluator drawer creates AND edits a custom Python evaluator. Editing
 * loads the saved code, inputs and outputs (not just the mapping), so a code
 * evaluator can actually be edited from the evaluators page and the workbench.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const savedCodeEvaluator = {
  id: "ev_code_1",
  name: "my-code-eval",
  type: "code",
  config: {
    code: "class Code:\n  def __call__(self, output: str):\n    return {'passed': True}",
    inputs: [{ identifier: "output", type: "str" }],
    outputs: [{ identifier: "passed", type: "bool" }],
  },
};

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p1", slug: "p1" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => undefined,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// Stub the monaco editor and the variables section so the test stays focused on
// the drawer's create-vs-edit behavior without pulling in heavy editors.
vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: ({ code }: { code: string }) => (
    <div data-testid="code-editor">{code}</div>
  ),
}));
vi.mock("~/components/variables", () => ({
  VariablesSection: () => <div data-testid="variables-section" />,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      evaluators: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
    evaluators: {
      getById: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
          data: opts?.enabled ? savedCodeEvaluator : undefined,
          isLoading: false,
        }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

import { CodeEvaluatorEditorDrawer } from "../CodeEvaluatorEditorDrawer";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("CodeEvaluatorEditorDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given an existing code evaluator", () => {
    describe("when the drawer opens in edit mode", () => {
      /** @scenario Editing a code evaluator reopens the code editor */
      it("loads the saved code, name, inputs and outputs, not just the mapping", async () => {
        render(<CodeEvaluatorEditorDrawer open evaluatorId="ev_code_1" />, {
          wrapper: Wrapper,
        });

        await waitFor(() => {
          expect(screen.getByText("Edit Code Evaluator")).toBeInTheDocument();
        });
        expect(screen.getByTestId("code-evaluator-name")).toHaveValue(
          "my-code-eval",
        );
        expect(screen.getByTestId("code-editor")).toHaveTextContent(
          "def __call__",
        );
        // Inputs and outputs render (the bug was that edit showed only mapping).
        expect(screen.getByText("Inputs")).toBeInTheDocument();
        expect(screen.getByText("Outputs")).toBeInTheDocument();
        expect(screen.getByText("Save changes")).toBeInTheDocument();
      });
    });
  });

  describe("given no evaluator id", () => {
    describe("when the drawer opens in create mode", () => {
      it("starts blank with the create affordance", async () => {
        render(<CodeEvaluatorEditorDrawer open />, { wrapper: Wrapper });

        await waitFor(() => {
          expect(screen.getByText("New Code Evaluator")).toBeInTheDocument();
        });
        expect(screen.getByText("Create evaluator")).toBeInTheDocument();
        expect(screen.getByTestId("code-evaluator-name")).toHaveValue("");
      });
    });
  });
});
