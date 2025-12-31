/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptTextAreaWithVariables } from "../PromptTextAreaWithVariables";
import type { AvailableSource } from "../VariableMappingInput";
import type { Variable } from "../VariablesSection";

// Mock rich-textarea since jsdom doesn't support getBoundingClientRect properly
vi.mock("rich-textarea", () => ({
  RichTextarea: forwardRef<
    HTMLTextAreaElement,
    {
      value?: string;
      onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
      onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
      onSelectionChange?: (pos: { focused: boolean }) => void;
      placeholder?: string;
      disabled?: boolean;
      autoHeight?: boolean;
      style?: React.CSSProperties;
      children?: (value: string) => React.ReactNode;
      onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
      onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
    }
  >(({ children, autoHeight, onSelectionChange, ...props }, ref) => {
    // Simple textarea that mimics RichTextarea behavior
    return <textarea ref={ref} {...props} />;
  }),
}));

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

const mockVariables: Variable[] = [
  { identifier: "question", type: "str" },
  { identifier: "context", type: "str" },
];

const renderComponent = (
  props: Partial<Parameters<typeof PromptTextAreaWithVariables>[0]> = {}
) => {
  const defaultProps = {
    value: "",
    onChange: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <PromptTextAreaWithVariables {...defaultProps} {...props} />
    </ChakraProvider>
  );
};

describe("PromptTextAreaWithVariables", () => {
  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders textarea with placeholder", () => {
      renderComponent({ placeholder: "Enter your prompt..." });
      expect(screen.getByPlaceholderText("Enter your prompt...")).toBeInTheDocument();
    });

    it("renders with initial value", () => {
      renderComponent({ value: "Hello world" });
      expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
    });

    it("renders variables in text", () => {
      renderComponent({
        value: "Hello {{question}}",
        variables: mockVariables,
      });
      expect(screen.getByDisplayValue("Hello {{question}}")).toBeInTheDocument();
    });
  });

  describe("text input", () => {
    it("calls onChange when typing", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderComponent({ onChange });

      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "Hello");

      expect(onChange).toHaveBeenCalled();
    });
  });

  describe("variable warnings", () => {
    it("shows warning for undefined variables", () => {
      renderComponent({
        value: "Hello {{undefined_var}}",
        variables: [], // No variables defined
      });

      // Look for the specific warning text
      const warning = screen.getByText(/Undefined variables:/);
      expect(warning).toBeInTheDocument();
      expect(warning.textContent).toContain("undefined_var");
    });

    it("does not show warning for defined variables", () => {
      renderComponent({
        value: "Hello {{question}}",
        variables: mockVariables,
      });

      expect(screen.queryByText(/Undefined variables:/)).not.toBeInTheDocument();
    });
  });

  describe("Add variable button", () => {
    it("shows Add variable button on hover when enabled", async () => {
      const user = userEvent.setup();
      const { container } = renderComponent({ showAddContextButton: true });

      // Hover over the container
      const textareaContainer = container.firstChild as HTMLElement;
      await user.hover(textareaContainer);

      await waitFor(() => {
        expect(screen.getByText("Add variable")).toBeInTheDocument();
      });
    });

    it("does not show Add variable button when disabled", async () => {
      const user = userEvent.setup();
      const { container } = renderComponent({
        showAddContextButton: true,
        disabled: true,
      });

      const textareaContainer = container.firstChild as HTMLElement;
      await user.hover(textareaContainer);

      // Should not show the button when textarea is disabled
      expect(screen.queryByText("Add variable")).not.toBeInTheDocument();
    });

    it("hides Add variable button when showAddContextButton is false", async () => {
      const user = userEvent.setup();
      const { container } = renderComponent({ showAddContextButton: false });

      const textareaContainer = container.firstChild as HTMLElement;
      await user.hover(textareaContainer);

      expect(screen.queryByText("Add variable")).not.toBeInTheDocument();
    });
  });

  describe("{{ trigger and menu behavior", () => {
    // Note: Menu rendering tests are limited in jsdom since Portal renders outside component tree
    // These tests focus on component setup and callback wiring
    
    it("accepts all props needed for variable insertion menu", () => {
      const onChange = vi.fn();
      const onCreateVariable = vi.fn();
      
      renderComponent({
        value: "{{test",
        onChange,
        variables: mockVariables,
        onCreateVariable,
        availableSources: mockSources,
      });

      // Component renders without errors
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("calls onChange when text changes", () => {
      const onChange = vi.fn();
      renderComponent({ onChange });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "{{test", selectionStart: 6 } });

      expect(onChange).toHaveBeenCalledWith("{{test");
    });

    it("handles value with complete variable (no menu needed)", () => {
      const onChange = vi.fn();
      renderComponent({
        value: "{{question}}",
        onChange,
        variables: mockVariables,
      });

      // Component renders correctly with complete variable
      expect(screen.getByDisplayValue("{{question}}")).toBeInTheDocument();
    });
  });

  describe("variable creation callbacks", () => {
    it("accepts onCreateVariable callback", () => {
      const onCreateVariable = vi.fn();

      // Should render without errors
      renderComponent({
        availableSources: mockSources,
        variables: [],
        onCreateVariable,
        onChange: vi.fn(),
      });

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("accepts onSetVariableMapping callback", () => {
      const onSetVariableMapping = vi.fn();

      renderComponent({
        availableSources: mockSources,
        variables: mockVariables,
        onSetVariableMapping,
        onChange: vi.fn(),
      });

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("disabled state", () => {
    it("textarea is disabled when disabled prop is true", () => {
      renderComponent({ disabled: true });
      expect(screen.getByRole("textbox")).toBeDisabled();
    });
  });

  describe("keyboard handling", () => {
    it("handles Escape key without error when menu is not open", () => {
      const onChange = vi.fn();
      renderComponent({ onChange, variables: mockVariables });

      const textarea = screen.getByRole("textbox");
      
      // Press Escape when no menu is open
      fireEvent.keyDown(textarea, { key: "Escape" });

      // Component should handle without errors
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("handles arrow keys without error", () => {
      const onChange = vi.fn();
      renderComponent({ onChange, variables: mockVariables });

      const textarea = screen.getByRole("textbox");
      
      // Arrow keys shouldn't cause errors
      fireEvent.keyDown(textarea, { key: "ArrowDown" });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });
});
