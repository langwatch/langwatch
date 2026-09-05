/**
 * @vitest-environment jsdom
 * @see specs/monitors/guardrails-drawer.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { clearGuardrailsDrawerState, GuardrailsDrawer } from "../guardrails-drawer";

const mockCloseDrawer = vi.fn();
const mockOpenDrawer = vi.fn();
const mockGoBack = vi.fn();
let registeredOnSelect: ((evaluator: Evaluator) => void) | undefined;

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    canGoBack: false,
    goBack: mockGoBack,
  }),
  setFlowCallbacks: (_key: string, callbacks: { onSelect: (evaluator: Evaluator) => void }) => {
    registeredOnSelect = callbacks.onSelect;
  },
}));

const PII_CHECK: Evaluator = {
  id: "evaluator-1",
  projectId: "test-project-id",
  name: "PII Check",
  slug: "pii-check-abc12",
  type: "evaluator",
  config: { evaluatorType: "langevals/pii_detection" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date("2025-01-10T10:00:00Z"),
  updatedAt: new Date("2025-01-15T10:00:00Z"),
};

const selectEvaluator = async (user: ReturnType<typeof userEvent.setup>, evaluator: Evaluator) => {
  await user.click(screen.getByText("Select Evaluator"));
  expect(registeredOnSelect).toBeDefined();
  registeredOnSelect!(evaluator);
};

describe("GuardrailsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGuardrailsDrawerState();
    registeredOnSelect = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = () =>
    render(
      <ChakraProvider value={defaultSystem}>
        <GuardrailsDrawer open={true} />
      </ChakraProvider>,
    );

  describe("given the evaluator list is open for guardrail setup", () => {
    describe("when I select an evaluator with a slug", () => {
      /** @scenario "Select existing evaluator for guardrail" */
      it("shows code integration referencing that evaluator's slug", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await selectEvaluator(user, PII_CHECK);

        await waitFor(() => {
          expect(screen.getAllByText(/pii-check-abc12/).length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe("given the guardrails code block is displayed", () => {
    /** @scenario "Python code shows async by default" */
    it("shows the Python async SDK usage by default", async () => {
      const user = userEvent.setup();
      renderDrawer();
      await selectEvaluator(user, PII_CHECK);

      await waitFor(() => {
        expect(screen.getByText("Python (async)")).toBeInTheDocument();
      });
      expect(screen.getByText(/async_evaluate/)).toBeInTheDocument();
      expect(screen.getByText(/async def llm_step/)).toBeInTheDocument();
    });

    /** @scenario "Copy code to clipboard" */
    it("copies the code to the clipboard when the copy button is clicked", async () => {
      const user = userEvent.setup();
      renderDrawer();
      await selectEvaluator(user, PII_CHECK);

      const copyButton = await screen.findByRole("button", { name: "Copy code" });
      await user.click(copyButton);

      await waitFor(async () => {
        expect(await navigator.clipboard.readText()).toContain("pii-check-abc12");
      });
    });

    /** @scenario "API key placeholder in code" */
    it("includes a placeholder for the API key rather than a literal secret", async () => {
      const user = userEvent.setup();
      renderDrawer();
      await selectEvaluator(user, PII_CHECK);

      await waitFor(() => {
        expect(screen.getByText("LANGWATCH_API_KEY")).toBeInTheDocument();
      });
    });
  });

  describe("given the guardrails code is displayed", () => {
    describe("when I click Close", () => {
      /** @scenario "Close without saving" */
      it("closes the drawer without creating a monitor", async () => {
        const user = userEvent.setup();
        renderDrawer();
        await selectEvaluator(user, PII_CHECK);

        const closeButtons = screen.getAllByRole("button", { name: "Close" });
        await user.click(closeButtons[closeButtons.length - 1]!);

        expect(mockCloseDrawer).toHaveBeenCalledOnce();
      });
    });
  });
});
