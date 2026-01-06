/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AvailableSource,
  type FieldMapping,
  VariableMappingInput,
} from "../VariableMappingInput";

// Debounce delay used in VariableMappingInput
const DEBOUNCE_DELAY = 300;

const mockSources: AvailableSource[] = [
  {
    id: "dataset-1",
    name: "Test Data",
    type: "dataset",
    fields: [
      { name: "input", type: "str" },
      { name: "expected_output", type: "str" },
      { name: "count", type: "float" },
    ],
  },
  {
    id: "runner-1",
    name: "GPT-4o Runner",
    type: "signature",
    fields: [
      { name: "output", type: "str" },
      { name: "parsed_result", type: "dict" },
    ],
  },
];

const renderComponent = (
  props: Partial<Parameters<typeof VariableMappingInput>[0]> = {},
) => {
  return render(
    <ChakraProvider value={defaultSystem}>
      <VariableMappingInput availableSources={mockSources} {...props} />
    </ChakraProvider>,
  );
};

describe("VariableMappingInput", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers(); // Ensure fake timers are always restored
  });

  describe("rendering", () => {
    it("renders with placeholder text", () => {
      renderComponent({ placeholder: "Select a source..." });
      expect(
        screen.getByPlaceholderText("Select a source..."),
      ).toBeInTheDocument();
    });

    it("renders with value mapping", () => {
      const mapping: FieldMapping = { type: "value", value: "Hello world" };
      renderComponent({ mapping });
      expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
    });

    it("displays source mapping as a closable tag", () => {
      const mapping: FieldMapping = {
        type: "source",
        sourceId: "dataset-1",
        field: "input",
      };
      renderComponent({ mapping });
      // Should show a tag with just the field name (no source name prefix)
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
      expect(screen.getByText("input")).toBeInTheDocument();
      // Should have a close button
      expect(screen.getByTestId("clear-mapping-button")).toBeInTheDocument();
    });
  });

  describe("dropdown interaction", () => {
    it("opens dropdown on focus", async () => {
      const user = userEvent.setup();
      renderComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);

      await waitFor(() => {
        expect(screen.getByText("Test Data")).toBeInTheDocument();
        expect(screen.getByText("GPT-4o Runner")).toBeInTheDocument();
      });
    });

    it("shows fields grouped by source", async () => {
      const user = userEvent.setup();
      renderComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);

      await waitFor(() => {
        // Fields from Test Data
        expect(screen.getByText("input")).toBeInTheDocument();
        expect(screen.getByText("expected_output")).toBeInTheDocument();
        expect(screen.getByText("count")).toBeInTheDocument();

        // Fields from GPT-4o Runner
        expect(screen.getByText("output")).toBeInTheDocument();
        expect(screen.getByText("parsed_result")).toBeInTheDocument();
      });
    });

    it("filters fields based on search", async () => {
      const user = userEvent.setup();
      renderComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);
      await user.type(input, "expected");

      await waitFor(() => {
        // Should show expected_output but not other fields
        expect(screen.getByText("expected_output")).toBeInTheDocument();
        expect(screen.queryByText("input")).not.toBeInTheDocument();
        expect(screen.queryByText("count")).not.toBeInTheDocument();
      });
    });

    it("shows only 'use as value' option when no field matches", async () => {
      renderComponent();

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "nonexistent" } });

      await waitFor(() => {
        // No matching fields, but "use as value" option should appear
        expect(screen.getByTestId("use-as-value-option")).toBeInTheDocument();
        expect(screen.getByTestId("use-as-value-option").textContent).toContain(
          "nonexistent",
        );
      });
    });
  });

  describe("selection", () => {
    it("calls onMappingChange with source mapping when field is selected", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      renderComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      await user.click(input);

      await waitFor(() => {
        expect(screen.getByText("input")).toBeInTheDocument();
      });

      await user.click(screen.getByText("input"));

      expect(onMappingChange).toHaveBeenCalledWith({
        type: "source",
        sourceId: "dataset-1",
        field: "input",
      });
    });

    it("closes dropdown after selection", async () => {
      const user = userEvent.setup();
      renderComponent({ onMappingChange: vi.fn() });

      const input = screen.getByRole("textbox");
      await user.click(input);

      await waitFor(() => {
        expect(screen.getByText("input")).toBeInTheDocument();
      });

      await user.click(screen.getByText("input"));

      await waitFor(() => {
        // The dropdown should be closed, so the source header shouldn't be visible
        expect(screen.queryByText("Test Data")).not.toBeInTheDocument();
      });
    });
  });

  describe("value input", () => {
    it("typing does not immediately set mapping (only searches)", async () => {
      const onMappingChange = vi.fn();
      renderComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "test" } });

      // Typing should NOT immediately call onMappingChange
      // User must select "use as value" option to set value mapping
      await waitFor(() => {
        expect(screen.getByTestId("use-as-value-option")).toBeInTheDocument();
      });

      // onMappingChange should not have been called yet
      expect(onMappingChange).not.toHaveBeenCalled();
    });

    it("sets value mapping when selecting 'use as value' option", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      renderComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "my-value" } });

      // Wait for the option to appear
      await waitFor(() => {
        expect(screen.getByTestId("use-as-value-option")).toBeInTheDocument();
      });

      // Click the use as value option
      const option = screen.getByTestId("use-as-value-option");
      await user.click(option.querySelector('[class*="stack"]') ?? option);

      // Now onMappingChange should be called with value mapping
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "value",
          value: "my-value",
        });
      });
    });
  });

  describe("disabled state", () => {
    it("does not open dropdown when disabled", async () => {
      const user = userEvent.setup();
      renderComponent({ disabled: true });

      const input = screen.getByRole("textbox");
      await user.click(input);

      await waitFor(() => {
        expect(screen.queryByText("Test Data")).not.toBeInTheDocument();
      });
    });
  });

  describe("keyboard navigation", () => {
    it("selects first field with Enter (initial highlight)", async () => {
      const onMappingChange = vi.fn();
      renderComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText("Test Data")).toBeInTheDocument();
      });

      // Just press Enter - index starts at 0 (first field)
      fireEvent.keyDown(input, { key: "Enter" });

      // Should have called onMappingChange with first field (input)
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "source",
          sourceId: "dataset-1",
          field: "input",
        });
      });
    });

    it("navigates down with ArrowDown and selects", async () => {
      const onMappingChange = vi.fn();
      renderComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText("Test Data")).toBeInTheDocument();
      });

      // ArrowDown moves from index 0 to 1 (expected_output)
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "source",
          sourceId: "dataset-1",
          field: "expected_output",
        });
      });
    });

    it("navigates up with ArrowUp", async () => {
      const onMappingChange = vi.fn();
      renderComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText("Test Data")).toBeInTheDocument();
      });

      // Down then up goes back to first: 0 → 1 → 0
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowUp" });
      fireEvent.keyDown(input, { key: "Enter" });

      // Should select first field (input)
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "source",
          sourceId: "dataset-1",
          field: "input",
        });
      });
    });

    it("closes dropdown with Escape", async () => {
      renderComponent();

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText("Test Data")).toBeInTheDocument();
      });

      // Press Escape
      fireEvent.keyDown(input, { key: "Escape" });

      // Dropdown should be closed
      await waitFor(() => {
        expect(screen.queryByText("Test Data")).not.toBeInTheDocument();
      });
    });
  });

  describe("use as value option", () => {
    it("shows 'use as value' option when user types", async () => {
      renderComponent();

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "custom" } });

      // Should show "use as value" option with the typed value
      await waitFor(() => {
        expect(screen.getByTestId("use-as-value-option")).toBeInTheDocument();
        // The value is in a nested span, so just check the option contains it
        expect(screen.getByTestId("use-as-value-option").textContent).toContain(
          "custom",
        );
        expect(screen.getByTestId("use-as-value-option").textContent).toContain(
          "as value",
        );
      });
    });

    it("selects value mapping via keyboard navigation", async () => {
      const onMappingChange = vi.fn();
      // Use empty availableSources so only "use as value" option exists
      renderComponent({ onMappingChange, availableSources: [] });

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "myvalue" } });

      // Wait for the option to appear
      await waitFor(() => {
        expect(screen.getByTestId("use-as-value-option")).toBeInTheDocument();
      });

      // Navigate down to select and press Enter
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "value",
          value: "myvalue",
        });
      });
    });

    it("selects value mapping via click", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      renderComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "clicked" } });

      // Wait for the option to appear
      await waitFor(() => {
        expect(screen.getByTestId("use-as-value-option")).toBeInTheDocument();
      });

      // Click the option
      const option = screen.getByTestId("use-as-value-option");
      await user.click(option.querySelector('[class*="stack"]') ?? option);

      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "value",
          value: "clicked",
        });
      });
    });
  });

  describe("clearing source mapping", () => {
    it("clears mapping when clicking the X button on the tag", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      const mapping: FieldMapping = {
        type: "source",
        sourceId: "dataset-1",
        field: "input",
      };
      renderComponent({ mapping, onMappingChange });

      // Should have a tag with close button
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();

      // Click the close button
      await user.click(screen.getByTestId("clear-mapping-button"));

      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith(undefined);
      });
    });

    it("clears source mapping with Backspace when input is empty", async () => {
      const onMappingChange = vi.fn();
      const mapping: FieldMapping = {
        type: "source",
        sourceId: "dataset-1",
        field: "input",
      };
      renderComponent({ mapping, onMappingChange });

      // Focus the input
      const input = screen.getByRole("textbox");
      fireEvent.focus(input);

      // Press Backspace when input is empty
      fireEvent.keyDown(input, { key: "Backspace" });

      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith(undefined);
      });
    });

    it("does not clear mapping with Backspace when there is search text", async () => {
      const onMappingChange = vi.fn();
      const mapping: FieldMapping = {
        type: "source",
        sourceId: "dataset-1",
        field: "input",
      };
      renderComponent({ mapping, onMappingChange });

      // Focus and type something
      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "x" } });

      // Press Backspace when there is text
      fireEvent.keyDown(input, { key: "Backspace" });

      // Mapping should NOT be cleared
      expect(onMappingChange).not.toHaveBeenCalled();
    });
  });

  describe("continued editing after selection", () => {
    it("allows typing after selecting a source to search for another", async () => {
      const onMappingChange = vi.fn();
      const mapping: FieldMapping = {
        type: "source",
        sourceId: "dataset-1",
        field: "input",
      };
      renderComponent({ mapping, onMappingChange });

      // Should have the tag displayed
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();

      // Focus the input and start typing
      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "expected" } });

      // Dropdown should open with filtered results
      await waitFor(() => {
        expect(screen.getByText("expected_output")).toBeInTheDocument();
      });
    });

    it("opens dropdown when typing after selecting value", async () => {
      const onMappingChange = vi.fn();
      const mapping: FieldMapping = { type: "value", value: "hello" };
      renderComponent({ mapping, onMappingChange });

      // Should show the value in the input
      expect(screen.getByDisplayValue("hello")).toBeInTheDocument();

      // Focus and start typing
      const input = screen.getByRole("textbox");
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "new" } });

      // Should clear the value mapping and open dropdown
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith(undefined);
      });

      await waitFor(() => {
        expect(screen.getByTestId("use-as-value-option")).toBeInTheDocument();
      });
    });
  });

  describe("prop synchronization", () => {
    it("updates display when mapping prop changes externally", async () => {
      const onMappingChange = vi.fn();

      // Start with no mapping
      const { rerender } = render(
        <ChakraProvider value={defaultSystem}>
          <VariableMappingInput
            availableSources={mockSources}
            onMappingChange={onMappingChange}
          />
        </ChakraProvider>,
      );

      // Verify no mapping shown initially
      expect(
        screen.queryByTestId("source-mapping-tag"),
      ).not.toBeInTheDocument();

      // Simulate external prop update (e.g., from store after onMappingChange was called)
      const newMapping: FieldMapping = {
        type: "source",
        sourceId: "dataset-1",
        field: "input",
      };

      rerender(
        <ChakraProvider value={defaultSystem}>
          <VariableMappingInput
            availableSources={mockSources}
            mapping={newMapping}
            onMappingChange={onMappingChange}
          />
        </ChakraProvider>,
      );

      // Should immediately show the new mapping as a tag
      await waitFor(() => {
        expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
        expect(screen.getByText("input")).toBeInTheDocument();
      });
    });

    it("reflects mapping immediately after selecting from dropdown", async () => {
      const user = userEvent.setup();
      let currentMapping: FieldMapping | undefined = undefined;

      const onMappingChange = vi.fn((mapping: FieldMapping | undefined) => {
        currentMapping = mapping;
      });

      const { rerender } = render(
        <ChakraProvider value={defaultSystem}>
          <VariableMappingInput
            availableSources={mockSources}
            mapping={currentMapping}
            onMappingChange={onMappingChange}
          />
        </ChakraProvider>,
      );

      // Focus the input to open dropdown
      const input = screen.getByRole("textbox");
      await user.click(input);

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText("Test Data")).toBeInTheDocument();
      });

      // Click on a field option
      await user.click(screen.getByText("input"));

      // Verify onMappingChange was called
      expect(onMappingChange).toHaveBeenCalledWith({
        type: "source",
        sourceId: "dataset-1",
        field: "input",
      });

      // Simulate parent re-rendering with new prop (as would happen when store updates)
      rerender(
        <ChakraProvider value={defaultSystem}>
          <VariableMappingInput
            availableSources={mockSources}
            mapping={currentMapping}
            onMappingChange={onMappingChange}
          />
        </ChakraProvider>,
      );

      // Should show the mapping immediately without needing to close/reopen
      await waitFor(() => {
        expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
        expect(screen.getByText("input")).toBeInTheDocument();
      });
    });
  });
});
