/**
 * @vitest-environment jsdom
 *
 * The footer of a new evaluator's form while its default models are still
 * loading: nothing may be saved or applied, because the reset that fills the
 * defaults in has not run yet.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

import {
  type EvaluatorEditorController,
  EvaluatorEditorFooter,
} from "~/components/evaluators/EvaluatorEditorShared";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderFooter({
  isLoadingEvaluator,
  onLocalConfigChange,
}: {
  isLoadingEvaluator: boolean;
  onLocalConfigChange?: () => void;
}) {
  const controller = {
    evaluatorId: undefined,
    hasUnsavedChanges: false,
    isSaving: false,
    isValid: true,
    saveButtonText: "Create Evaluator",
    onLocalConfigChange,
    onComparisonChange: undefined,
    onRemove: undefined,
    handleSave: vi.fn(),
    handleDiscard: vi.fn(),
    handleApply: vi.fn(),
    handleClose: vi.fn(),
    isLoadingEvaluator,
  } as unknown as EvaluatorEditorController;
  render(<EvaluatorEditorFooter controller={controller} onCancel={vi.fn()} />, {
    wrapper: Wrapper,
  });
}

const buttons = () =>
  screen
    .getAllByRole("button")
    .filter((b) => /create evaluator|apply/i.test(b.textContent ?? ""));

describe("EvaluatorEditorFooter", () => {
  afterEach(cleanup);

  describe("when a new evaluator's default models are still loading", () => {
    /** @scenario A new evaluator waits for the configured default before filling its model */
    it("disables saving", () => {
      renderFooter({ isLoadingEvaluator: true });

      expect(buttons().length).toBeGreaterThan(0);
      for (const button of buttons()) expect(button).toBeDisabled();
    });

    /** @scenario A new evaluator waits for the configured default before filling its model */
    it("disables applying on the local-config flow", () => {
      renderFooter({ isLoadingEvaluator: true, onLocalConfigChange: vi.fn() });

      expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
    });
  });

  describe("when the defaults have answered", () => {
    it("enables saving", () => {
      renderFooter({ isLoadingEvaluator: false });

      for (const button of buttons()) expect(button).toBeEnabled();
    });
  });
});
