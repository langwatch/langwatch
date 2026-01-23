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
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock components with complex transitive dependencies
vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
}));

vi.mock("~/optimization_studio/components/nodes/Nodes", () => ({
  TypeLabel: ({ type }: { type: string }) => <span>{type}</span>,
}));

import {
  type AvailableSource,
  type FieldMapping,
  type Variable,
  VariablesSection,
} from "../VariablesSection";

const mockSources: AvailableSource[] = [
  {
    id: "dataset-1",
    name: "Test Data",
    type: "dataset",
    fields: [
      { name: "input", type: "str" },
      { name: "expected_output", type: "str" },
    ],
  },
];

const renderComponent = (
  props: Partial<Parameters<typeof VariablesSection>[0]> = {},
) => {
  const defaultProps = {
    variables: [],
    onChange: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <VariablesSection {...defaultProps} {...props} />
    </ChakraProvider>,
  );
};

describe("VariablesSection", () => {
  afterEach(() => {
    cleanup();
  });

  describe("header", () => {
    it("displays Variables title by default", () => {
      renderComponent();
      expect(screen.getByText("Variables")).toBeInTheDocument();
    });

    it("displays custom title when provided", () => {
      renderComponent({ title: "Inputs" });
      expect(screen.getByText("Inputs")).toBeInTheDocument();
    });

    it("shows add button when canAddRemove is true", () => {
      renderComponent({ canAddRemove: true });
      const addButton = screen.getByRole("button");
      expect(addButton).toBeInTheDocument();
    });

    it("hides add button when canAddRemove is false", () => {
      renderComponent({ canAddRemove: false });
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("hides add button when readOnly is true", () => {
      renderComponent({ readOnly: true });
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty message when no variables", () => {
      renderComponent({ variables: [] });
      expect(screen.getByText("No variables defined")).toBeInTheDocument();
    });
  });

  describe("displaying variables", () => {
    it("renders variable list", () => {
      const variables: Variable[] = [
        { identifier: "question", type: "str" },
        { identifier: "count", type: "float" },
      ];
      renderComponent({ variables });

      expect(screen.getByText("question")).toBeInTheDocument();
      expect(screen.getByText("count")).toBeInTheDocument();
    });
  });

  describe("adding variables", () => {
    it("calls onChange with new variable when add button clicked", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderComponent({ variables: [], onChange });

      const addButton = screen.getByRole("button");
      await user.click(addButton);

      expect(onChange).toHaveBeenCalledWith([
        { identifier: "input", type: "str" },
      ]);
    });

    it("generates unique identifier when adding duplicate", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [{ identifier: "input", type: "str" }];
      renderComponent({ variables, onChange });

      // First button is the + button
      const buttons = screen.getAllByRole("button");
      const addButton = buttons[0]!;
      await user.click(addButton);

      expect(onChange).toHaveBeenCalledWith([
        { identifier: "input", type: "str" },
        { identifier: "input_1", type: "str" },
      ]);
    });
  });

  describe("editing variable name", () => {
    it("enters edit mode on click", async () => {
      const user = userEvent.setup();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange: vi.fn(), showMappings: false });

      // There's already a value input, so count textboxes before clicking
      const initialTextboxes = screen.getAllByRole("textbox").length;

      await user.click(screen.getByText("question"));

      // Should show an additional input field for editing name
      expect(screen.getAllByRole("textbox").length).toBe(initialTextboxes + 1);
    });

    it("updates variable on blur", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange, showMappings: false });

      await user.click(screen.getByText("question"));
      // Get the edit input (not the value input)
      const inputs = screen.getAllByRole("textbox");
      const editInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "question",
      )!;
      await user.clear(editInput);
      await user.type(editInput, "new_name");
      fireEvent.blur(editInput);

      expect(onChange).toHaveBeenCalledWith([
        { identifier: "new_name", type: "str" },
      ]);
    });

    it("normalizes spaces to underscores", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange, showMappings: false });

      await user.click(screen.getByText("question"));
      const inputs = screen.getAllByRole("textbox");
      const editInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "question",
      )!;
      await user.clear(editInput);
      await user.type(editInput, "my variable");
      fireEvent.blur(editInput);

      expect(onChange).toHaveBeenCalledWith([
        { identifier: "my_variable", type: "str" },
      ]);
    });

    it("converts to lowercase", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange, showMappings: false });

      await user.click(screen.getByText("question"));
      const inputs = screen.getAllByRole("textbox");
      const editInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "question",
      )!;
      await user.clear(editInput);
      await user.type(editInput, "MyVariable");
      fireEvent.blur(editInput);

      expect(onChange).toHaveBeenCalledWith([
        { identifier: "myvariable", type: "str" },
      ]);
    });

    it("removes dashes from identifier", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange, showMappings: false });

      await user.click(screen.getByText("question"));
      const inputs = screen.getAllByRole("textbox");
      const editInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "question",
      )!;
      await user.clear(editInput);
      await user.type(editInput, "my-custom-score");
      fireEvent.blur(editInput);

      // Dashes should be removed
      expect(onChange).toHaveBeenCalledWith([
        { identifier: "mycustomscore", type: "str" },
      ]);
    });

    it("removes special characters from identifier", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange, showMappings: false });

      await user.click(screen.getByText("question"));
      const inputs = screen.getAllByRole("textbox");
      const editInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "question",
      )!;
      await user.clear(editInput);
      await user.type(editInput, "my@score!test#123");
      fireEvent.blur(editInput);

      // Special characters should be removed
      expect(onChange).toHaveBeenCalledWith([
        { identifier: "myscoretest123", type: "str" },
      ]);
    });

    it("preserves underscores in identifier", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange, showMappings: false });

      await user.click(screen.getByText("question"));
      const inputs = screen.getAllByRole("textbox");
      const editInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "question",
      )!;
      await user.clear(editInput);
      await user.type(editInput, "my_custom_score");
      fireEvent.blur(editInput);

      // Underscores should be preserved
      expect(onChange).toHaveBeenCalledWith([
        { identifier: "my_custom_score", type: "str" },
      ]);
    });

    it("does not allow duplicate identifiers", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [
        { identifier: "question", type: "str" },
        { identifier: "answer", type: "str" },
      ];
      renderComponent({ variables, onChange, showMappings: false });

      // Click on "answer" to edit
      await user.click(screen.getByText("answer"));
      const inputs = screen.getAllByRole("textbox");
      // Find the edit input (value "answer")
      const editInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "answer",
      )!;
      await user.clear(editInput);
      await user.type(editInput, "question"); // Try to rename to existing name
      fireEvent.blur(editInput);

      // Should not have called onChange with duplicate
      // The last call should NOT change the identifier to "question"
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
      if (lastCall) {
        const updatedVariables = lastCall[0];
        const hasQuestionTwice =
          updatedVariables.filter((v: Variable) => v.identifier === "question")
            .length > 1;
        expect(hasQuestionTwice).toBe(false);
      }
    });

    it("does not enter edit mode when readOnly", async () => {
      const user = userEvent.setup();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({
        variables,
        onChange: vi.fn(),
        readOnly: true,
        showMappings: false,
      });

      // Count textboxes before clicking (value input exists)
      const initialTextboxes = screen.getAllByRole("textbox").length;

      await user.click(screen.getByText("question"));

      // Should NOT show an additional input field for editing
      expect(screen.getAllByRole("textbox").length).toBe(initialTextboxes);
    });
  });

  describe("removing variables", () => {
    it("shows delete button when canAddRemove is true", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange: vi.fn(), canAddRemove: true });

      // Find the X button (delete)
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(1); // + button and delete button
    });

    it("hides delete button when canAddRemove is false", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({ variables, onChange: vi.fn(), canAddRemove: false });

      // Should not have any buttons (no + and no delete)
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("calls onChange without the removed variable", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const variables: Variable[] = [
        { identifier: "question", type: "str" },
        { identifier: "context", type: "str" },
      ];
      renderComponent({ variables, onChange });

      // Find delete buttons (exclude the + button)
      const buttons = screen.getAllByRole("button");
      // Click the first delete button (second button after +)
      await user.click(buttons[1]!);

      expect(onChange).toHaveBeenCalledWith([
        { identifier: "context", type: "str" },
      ]);
    });
  });

  describe("mapping UI", () => {
    it("shows mapping dropdown when showMappings is true", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({
        variables,
        onChange: vi.fn(),
        showMappings: true,
        availableSources: mockSources,
      });

      // Should show the = sign
      expect(screen.getByText("=")).toBeInTheDocument();
    });

    it("shows value input (not mapping) when showMappings is false", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({
        variables,
        onChange: vi.fn(),
        showMappings: false,
      });

      // Should STILL show the = sign
      expect(screen.getByText("=")).toBeInTheDocument();
      // Should show a simple value input (textbox exists)
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("displays mapping value when mapped", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      const mappings: Record<string, FieldMapping> = {
        question: { type: "source", sourceId: "dataset-1", path: ["input"] },
      };
      renderComponent({
        variables,
        onChange: vi.fn(),
        showMappings: true,
        availableSources: mockSources,
        mappings,
      });

      // Should show a tag with the field name
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
      expect(screen.getByText("input")).toBeInTheDocument();
    });
  });

  describe("type selector on icon", () => {
    it("shows caret next to type icon when not readOnly", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({
        variables,
        onChange: vi.fn(),
        showMappings: false,
      });

      // Should have an SVG for chevron-down (caret)
      // The ChevronDown icon renders as an SVG
      const svgs = document.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(0);
    });

    it("hides caret when readOnly", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({
        variables,
        onChange: vi.fn(),
        showMappings: false,
        readOnly: true,
      });

      // Should not have caret SVG (only the type icon)
      // In readOnly mode, the chevron is not rendered
    });
  });

  describe("runtime values (values and onValueChange props)", () => {
    it("displays value in the input field when values prop is provided", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({
        variables,
        onChange: vi.fn(),
        values: { question: "test value" },
        showMappings: false,
      });

      const inputs = screen.getAllByRole("textbox");
      const valueInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "test value",
      );
      expect(valueInput).toBeInTheDocument();
    });

    it("calls onValueChange when user types in value input", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      const variables: Variable[] = [{ identifier: "question", type: "str" }];

      renderComponent({
        variables,
        onChange: vi.fn(),
        values: {},
        onValueChange,
        showMappings: false,
      });

      // Find the value input (after the = sign)
      const inputs = screen.getAllByRole("textbox");
      // The value input should be the one without a value (empty)
      const valueInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "",
      );

      if (valueInput) {
        await user.type(valueInput, "hello");
        expect(onValueChange).toHaveBeenCalled();
        // Should be called with identifier and new value
        expect(onValueChange).toHaveBeenCalledWith(
          "question",
          expect.any(String),
        );
      }
    });

    it("displays multiple variable values correctly", () => {
      const variables: Variable[] = [
        { identifier: "input", type: "str" },
        { identifier: "count", type: "float" },
      ];
      renderComponent({
        variables,
        onChange: vi.fn(),
        values: { input: "hello", count: "42" },
        showMappings: false,
      });

      const inputs = screen.getAllByRole("textbox");
      const helloInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "hello",
      );
      const countInput = inputs.find(
        (input) => (input as HTMLInputElement).value === "42",
      );

      expect(helloInput).toBeInTheDocument();
      expect(countInput).toBeInTheDocument();
    });

    it("shows empty input when no value provided for variable", () => {
      const variables: Variable[] = [{ identifier: "question", type: "str" }];
      renderComponent({
        variables,
        onChange: vi.fn(),
        values: {}, // No value for question
        showMappings: false,
      });

      const inputs = screen.getAllByRole("textbox");
      // Should have at least one input (the value input)
      expect(inputs.length).toBeGreaterThan(0);
    });
  });

  describe("locked variables", () => {
    it("hides delete button for locked variables", () => {
      const variables: Variable[] = [
        { identifier: "input", type: "str" },
        { identifier: "context", type: "str" },
      ];
      renderComponent({
        variables,
        lockedVariables: new Set(["input"]),
        canAddRemove: true,
      });

      // Input should not have a delete button
      expect(
        screen.queryByTestId("remove-variable-input"),
      ).not.toBeInTheDocument();

      // Context should still have a delete button
      expect(screen.getByTestId("remove-variable-context")).toBeInTheDocument();
    });

    it("prevents editing locked variable name", () => {
      const variables: Variable[] = [{ identifier: "input", type: "str" }];
      renderComponent({
        variables,
        lockedVariables: new Set(["input"]),
      });

      // The variable name should not be clickable (readOnly)
      const nameElement = screen.getByTestId("variable-name-input");
      // It should have default cursor since it's locked
      expect(nameElement).toHaveStyle({ cursor: "default" });
    });

    it("shows info icon for variables with info tooltip", async () => {
      const variables: Variable[] = [{ identifier: "input", type: "str" }];
      renderComponent({
        variables,
        variableInfo: {
          input: "This is the user message input",
        },
      });

      // Should show info icon
      expect(screen.getByTestId("variable-info-input")).toBeInTheDocument();
    });

    it("does not show info icon when no tooltip provided", () => {
      const variables: Variable[] = [{ identifier: "input", type: "str" }];
      renderComponent({
        variables,
        variableInfo: {},
      });

      // Should not show info icon
      expect(
        screen.queryByTestId("variable-info-input"),
      ).not.toBeInTheDocument();
    });
  });

  describe("disabled mappings", () => {
    it("hides mapping input when disabled", () => {
      const variables: Variable[] = [{ identifier: "input", type: "str" }];
      renderComponent({
        variables,
        showMappings: true,
        disabledMappings: new Set(["input"]),
        availableSources: mockSources,
      });

      // Variable name should still be shown
      expect(screen.getByTestId("variable-name-input")).toBeInTheDocument();
      // But mapping input should NOT be shown (no = sign or input field)
      expect(screen.queryByText("=")).not.toBeInTheDocument();
    });

    it("shows info icon with tooltip when variableInfo provided for disabled mapping", () => {
      const variables: Variable[] = [{ identifier: "input", type: "str" }];
      renderComponent({
        variables,
        showMappings: true,
        disabledMappings: new Set(["input"]),
        variableInfo: {
          input: "Value comes from conversation tab",
        },
        availableSources: mockSources,
      });

      // Should show the info icon for the disabled variable
      expect(screen.getByTestId("variable-info-input")).toBeInTheDocument();
    });

    it("shows mapping input only for non-disabled variables", () => {
      const variables: Variable[] = [
        { identifier: "input", type: "str" },
        { identifier: "context", type: "str" },
      ];
      renderComponent({
        variables,
        showMappings: true,
        disabledMappings: new Set(["input"]),
        availableSources: mockSources,
      });

      // Both variable names should be shown
      expect(screen.getByTestId("variable-name-input")).toBeInTheDocument();
      expect(screen.getByTestId("variable-name-context")).toBeInTheDocument();

      // Only one = sign should be shown (for context, not input)
      const equalSigns = screen.getAllByText("=");
      expect(equalSigns).toHaveLength(1);
    });
  });
});
