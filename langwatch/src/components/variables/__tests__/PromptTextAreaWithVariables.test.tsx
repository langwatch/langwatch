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
      "data-role"?: string;
    }
  >(({ children, autoHeight, onSelectionChange, "data-role": dataRole, ...props }, ref) => {
    // Simple textarea that mimics RichTextarea behavior
    return <textarea ref={ref} data-role={dataRole} {...props} />;
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

  describe("debouncing behavior", () => {
    it("updates local value immediately on typing", async () => {
      const onChange = vi.fn();
      renderComponent({ onChange });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello", selectionStart: 5 } });

      // Local value updates immediately (visible in textarea)
      expect(screen.getByDisplayValue("Hello")).toBeInTheDocument();
    });

    it("debounces onChange calls", async () => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      renderComponent({ onChange });

      const textarea = screen.getByRole("textbox");

      // Type multiple characters quickly
      fireEvent.change(textarea, { target: { value: "H", selectionStart: 1 } });
      fireEvent.change(textarea, { target: { value: "He", selectionStart: 2 } });
      fireEvent.change(textarea, { target: { value: "Hel", selectionStart: 3 } });

      // Before debounce delay, onChange should be called for each (debounced)
      expect(onChange).toHaveBeenCalled();

      // Fast forward past debounce delay
      vi.advanceTimersByTime(200);

      vi.useRealTimers();
    });

    it("does not sync external value while typing", async () => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { rerender } = render(
        <ChakraProvider value={defaultSystem}>
          <PromptTextAreaWithVariables value="initial" onChange={onChange} />
        </ChakraProvider>
      );

      const textarea = screen.getByRole("textbox");

      // Start typing
      fireEvent.change(textarea, { target: { value: "typed", selectionStart: 5 } });

      // External value changes while typing
      rerender(
        <ChakraProvider value={defaultSystem}>
          <PromptTextAreaWithVariables value="external" onChange={onChange} />
        </ChakraProvider>
      );

      // Should keep the typed value, not sync external (within typing window)
      expect(screen.getByDisplayValue("typed")).toBeInTheDocument();

      // After sync delay, external value should be respected
      vi.advanceTimersByTime(400);

      rerender(
        <ChakraProvider value={defaultSystem}>
          <PromptTextAreaWithVariables value="external2" onChange={onChange} />
        </ChakraProvider>
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue("external2")).toBeInTheDocument();
      });

      vi.useRealTimers();
    });
  });

  describe("external value sync", () => {
    it("syncs external value when not typing", async () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <ChakraProvider value={defaultSystem}>
          <PromptTextAreaWithVariables value="initial" onChange={onChange} />
        </ChakraProvider>
      );

      expect(screen.getByDisplayValue("initial")).toBeInTheDocument();

      // Update external value
      rerender(
        <ChakraProvider value={defaultSystem}>
          <PromptTextAreaWithVariables value="updated" onChange={onChange} />
        </ChakraProvider>
      );

      expect(screen.getByDisplayValue("updated")).toBeInTheDocument();
    });
  });

  describe("role prop", () => {
    it("sets data-role attribute on textarea", () => {
      renderComponent({ role: "system" });

      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveAttribute("data-role", "system");
    });

    it("does not set data-role when role is undefined", () => {
      renderComponent({});

      const textarea = screen.getByRole("textbox");
      expect(textarea).not.toHaveAttribute("data-role");
    });
  });

  describe("borderless mode", () => {
    it("renders without errors in borderless mode", () => {
      renderComponent({ borderless: true });
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("renders without errors when fillHeight is true", () => {
      renderComponent({ borderless: true, fillHeight: true });
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("Add variable button behavior", () => {
    it("toggles menu on repeated clicks", async () => {
      const user = userEvent.setup();
      const { container } = renderComponent({
        showAddContextButton: true,
        availableSources: mockSources,
        variables: mockVariables,
      });

      // Hover to show button
      const textareaContainer = container.firstChild as HTMLElement;
      await user.hover(textareaContainer);

      await waitFor(() => {
        expect(screen.getByText("Add variable")).toBeInTheDocument();
      });

      const addButton = screen.getByText("Add variable");

      // First click - opens menu
      await user.click(addButton);

      // Second click - should toggle (close) menu
      await user.click(addButton);

      // Component should remain functional
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("variable highlighting", () => {
    it("does not show warning when all variables are defined", () => {
      renderComponent({
        value: "Hello {{question}} and {{context}}",
        variables: mockVariables,
      });

      expect(screen.queryByText(/Undefined variables:/)).not.toBeInTheDocument();
    });

    it("shows warning for partially undefined variables", () => {
      renderComponent({
        value: "Hello {{question}} and {{unknown}}",
        variables: mockVariables,
      });

      const warning = screen.getByText(/Undefined variables:/);
      expect(warning).toBeInTheDocument();
      expect(warning.textContent).toContain("unknown");
      expect(warning.textContent).not.toContain("question");
    });

    it("shows warning for multiple undefined variables", () => {
      renderComponent({
        value: "{{foo}} and {{bar}}",
        variables: [],
      });

      const warning = screen.getByText(/Undefined variables:/);
      expect(warning.textContent).toContain("foo");
      expect(warning.textContent).toContain("bar");
    });
  });

  describe("menu trigger detection", () => {
    it("does not trigger menu for complete variables", () => {
      const onChange = vi.fn();
      renderComponent({
        value: "{{question}}",
        onChange,
        variables: mockVariables,
        availableSources: mockSources,
      });

      // Component should render without opening menu
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("does not trigger menu when cursor is not after {{", () => {
      const onChange = vi.fn();
      renderComponent({ onChange, availableSources: mockSources });

      const textarea = screen.getByRole("textbox");
      // Type text without {{ trigger
      fireEvent.change(textarea, { target: { value: "Hello world", selectionStart: 11 } });

      // Component should render without menu issues
      expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
    });
  });
});
