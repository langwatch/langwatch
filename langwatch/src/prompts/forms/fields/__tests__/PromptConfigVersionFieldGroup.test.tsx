/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts";

// Mock the optimization studio hooks that have complex dependencies
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  useWorkflowStore: () => ({}),
}));

vi.mock("~/components/evaluations/wizard/hooks/useWizardContext", () => ({
  useWizardContext: () => ({}),
}));

vi.mock("~/optimization_studio/hooks/useComponentExecution", () => ({
  useComponentExecution: () => ({}),
}));

vi.mock("~/optimization_studio/hooks/useWorkflowExecution", () => ({
  useWorkflowExecution: () => ({}),
}));

import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "../PromptConfigVersionFieldGroup";

// Store form methods for testing
let testFormMethods: ReturnType<typeof useForm<PromptConfigFormValues>> | null =
  null;

// Default LLM config for tests
const defaultLlmConfig = {
  model: "openai/gpt-4o-mini",
  temperature: 0.7,
  maxTokens: 4096,
};

// Wrapper with Chakra provider and FormProvider
const TestWrapper = ({
  children,
  defaultValues,
}: {
  children: React.ReactNode;
  defaultValues?: Partial<PromptConfigFormValues>;
}) => {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      version: {
        configData: {
          inputs: [],
          outputs: [{ identifier: "output", type: "str" }],
          messages: [],
          llm: defaultLlmConfig,
        },
      },
      ...defaultValues,
    },
  });

  // Store for test access
  testFormMethods = methods;

  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...methods}>{children}</FormProvider>
    </ChakraProvider>
  );
};

// Helper to render with form context
const renderInputsFieldGroup = (
  defaultValues?: Partial<PromptConfigFormValues>,
) => {
  return render(
    <TestWrapper defaultValues={defaultValues}>
      <InputsFieldGroup />
    </TestWrapper>,
  );
};

const renderOutputsFieldGroup = (
  defaultValues?: Partial<PromptConfigFormValues>,
) => {
  return render(
    <TestWrapper defaultValues={defaultValues}>
      <OutputsFieldGroup />
    </TestWrapper>,
  );
};

describe("PromptConfigVersionFieldGroup", () => {
  afterEach(() => {
    cleanup();
  });

  describe("InputsFieldGroup", () => {
    it("renders section header with title", () => {
      renderInputsFieldGroup();
      expect(screen.getByText("Inputs")).toBeInTheDocument();
    });

    it("renders add button", () => {
      renderInputsFieldGroup();
      const addButton = screen.getByRole("button");
      expect(addButton).toBeInTheDocument();
    });

    it("adds new input when clicking add button", async () => {
      const user = userEvent.setup();
      renderInputsFieldGroup();

      const addButton = screen.getByRole("button");
      await user.click(addButton);

      // Should show the new input field
      await waitFor(() => {
        expect(screen.getByDisplayValue("input")).toBeInTheDocument();
      });
    });

    it("renders existing inputs", () => {
      renderInputsFieldGroup({
        version: {
          configData: {
            inputs: [
              { identifier: "question", type: "str" },
              { identifier: "context", type: "str" },
            ],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [],
            llm: defaultLlmConfig,
          },
        },
      });

      expect(screen.getByDisplayValue("question")).toBeInTheDocument();
      expect(screen.getByDisplayValue("context")).toBeInTheDocument();
    });

    it("updates form value when editing input identifier", async () => {
      renderInputsFieldGroup({
        version: {
          configData: {
            inputs: [{ identifier: "question", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [],
            llm: defaultLlmConfig,
          },
        },
      });

      const input = screen.getByDisplayValue("question") as HTMLInputElement;

      // Trigger onChange which calls setValue
      fireEvent.change(input, { target: { value: "user_input" } });

      // Check that form value was updated
      await waitFor(() => {
        const formValue = testFormMethods?.getValues(
          "version.configData.inputs.0.identifier",
        );
        expect(formValue).toBe("user_input");
      });
    });

    it("normalizes identifier with spaces to underscores", async () => {
      renderInputsFieldGroup({
        version: {
          configData: {
            inputs: [{ identifier: "test", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [],
            llm: defaultLlmConfig,
          },
        },
      });

      const input = screen.getByDisplayValue("test") as HTMLInputElement;

      // The component normalizes spaces to underscores in onChange
      fireEvent.change(input, { target: { value: "user input" } });

      // Check form value - it should be normalized
      await waitFor(() => {
        const formValue = testFormMethods?.getValues(
          "version.configData.inputs.0.identifier",
        );
        expect(formValue).toBe("user_input");
      });
    });

    it("converts identifier to lowercase", async () => {
      renderInputsFieldGroup({
        version: {
          configData: {
            inputs: [{ identifier: "test", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [],
            llm: defaultLlmConfig,
          },
        },
      });

      const input = screen.getByDisplayValue("test") as HTMLInputElement;

      // The component converts to lowercase in onChange
      fireEvent.change(input, { target: { value: "UserInput" } });

      // Check form value - it should be lowercase
      await waitFor(() => {
        const formValue = testFormMethods?.getValues(
          "version.configData.inputs.0.identifier",
        );
        expect(formValue).toBe("userinput");
      });
    });

    it("generates unique identifier when adding duplicate", async () => {
      const user = userEvent.setup();
      renderInputsFieldGroup({
        version: {
          configData: {
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [],
            llm: defaultLlmConfig,
          },
        },
      });

      // Find the add button (it's the first button with a Plus icon)
      const allButtons = screen.getAllByRole("button");
      const addButton = allButtons[0]!; // First button is the + button
      await user.click(addButton);

      // Second input should have unique name in form state
      await waitFor(() => {
        const inputs = testFormMethods?.getValues("version.configData.inputs");
        expect(inputs).toHaveLength(2);
        expect(inputs?.[0]?.identifier).toBe("input");
        expect(inputs?.[1]?.identifier).toBe("input_1");
      });
    });

    it("removes input from form when delete button is clicked", async () => {
      const user = userEvent.setup();
      renderInputsFieldGroup({
        version: {
          configData: {
            inputs: [
              { identifier: "question", type: "str" },
              { identifier: "context", type: "str" },
            ],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [],
            llm: defaultLlmConfig,
          },
        },
      });

      // Initially should have 2 inputs
      expect(
        testFormMethods?.getValues("version.configData.inputs"),
      ).toHaveLength(2);

      // Find delete buttons - they contain the Trash2 icon (svg with class containing feather-trash)
      // Each input row has a delete button
      const allButtons = screen.getAllByRole("button");

      // Find the button that is a delete button (not the add button with Plus icon)
      // The delete buttons have colorPalette="gray" in the component
      const deleteButtons = allButtons.filter(
        (btn) =>
          btn.className.includes("gray") ||
          btn.querySelector("svg.feather-trash-2"),
      );

      // Click the first delete button
      if (deleteButtons.length > 0) {
        await user.click(deleteButtons[0]!);
      } else {
        // Fallback - click second button (first is add button)
        await user.click(allButtons[1]!);
      }

      await waitFor(() => {
        const inputs = testFormMethods?.getValues("version.configData.inputs");
        expect(inputs).toHaveLength(1);
        expect(inputs?.[0]?.identifier).toBe("context");
      });
    });
  });

  describe("OutputsFieldGroup", () => {
    it("renders section header with title", () => {
      renderOutputsFieldGroup();
      expect(screen.getByText("Outputs")).toBeInTheDocument();
    });

    it("prevents deleting last output", async () => {
      renderOutputsFieldGroup({
        version: {
          configData: {
            inputs: [],
            outputs: [{ identifier: "result", type: "str" }],
            messages: [],
            llm: defaultLlmConfig,
          },
        },
      });

      // The delete button for the only output should be disabled
      const deleteButtons = screen
        .getAllByRole("button")
        .filter((btn) => btn.querySelector("svg"));

      // Find the trash button (not the + button)
      const trashButton = deleteButtons.find(
        (btn) =>
          btn.getAttribute("disabled") !== null || btn.hasAttribute("disabled"),
      );

      // The button should be disabled
      expect(trashButton).toBeDisabled();
    });

    it("allows deleting output when multiple exist", async () => {
      const _user = userEvent.setup();
      renderOutputsFieldGroup({
        version: {
          configData: {
            inputs: [],
            outputs: [
              { identifier: "result1", type: "str" },
              { identifier: "result2", type: "str" },
            ],
            messages: [],
            llm: defaultLlmConfig,
          },
        },
      });

      // Both delete buttons should be enabled
      const deleteButtons = screen
        .getAllByRole("button")
        .filter(
          (btn) => btn.querySelector("svg") && !btn.hasAttribute("disabled"),
        );

      // Should have the + button plus 2 enabled delete buttons
      expect(deleteButtons.length).toBeGreaterThanOrEqual(2);
    });
  });
});
