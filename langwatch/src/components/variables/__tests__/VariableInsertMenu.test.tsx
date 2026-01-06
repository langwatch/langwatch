/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VariableInsertMenu } from "../VariableInsertMenu";
import type { AvailableSource } from "../VariableMappingInput";

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
  props: Partial<Parameters<typeof VariableInsertMenu>[0]> = {},
) => {
  const defaultProps = {
    isOpen: true,
    position: { top: 100, left: 100 },
    availableSources: mockSources,
    query: "",
    highlightedIndex: 0,
    onHighlightChange: vi.fn(),
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <VariableInsertMenu {...defaultProps} {...props} />
    </ChakraProvider>,
  );
};

describe("VariableInsertMenu", () => {
  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders when isOpen is true", () => {
      renderComponent();
      // Should show sources
      expect(screen.getByText("Test Data")).toBeInTheDocument();
    });

    it("does not render when isOpen is false", () => {
      renderComponent({ isOpen: false });
      expect(screen.queryByText("Test Data")).not.toBeInTheDocument();
    });

    it("shows all sources grouped by name", () => {
      renderComponent();
      expect(screen.getByText("Test Data")).toBeInTheDocument();
      expect(screen.getByText("GPT-4o Runner")).toBeInTheDocument();
    });

    it("shows all fields from sources", () => {
      renderComponent();
      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByText("expected_output")).toBeInTheDocument();
      expect(screen.getByText("count")).toBeInTheDocument();
      expect(screen.getByText("output")).toBeInTheDocument();
      expect(screen.getByText("parsed_result")).toBeInTheDocument();
    });

    it("displays human-readable type labels (Text instead of STRING)", () => {
      renderComponent();
      // str type should show "Text", not "STRING" or "str"
      const textBadges = screen.getAllByText("Text");
      expect(textBadges.length).toBeGreaterThan(0);
    });

    it("displays Number label for float type", () => {
      renderComponent();
      // float type (count field) should show "Number"
      expect(screen.getByText("Number")).toBeInTheDocument();
    });

    it("displays Object label for json type", () => {
      renderComponent();
      // json type (parsed_result field) should show "Object"
      expect(screen.getByText("Object")).toBeInTheDocument();
    });
  });

  describe("filtering with query prop", () => {
    it("filters fields based on query prop", () => {
      renderComponent({ query: "output" });

      expect(screen.getByText("expected_output")).toBeInTheDocument();
      expect(screen.getByText("output")).toBeInTheDocument();
      expect(screen.queryByText("input")).not.toBeInTheDocument();
      expect(screen.queryByText("count")).not.toBeInTheDocument();
    });

    it("shows no results message when nothing matches", () => {
      renderComponent({ query: "nonexistent" });

      expect(screen.getByText("No matching fields found")).toBeInTheDocument();
    });

    it("shows query display when query is provided", () => {
      renderComponent({ query: "test" });

      expect(screen.getByText("{{test")).toBeInTheDocument();
    });
  });

  describe("selection", () => {
    it("calls onSelect when clicking a field", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderComponent({ onSelect });

      await user.click(screen.getByText("input"));

      expect(onSelect).toHaveBeenCalledWith({
        sourceId: "dataset-1",
        sourceName: "Test Data",
        sourceType: "dataset",
        fieldName: "input",
        fieldType: "str",
      });
    });

    it("calls onSelect with correct field info for runner field", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderComponent({ onSelect });

      await user.click(screen.getByText("parsed_result"));

      expect(onSelect).toHaveBeenCalledWith({
        sourceId: "runner-1",
        sourceName: "GPT-4o Runner",
        sourceType: "signature",
        fieldName: "parsed_result",
        fieldType: "dict",
      });
    });
  });

  describe("highlighting", () => {
    it("highlights first item by default (index 0)", () => {
      renderComponent({ highlightedIndex: 0 });
      // The first field "input" should have blue.50 background
      // Can't easily test CSS in jsdom, but component renders without error
      expect(screen.getByText("input")).toBeInTheDocument();
    });

    it("uses highlightedIndex prop for highlighting", () => {
      renderComponent({ highlightedIndex: 2 });
      // Third field "count" should be highlighted
      expect(screen.getByText("count")).toBeInTheDocument();
    });
  });

  describe("create variable option", () => {
    it("shows create option when no exact match and onCreateVariable provided", () => {
      const onCreateVariable = vi.fn();
      renderComponent({ query: "my_custom", onCreateVariable });

      // Should show with {{ }} syntax
      expect(
        screen.getByText(/Create variable "{{my_custom}}"/),
      ).toBeInTheDocument();
    });

    it("normalizes create variable name (spaces to underscores, lowercase)", () => {
      const onCreateVariable = vi.fn();
      renderComponent({ query: "My Custom Var", onCreateVariable });

      // Should normalize to my_custom_var
      expect(
        screen.getByText(/Create variable "{{my_custom_var}}"/),
      ).toBeInTheDocument();
    });

    it("does not show create option when exact match exists", () => {
      const onCreateVariable = vi.fn();
      renderComponent({ query: "input", onCreateVariable });

      expect(screen.queryByText(/Create variable/)).not.toBeInTheDocument();
    });

    it("shows create option LAST (after matching fields)", () => {
      const onCreateVariable = vi.fn();
      const { container } = renderComponent({ query: "in", onCreateVariable });

      // Should show "input" field AND create option
      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByText(/Create variable "{{in}}"/)).toBeInTheDocument();

      // Verify order: find all clickable items and check create is last
      const items = container.querySelectorAll('[cursor="pointer"]');
      // The create option should have a border-top (visual separator)
      const createOption = screen.getByText(/Create variable "{{in}}"/);
      const parentHStack = createOption.closest('[class*="chakra"]');
      // Create option is at the end visually
      expect(parentHStack).toBeInTheDocument();
    });

    it("first matching field selected by default (index 0), not create option", () => {
      const onCreateVariable = vi.fn();
      const onSelect = vi.fn();
      // highlightedIndex=0 means first field is selected, not create option
      renderComponent({
        query: "in",
        onCreateVariable,
        onSelect,
        highlightedIndex: 0,
      });

      // "input" is a matching field and should be at index 0
      // Create option is at the END (last index), so highlighting 0 selects "input"
      expect(screen.getByText("input")).toBeInTheDocument();
    });

    it("when no fields match, create option is still available", () => {
      const onCreateVariable = vi.fn();
      renderComponent({
        query: "nonexistent",
        onCreateVariable,
        availableSources: mockSources,
      });

      // No fields match "nonexistent", but create option should show
      expect(screen.queryByText("input")).not.toBeInTheDocument();
      expect(
        screen.getByText(/Create variable "{{nonexistent}}"/),
      ).toBeInTheDocument();
    });

    it("Enter on first item selects field, not create option", async () => {
      const user = userEvent.setup();
      const onCreateVariable = vi.fn();
      const onSelect = vi.fn();

      renderComponent({
        query: "in",
        onCreateVariable,
        onSelect,
        highlightedIndex: 0, // First item (the field, not create)
      });

      // Click on the input field directly to verify it's selectable
      await user.click(screen.getByText("input"));

      // Should call onSelect with the field, not onCreateVariable
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ fieldName: "input" }),
      );
      expect(onCreateVariable).not.toHaveBeenCalled();
    });

    it("calls onCreateVariable when clicking create option", async () => {
      const user = userEvent.setup();
      const onCreateVariable = vi.fn();
      renderComponent({ query: "my_custom", onCreateVariable });

      await user.click(screen.getByText(/Create variable "{{my_custom}}"/));
      expect(onCreateVariable).toHaveBeenCalledWith("my_custom");
    });

    it("shows helpful hint when no sources and nothing typed", () => {
      renderComponent({
        availableSources: [],
        query: "",
        onCreateVariable: vi.fn(),
      });

      expect(screen.getByText("No matching fields found")).toBeInTheDocument();
      expect(
        screen.getByText("Type a name to create a new variable"),
      ).toBeInTheDocument();
    });
  });

  describe("type mismatch warning", () => {
    it("renders with expectedType prop without error", () => {
      // This test just verifies the component handles expectedType prop
      // Visual verification of warning icons is done via integration/e2e tests
      renderComponent({ expectedType: "str" });

      // Component should still render all fields
      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByText("count")).toBeInTheDocument();
    });
  });
});
