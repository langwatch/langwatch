/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VariableMappingInput,
  type AvailableSource,
  type FieldMapping,
} from "../VariableMappingInput";

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
      { name: "parsed_result", type: "json" },
    ],
  },
];

const renderComponent = (props: Partial<Parameters<typeof VariableMappingInput>[0]> = {}) => {
  return render(
    <ChakraProvider value={defaultSystem}>
      <VariableMappingInput
        availableSources={mockSources}
        {...props}
      />
    </ChakraProvider>
  );
};

describe("VariableMappingInput", () => {
  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders with placeholder text", () => {
      renderComponent({ placeholder: "Select a source..." });
      expect(screen.getByPlaceholderText("Select a source...")).toBeInTheDocument();
    });

    it("renders with default value when no mapping", () => {
      renderComponent({ defaultValue: "Hello world" });
      expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
    });

    it("displays mapping value when mapped", () => {
      const mapping: FieldMapping = { sourceId: "dataset-1", field: "input" };
      renderComponent({ mapping });
      expect(screen.getByDisplayValue("Test Data.input")).toBeInTheDocument();
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
      await user.type(input, "output");

      await waitFor(() => {
        expect(screen.getByText("expected_output")).toBeInTheDocument();
        expect(screen.getByText("output")).toBeInTheDocument();
        expect(screen.queryByText("input")).not.toBeInTheDocument();
        expect(screen.queryByText("count")).not.toBeInTheDocument();
      });
    });

    it("shows no results message when no matches", async () => {
      const user = userEvent.setup();
      renderComponent();

      const input = screen.getByRole("textbox");
      await user.click(input);
      await user.type(input, "nonexistent");

      await waitFor(() => {
        expect(screen.getByText("No matching fields found")).toBeInTheDocument();
      });
    });
  });

  describe("selection", () => {
    it("calls onMappingChange when field is selected", async () => {
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

  describe("default value input", () => {
    it("calls onDefaultValueChange when typing", async () => {
      const user = userEvent.setup();
      const onDefaultValueChange = vi.fn();
      renderComponent({ onDefaultValueChange });

      const input = screen.getByRole("textbox");
      await user.type(input, "Hello");

      expect(onDefaultValueChange).toHaveBeenLastCalledWith("Hello");
    });

    it("clears mapping when user types", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      const mapping: FieldMapping = { sourceId: "dataset-1", field: "input" };
      renderComponent({ mapping, onMappingChange });

      const input = screen.getByRole("textbox");
      await user.click(input);
      await user.type(input, "x");

      expect(onMappingChange).toHaveBeenCalledWith(undefined);
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

  describe("type mismatch warning", () => {
    it("shows warning icon when types do not match", () => {
      const mapping: FieldMapping = { sourceId: "dataset-1", field: "count" };
      // count is "float" but we expect "str"
      const { container } = renderComponent({ mapping, expectedType: "str" });

      // Count SVGs: source icon + chevron down + alert triangle = 3
      const allSvgs = container.querySelectorAll('svg');
      expect(allSvgs.length).toBe(3);
    });

    it("does not show warning when types match", () => {
      const mapping: FieldMapping = { sourceId: "dataset-1", field: "input" };
      // input is "str" and we expect "str"
      const { container } = renderComponent({ mapping, expectedType: "str" });

      // Count SVGs: source icon + chevron down = 2 (no alert triangle)
      const allSvgs = container.querySelectorAll('svg');
      expect(allSvgs.length).toBe(2);
    });
  });
});
