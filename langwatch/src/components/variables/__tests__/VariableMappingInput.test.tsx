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
const _DEBOUNCE_DELAY = 300;

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
        path: ["input"],
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
        path: ["input"],
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
          path: ["input"],
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
        path: ["expected_output"],
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
          path: ["input"],
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
        path: ["input"],
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
        path: ["input"],
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
        path: ["input"],
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
        path: ["input"],
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
        path: ["input"],
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
        path: ["input"],
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

  describe("nested fields", () => {
    const nestedSources: AvailableSource[] = [
      {
        id: "trace",
        name: "Trace",
        type: "dataset",
        fields: [
          { name: "input", type: "str" },
          { name: "output", type: "str" },
          {
            name: "metadata",
            type: "dict",
            children: [
              { name: "customer_id", type: "str" },
              { name: "session_id", type: "str" },
            ],
          },
          {
            name: "spans",
            type: "list",
            children: [
              {
                name: "gpt-4",
                type: "dict",
                label: "gpt-4",
                children: [
                  { name: "input", type: "str" },
                  { name: "output", type: "str" },
                ],
              },
              {
                name: "embeddings",
                type: "dict",
                label: "embeddings",
                children: [
                  { name: "input", type: "str" },
                  { name: "output", type: "list" },
                ],
              },
            ],
          },
        ],
      },
    ];

    const renderNestedComponent = (
      props: Partial<Parameters<typeof VariableMappingInput>[0]> = {},
    ) => {
      return render(
        <ChakraProvider value={defaultSystem}>
          <VariableMappingInput availableSources={nestedSources} {...props} />
        </ChakraProvider>,
      );
    };

    it("shows chevron for fields with children", async () => {
      const user = userEvent.setup();
      renderNestedComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);

      await waitFor(() => {
        // metadata has children, should show chevron
        const metadataOption = screen.getByTestId("field-option-metadata");
        expect(metadataOption).toBeInTheDocument();
        // Check for chevron icon (SVG)
        expect(metadataOption.querySelector("svg")).toBeInTheDocument();
      });
    });

    it("shows nested fields when clicking a field with children", async () => {
      const user = userEvent.setup();
      renderNestedComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByTestId("field-option-metadata")).toBeInTheDocument();
      });

      // Click on metadata to drill down
      await user.click(screen.getByTestId("field-option-metadata"));

      // Should now show metadata's children
      await waitFor(() => {
        expect(screen.getByTestId("field-option-customer_id")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-session_id")).toBeInTheDocument();
      });

      // Should show breadcrumb with path and in-progress tag
      expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("metadata");
    });

    it("creates path array with multiple segments for nested selection", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      renderNestedComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Wait for dropdown
      await waitFor(() => {
        expect(screen.getByTestId("field-option-metadata")).toBeInTheDocument();
      });

      // Click metadata
      await user.click(screen.getByTestId("field-option-metadata"));

      // Wait for nested fields
      await waitFor(() => {
        expect(screen.getByTestId("field-option-customer_id")).toBeInTheDocument();
      });

      // Click customer_id
      await user.click(screen.getByTestId("field-option-customer_id"));

      // Should call onMappingChange with path array
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "source",
          sourceId: "trace",
          path: ["metadata", "customer_id"],
        });
      });
    });

    it("supports three levels of nesting", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      renderNestedComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Click spans
      await waitFor(() => {
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-spans"));

      // Click gpt-4
      await waitFor(() => {
        expect(screen.getByTestId("field-option-gpt-4")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-gpt-4"));

      // Click output
      await waitFor(() => {
        expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-output"));

      // Should have three-segment path
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "source",
          sourceId: "trace",
          path: ["spans", "gpt-4", "output"],
        });
      });
    });

    it("shows in-progress path badges during nested selection", async () => {
      const user = userEvent.setup();
      renderNestedComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Click spans
      await waitFor(() => {
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-spans"));

      // Should show spans badge (the tag contains "spans" text)
      await waitFor(() => {
        expect(screen.getByTestId("path-segment-tag-0")).toBeInTheDocument();
        expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("spans");
      });

      // Click gpt-4
      await waitFor(() => {
        expect(screen.getByTestId("field-option-gpt-4")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-gpt-4"));

      // Should show both spans and gpt-4 badges
      await waitFor(() => {
        expect(screen.getByTestId("path-segment-tag-0")).toBeInTheDocument();
        expect(screen.getByTestId("path-segment-tag-1")).toBeInTheDocument();
        expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("spans");
        expect(screen.getByTestId("path-segment-tag-1")).toHaveTextContent("gpt-4");
      });
    });

    it("allows clicking badge to go back to that level", async () => {
      const user = userEvent.setup();
      renderNestedComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Navigate to spans -> gpt-4
      await waitFor(() => {
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-spans"));

      await waitFor(() => {
        expect(screen.getByTestId("field-option-gpt-4")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-gpt-4"));

      // Should be at gpt-4 level, showing input/output
      await waitFor(() => {
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
      });

      // Click the X on the gpt-4 badge to go back to spans level
      // The close trigger is a button inside the tag
      const gpt4Badge = screen.getByTestId("path-segment-tag-1");
      const closeButton = gpt4Badge.querySelector("button");
      expect(closeButton).toBeInTheDocument();
      await user.click(closeButton!);

      // Should now show spans children (gpt-4, embeddings)
      await waitFor(() => {
        expect(screen.getByTestId("field-option-gpt-4")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-embeddings")).toBeInTheDocument();
      });
    });

    it("allows selecting simple field without nesting", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      renderNestedComponent({ onMappingChange });

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Click input (simple field, no children)
      await waitFor(() => {
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-input"));

      // Should call onMappingChange with single-segment path
      await waitFor(() => {
        expect(onMappingChange).toHaveBeenCalledWith({
          type: "source",
          sourceId: "trace",
          path: ["input"],
        });
      });
    });

    it("displays nested mapping path with dots in tag", () => {
      const mapping: FieldMapping = {
        type: "source",
        sourceId: "trace",
        path: ["metadata", "customer_id"],
      };
      renderNestedComponent({ mapping });

      // Should show the path joined with dots
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
      expect(screen.getByText("metadata.customer_id")).toBeInTheDocument();
    });

    it("clears nested selection on Escape", async () => {
      const user = userEvent.setup();
      renderNestedComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Navigate to spans
      await waitFor(() => {
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-spans"));

      // Should show spans badge
      await waitFor(() => {
        expect(screen.getByTestId("path-segment-tag-0")).toBeInTheDocument();
        expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("spans");
      });

      // Press Escape
      fireEvent.keyDown(input, { key: "Escape" });

      // Badge should be gone, dropdown should be closed
      await waitFor(() => {
        expect(screen.queryByTestId("path-segment-tag-0")).not.toBeInTheDocument();
        expect(screen.queryByTestId("field-option-spans")).not.toBeInTheDocument();
      });
    });

    it("goes back one level with Backspace when search is empty", async () => {
      const user = userEvent.setup();
      renderNestedComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);

      // Navigate to spans -> gpt-4
      await waitFor(() => {
        expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-spans"));

      await waitFor(() => {
        expect(screen.getByTestId("field-option-gpt-4")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("field-option-gpt-4"));

      // Should be at gpt-4 level
      await waitFor(() => {
        expect(screen.getByTestId("path-segment-tag-1")).toBeInTheDocument();
      });

      // Press Backspace
      fireEvent.keyDown(input, { key: "Backspace" });

      // Should go back to spans level
      await waitFor(() => {
        expect(screen.queryByTestId("path-segment-tag-1")).not.toBeInTheDocument();
        expect(screen.getByTestId("path-segment-tag-0")).toBeInTheDocument();
        expect(screen.getByTestId("field-option-gpt-4")).toBeInTheDocument();
      });
    });

    describe("selecting field with children marks it complete AND opens nested dropdown", () => {
      /**
       * This test verifies the UX flow where:
       * 1. User clicks on a field with children (e.g., "spans")
       * 2. The field is added to the path as a badge
       * 3. A NEW dropdown immediately opens showing the nested children
       * 4. User can then select a child, which adds another badge
       * 5. This continues until user selects a leaf field (no children)
       * 
       * This is the "cascading selection" UX pattern.
       */
      it("after selecting a field with children, shows badge AND immediately shows nested options dropdown", async () => {
        const user = userEvent.setup();
        renderNestedComponent();

        const input = screen.getByRole("textbox");
        await user.click(input);

        // Wait for dropdown to open with top-level fields
        await waitFor(() => {
          expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
        });

        // Click on "spans" which has children
        await user.click(screen.getByTestId("field-option-spans"));

        // EXPECTED BEHAVIOR:
        // 1. "spans" badge should appear in the input
        await waitFor(() => {
          expect(screen.getByTestId("path-segment-tag-0")).toBeInTheDocument();
          expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("spans");
        });

        // 2. Dropdown should STILL be open (or immediately reopen) showing nested children
        await waitFor(() => {
          expect(screen.getByTestId("field-option-gpt-4")).toBeInTheDocument();
          expect(screen.getByTestId("field-option-embeddings")).toBeInTheDocument();
        });

        // 3. The original top-level options should NOT be visible anymore
        expect(screen.queryByTestId("field-option-input")).not.toBeInTheDocument();
        expect(screen.queryByTestId("field-option-output")).not.toBeInTheDocument();
      });

      it("continues cascading through multiple levels until reaching a leaf field", async () => {
        const user = userEvent.setup();
        const onMappingChange = vi.fn();
        renderNestedComponent({ onMappingChange });

        const input = screen.getByRole("textbox");
        await user.click(input);

        // Select spans (has children)
        await waitFor(() => {
          expect(screen.getByTestId("field-option-spans")).toBeInTheDocument();
        });
        await user.click(screen.getByTestId("field-option-spans"));

        // Should show spans badge and nested options
        await waitFor(() => {
          expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("spans");
          expect(screen.getByTestId("field-option-gpt-4")).toBeInTheDocument();
        });

        // Select gpt-4 (has children: input, output)
        await user.click(screen.getByTestId("field-option-gpt-4"));

        // Should show both badges and nested options
        await waitFor(() => {
          expect(screen.getByTestId("path-segment-tag-0")).toHaveTextContent("spans");
          expect(screen.getByTestId("path-segment-tag-1")).toHaveTextContent("gpt-4");
          expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
          expect(screen.getByTestId("field-option-output")).toBeInTheDocument();
        });

        // Select output (leaf field, no children)
        await user.click(screen.getByTestId("field-option-output"));

        // NOW the mapping should be finalized and dropdown should close
        await waitFor(() => {
          expect(onMappingChange).toHaveBeenCalledWith({
            type: "source",
            sourceId: "trace",
            path: ["spans", "gpt-4", "output"],
          });
        });

        // Dropdown should be closed
        await waitFor(() => {
          expect(screen.queryByTestId("field-option-input")).not.toBeInTheDocument();
        });

        // Final mapping should be displayed as a single tag
        expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
        expect(screen.getByText("spans.gpt-4.output")).toBeInTheDocument();
      });

      it("selecting a simple field (no children) closes dropdown immediately", async () => {
        const user = userEvent.setup();
        const onMappingChange = vi.fn();
        renderNestedComponent({ onMappingChange });

        const input = screen.getByRole("textbox");
        await user.click(input);

        // Select "input" which has NO children
        await waitFor(() => {
          expect(screen.getByTestId("field-option-input")).toBeInTheDocument();
        });
        await user.click(screen.getByTestId("field-option-input"));

        // Should immediately finalize and close
        await waitFor(() => {
          expect(onMappingChange).toHaveBeenCalledWith({
            type: "source",
            sourceId: "trace",
            path: ["input"],
          });
        });

        // Dropdown should be closed
        await waitFor(() => {
          expect(screen.queryByTestId("field-option-output")).not.toBeInTheDocument();
        });

        // Should show the mapping tag
        expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
        expect(screen.getByText("input")).toBeInTheDocument();
      });
    });
  });
});
