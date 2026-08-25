import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodeEvaluatorEditor,
  EvaluatorEditorActions,
  type CodeEvaluatorField,
} from "../src";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const inputs: CodeEvaluatorField[] = [{ identifier: "output", type: "str" }];

afterEach(cleanup);

describe("code evaluator editor", () => {
  it("presents the fixed evaluator result contract", () => {
    const renderCodeEditor = vi.fn(() => <div data-testid="code-editor" />);

    render(
      <CodeEvaluatorEditor
        name="My evaluator"
        code="class Evaluator: pass"
        inputs={inputs}
        onNameChange={vi.fn()}
        onInputsChange={vi.fn()}
        renderCodeEditor={renderCodeEditor}
      />,
      { wrapper: Wrapper },
    );

    for (const field of ["passed", "score", "label", "details"]) {
      expect(
        screen.getByTestId(`code-evaluator-output-field-${field}`),
      ).toBeInTheDocument();
    }

    expect(screen.queryByTestId("code-evaluator-output-add")).not.toBeInTheDocument();
    expect(renderCodeEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs,
        outputs: [
          { identifier: "details", type: "str" },
          { identifier: "passed", type: "bool" },
          { identifier: "score", type: "float" },
          { identifier: "label", type: "str" },
        ],
      }),
    );
  });

  it("delegates input authoring to its host state", () => {
    const onInputsChange = vi.fn();

    render(
      <CodeEvaluatorEditor
        name="My evaluator"
        code="class Evaluator: pass"
        inputs={inputs}
        onNameChange={vi.fn()}
        onInputsChange={onInputsChange}
        renderCodeEditor={() => null}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByTestId("code-evaluator-input-add"));

    expect(onInputsChange).toHaveBeenCalledWith([
      ...inputs,
      { identifier: "", type: "str" },
    ]);
  });
});

describe("evaluator editor actions", () => {
  const actions = {
    isEditing: false,
    hasUnsavedChanges: false,
    isSaving: false,
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
  };

  it("keeps apply enabled for an incomplete non-comparison local editor", () => {
    render(
      <EvaluatorEditorActions
        {...actions}
        mode="local"
        isValid={false}
        isComparisonEditor={false}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("evaluator-save-button")).toBeDisabled();
    expect(screen.getByTestId("evaluator-apply-button")).toBeEnabled();
  });

  it("blocks apply for an incomplete comparison editor", () => {
    render(
      <EvaluatorEditorActions
        {...actions}
        mode="local"
        isValid={false}
        isComparisonEditor
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("evaluator-apply-button")).toBeDisabled();
  });
});
