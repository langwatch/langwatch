/**
 * @vitest-environment jsdom
 * A new evaluator's footer while its default models load: nothing is saved or
 * applied before the reset that fills them in has run.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type EvaluatorEditorController,
  EvaluatorEditorFooter,
} from "../evaluator-editor-shared.tsx";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function FooterUnderTest({
  isLoadingEvaluator,
  onLocalConfigChange,
}: {
  isLoadingEvaluator: boolean;
  onLocalConfigChange?: () => void;
}) {
  const form = useForm<{ name: string; settings: Record<string, unknown> }>();
  const controller: EvaluatorEditorController = {
    form,
    evaluatorId: undefined,
    evaluatorType: "langevals/llm_boolean",
    evaluatorDef: undefined,
    effectiveEvaluatorDef: undefined,
    isLoadingEvaluator,
    workflowCard: undefined,
    isWorkflowEvaluator: false,
    hasSettings: true,
    settingsSchema: undefined,
    projectSlug: "p1",
    hasUnsavedChanges: false,
    isSaving: false,
    isValid: true,
    saveButtonText: "Create Evaluator",
    mappingsConfig: undefined,
    onMappingChange: undefined,
    comparisonContext: undefined,
    expectsComparisonContext: false,
    comparison: {
      variants: [],
      hasGoldenAnswer: false,
      goldenField: "",
      includeMetrics: [],
      randomizeOrder: true,
    },
    onComparisonChange: undefined,
    onLocalConfigChange,
    gate: undefined,
    required: false,
    onRequiredChange: undefined,
    onRemove: undefined,
    title: "New evaluator",
    handleSave: vi.fn(),
    handleClose: vi.fn(),
    handleDiscard: vi.fn(),
    handleApply: vi.fn(),
    flushLocalConfig: vi.fn(),
  };
  return <EvaluatorEditorFooter controller={controller} onCancel={vi.fn()} />;
}

function renderFooter(props: { isLoadingEvaluator: boolean; onLocalConfigChange?: () => void }) {
  render(<FooterUnderTest {...props} />, { wrapper: Wrapper });
}

const buttons = () =>
  screen.getAllByRole("button").filter((b) => /create evaluator|apply/i.test(b.textContent ?? ""));

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
