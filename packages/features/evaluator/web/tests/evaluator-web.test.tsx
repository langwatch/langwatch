import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  codeEvaluatorDisabledReason,
  EvaluatorCategoryPicker,
  EvaluatorTypePicker,
} from "../src";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Evaluator web primitives", () => {
  it("explains all missing code evaluator requirements", () => {
    expect(codeEvaluatorDisabledReason({ hasName: false, hasCode: false, hasInput: false, isEditing: false })).toBe("Add a name, some code, and at least one input to create the evaluator.");
    expect(codeEvaluatorDisabledReason({ hasName: true, hasCode: true, hasInput: true, isEditing: true })).toBeNull();
  });

  it("renders category choices and delegates their host-owned actions", async () => {
    const user = userEvent.setup();
    const onSelectCategory = vi.fn();
    const onSelectCode = vi.fn();
    render(<EvaluatorCategoryPicker onSelectCategory={onSelectCategory} onSelectCode={onSelectCode} onSelectWorkflow={vi.fn()} />, { wrapper: Wrapper });

    await user.click(screen.getByTestId("evaluator-category-llm_judge"));
    await user.click(screen.getByTestId("evaluator-category-code"));
    expect(onSelectCategory).toHaveBeenCalledWith("llm_judge");
    expect(onSelectCode).toHaveBeenCalledOnce();
  });

  it("groups contract definitions and exposes unavailable evaluator state", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <EvaluatorTypePicker
        category="expected_answer"
        evaluators={{
          "langevals/exact_match": {
            name: "Exact Match",
            description: "Compare output",
            category: "similarity",
            isGuardrail: false,
            requiredFields: [],
            optionalFields: [],
            settings: {},
            envVars: [],
            result: {},
          },
        }}
        onSelect={onSelect}
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByTestId("evaluator-type-langevals-exact_match"));
    expect(onSelect).toHaveBeenCalledWith("langevals/exact_match");
  });
});
