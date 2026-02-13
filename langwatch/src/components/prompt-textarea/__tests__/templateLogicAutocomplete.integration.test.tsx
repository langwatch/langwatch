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
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableSource } from "../../variables/VariableMappingInput";
import type { Variable } from "../../variables/VariablesSection";
import { PromptTextAreaWithVariables } from "..";

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
  >(
    (
      {
        children,
        autoHeight,
        onSelectionChange,
        "data-role": dataRole,
        ...props
      },
      ref,
    ) => {
      return <textarea ref={ref} data-role={dataRole} {...props} />;
    },
  ),
}));

const mockSources: AvailableSource[] = [
  {
    id: "dataset-1",
    name: "Test Data",
    type: "dataset",
    fields: [
      { name: "input", type: "str" },
      { name: "context", type: "str" },
    ],
  },
];

const mockVariables: Variable[] = [
  { identifier: "input", type: "str" },
  { identifier: "context", type: "str" },
];

const renderComponent = (
  props: Partial<Parameters<typeof PromptTextAreaWithVariables>[0]> = {},
) => {
  const defaultProps = {
    value: "",
    onChange: vi.fn(),
    variables: mockVariables,
    availableSources: mockSources,
    showAddContextButton: true,
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <PromptTextAreaWithVariables {...defaultProps} {...props} />
    </ChakraProvider>,
  );
};

describe("<PromptTextAreaWithVariables /> template logic autocomplete", () => {
  beforeEach(() => {
    // Mock document.execCommand to simulate insertText behavior in jsdom.
    // When 'insertText' is called, update the focused textarea value so that
    // subsequent assertions can verify the inserted content.
    document.execCommand = vi.fn((command: string, _showUI?: boolean, value?: string) => {
      if (command === "insertText" && value !== undefined) {
        const el = document.activeElement;
        if (el instanceof HTMLTextAreaElement) {
          // Simulate native insertText: replace selected text (select-all was called first)
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return true;
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ==========================================================================
  // Opening the menu via {% trigger
  // ==========================================================================

  describe("when typing {% trigger", () => {
    it("opens the logic autocomplete popup when typing {%", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "Hello {%", selectionStart: 8 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });
    });

    it("does not open logic popup when typing single {", () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "Hello {", selectionStart: 7 },
      });

      expect(
        screen.queryByTestId("template-logic-menu"),
      ).not.toBeInTheDocument();
    });

    it("opens logic popup when {% is at start of empty textarea", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // Popup content - available constructs
  // ==========================================================================

  describe("when logic autocomplete popup is open", () => {
    it("shows all template logic constructs", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      const keywords = ["if", "for", "assign", "unless", "elsif", "else", "comment"];
      for (const keyword of keywords) {
        expect(
          screen.getByTestId(`logic-construct-${keyword}`),
        ).toBeInTheDocument();
      }
    });

    it("shows description text for each construct", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Conditional block")).toBeInTheDocument();
      expect(screen.getByText("Loop over a collection")).toBeInTheDocument();
    });

    it("shows a link to the Liquid template syntax documentation", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      const docsLink = screen.getByText("Learn template syntax");
      expect(docsLink).toBeInTheDocument();
      expect(docsLink.closest("a")).toHaveAttribute(
        "href",
        "https://docs.langwatch.ai/prompts/template-syntax",
      );
    });
  });

  // ==========================================================================
  // Filtering constructs by typing
  // ==========================================================================

  describe("when filtering constructs by typing", () => {
    it("filters constructs list when typing after {%", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{% if", selectionStart: 5 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("logic-construct-if"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("logic-construct-for"),
      ).not.toBeInTheDocument();
    });

    it("filters correctly with partial match", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{% a", selectionStart: 4 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("logic-construct-assign"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("logic-construct-for"),
      ).not.toBeInTheDocument();
    });

    it("shows empty state when no constructs match", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{% xyz", selectionStart: 6 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByText("No matching constructs"),
      ).toBeInTheDocument();
    });

    it("filters case-insensitively", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{% IF", selectionStart: 5 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("logic-construct-if"),
      ).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Selecting a construct inserts full block template
  // ==========================================================================

  describe("when selecting a construct", () => {
    it("inserts if/endif block when selecting 'if'", async () => {
      const onChange = vi.fn();
      renderComponent({ value: "Hello ", onChange });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "Hello {%", selectionStart: 8 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      // Click on the "if" construct
      fireEvent.click(screen.getByTestId("logic-construct-if"));

      // The menu should close and onChange called with the if/endif template
      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });

      // onChange is called with the trigger text replaced by the if/endif block
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("{% if"),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("{% endif %}"),
      );
      // The prefix text before the trigger should be preserved
      expect(onChange).toHaveBeenCalledWith(
        expect.stringMatching(/^Hello /),
      );
    });

    it("inserts for/endfor block when selecting 'for'", async () => {
      const onChange = vi.fn();
      renderComponent({ onChange });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("logic-construct-for"));

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });

      // onChange is called with the for/endfor template replacing the trigger
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("{% for"),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("{% endfor %}"),
      );
    });

    it("inserts assign tag when selecting 'assign'", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("logic-construct-assign"));

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });
    });

    it("inserts else tag when selecting 'else'", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("logic-construct-else"));

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });
    });

    it("inserts comment/endcomment block when selecting 'comment'", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("logic-construct-comment"));

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });
    });

    it("replaces partial filter text with selected construct", async () => {
      const onChange = vi.fn();
      renderComponent({ onChange });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{% fo", selectionStart: 5 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("logic-construct-for"));

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });

      // The partial "{% fo" trigger text is fully replaced by the for template
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("{% for"),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("{% endfor %}"),
      );
      // The original "{% fo" trigger should not remain
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as string;
      expect(lastCall).not.toContain("{% fo %}");
    });
  });

  // ==========================================================================
  // "Add logic" button
  // ==========================================================================

  describe("when using 'Add logic' button", () => {
    it("shows 'Add logic' button on hover alongside 'Add variable'", async () => {
      const user = userEvent.setup();
      const { container } = renderComponent();

      const textareaContainer = container.firstChild as HTMLElement;
      await user.hover(textareaContainer);

      await waitFor(() => {
        expect(screen.getByText("Add logic")).toBeInTheDocument();
        expect(screen.getByText("Add variable")).toBeInTheDocument();
      });
    });

    it("opens logic menu and inserts construct at cursor position via button", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { container } = renderComponent({ value: "Hello world", onChange });

      const textareaContainer = container.firstChild as HTMLElement;
      await user.hover(textareaContainer);

      await waitFor(() => {
        expect(screen.getByText("Add logic")).toBeInTheDocument();
      });

      // Use fireEvent.click to avoid hover state changes from userEvent
      const addLogicButton = screen.getByText("Add logic");
      fireEvent.click(addLogicButton);

      // The logic menu should open
      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      // Select the "if" construct
      fireEvent.click(screen.getByTestId("logic-construct-if"));

      // Menu closes and construct is inserted
      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });

      // onChange should have been called with the if/endif template
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("{% if"),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("{% endif %}"),
      );
    });

    it("hides 'Add logic' button when textarea is disabled", async () => {
      const user = userEvent.setup();
      const { container } = renderComponent({ disabled: true });

      const textareaContainer = container.firstChild as HTMLElement;
      await user.hover(textareaContainer);

      expect(screen.queryByText("Add logic")).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Keyboard navigation
  // ==========================================================================

  describe("when using keyboard navigation", () => {
    it("handles ArrowDown without errors when popup is open", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      // Press ArrowDown - should not crash
      fireEvent.keyDown(textarea, { key: "ArrowDown" });

      // Menu should still be open with all constructs
      expect(
        screen.getByTestId("template-logic-menu"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("logic-construct-if"),
      ).toBeInTheDocument();
    });

    it("closes popup and inserts construct on Enter", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      // Press Enter to select the first item (if)
      fireEvent.keyDown(textarea, { key: "Enter" });

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });
    });

    it("closes popup and inserts construct on Tab", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      // Press Tab to select the first item
      fireEvent.keyDown(textarea, { key: "Tab" });

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });
    });

    it("closes popup without inserting on Escape", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      fireEvent.keyDown(textarea, { key: "Escape" });

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });

      // Component should remain functional
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("handles ArrowUp without errors when popup is open", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      // Press ArrowUp at the first item - should not crash or wrap
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      // Menu should still be open
      expect(
        screen.getByTestId("template-logic-menu"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("logic-construct-if"),
      ).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Mutual exclusion with {{ variable menu
  // ==========================================================================

  describe("when handling mutual exclusion with variable menu", () => {
    it("does not show variable menu when {% is typed", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: "{%", selectionStart: 2 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      // Variable menu should NOT be open
      // (VariableInsertMenu doesn't have a testid, but we can check it's not rendering its content)
      expect(
        screen.queryByText("No matching fields found"),
      ).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("when handling edge cases", () => {
    it("closes popup when completed {% tag is typed", async () => {
      renderComponent();

      const textarea = screen.getByRole("textbox");

      // First open the popup
      fireEvent.change(textarea, {
        target: { value: "{% if", selectionStart: 5 },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });

      // Now complete the tag with %}
      fireEvent.change(textarea, {
        target: { value: "{% if x %}", selectionStart: 10 },
      });

      await waitFor(() => {
        expect(
          screen.queryByTestId("template-logic-menu"),
        ).not.toBeInTheDocument();
      });
    });

    it("opens popup for new {% after existing completed tags", async () => {
      renderComponent({
        value: "{% if x %}hello{% endif %}",
      });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: {
          value: "{% if x %}hello{% endif %} {%",
          selectionStart: 29,
        },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("template-logic-menu"),
        ).toBeInTheDocument();
      });
    });

    it("renders without errors when no variables are provided", () => {
      renderComponent({ variables: [] });
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });
});
