/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock components with complex transitive dependencies
vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
}));

import {
  OutputsSection,
  LLM_OUTPUT_TYPES,
  CODE_OUTPUT_TYPES,
  type Output,
  type OutputType,
} from "../OutputsSection";

const renderComponent = (props: Partial<Parameters<typeof OutputsSection>[0]> = {}) => {
  const defaultProps = {
    outputs: [],
    onChange: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <OutputsSection {...defaultProps} {...props} />
    </ChakraProvider>
  );
};

describe("OutputsSection", () => {
  afterEach(() => {
    cleanup();
  });

  describe("header", () => {
    it("displays Outputs title by default", () => {
      renderComponent();
      expect(screen.getByText("Outputs")).toBeInTheDocument();
    });

    it("displays custom title when provided", () => {
      renderComponent({ title: "Custom Outputs" });
      expect(screen.getByText("Custom Outputs")).toBeInTheDocument();
    });

    it("shows add button when canAddRemove is true", () => {
      renderComponent({ canAddRemove: true });
      expect(screen.getByTestId("add-output-button")).toBeInTheDocument();
    });

    it("hides add button when canAddRemove is false", () => {
      renderComponent({ canAddRemove: false });
      expect(screen.queryByTestId("add-output-button")).not.toBeInTheDocument();
    });

    it("hides add button when readOnly is true", () => {
      renderComponent({ readOnly: true });
      expect(screen.queryByTestId("add-output-button")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty message when no outputs", () => {
      renderComponent({ outputs: [] });
      expect(screen.getByText("No outputs defined")).toBeInTheDocument();
    });
  });

  describe("displaying outputs", () => {
    it("renders output list", () => {
      const outputs: Output[] = [
        { identifier: "result", type: "str" },
        { identifier: "score", type: "float" },
      ];
      renderComponent({ outputs });

      expect(screen.getByText("result")).toBeInTheDocument();
      expect(screen.getByText("score")).toBeInTheDocument();
    });

    it("shows delete button when canAddRemove is true and has multiple outputs", () => {
      const outputs: Output[] = [
        { identifier: "output1", type: "str" },
        { identifier: "output2", type: "str" },
      ];
      renderComponent({ outputs, canAddRemove: true });

      // Should have delete buttons for each output
      expect(screen.getByTestId("remove-output-output1")).toBeInTheDocument();
      expect(screen.getByTestId("remove-output-output2")).toBeInTheDocument();
    });

    it("disables delete button when canAddRemove is false", () => {
      const outputs: Output[] = [
        { identifier: "output1", type: "str" },
        { identifier: "output2", type: "str" },
      ];
      renderComponent({ outputs, canAddRemove: false });

      // Button is still rendered but disabled
      expect(screen.getByTestId("remove-output-output1")).toBeDisabled();
    });
  });

  describe("availableTypes prop", () => {
    it("defaults to LLM_OUTPUT_TYPES when availableTypes not provided", async () => {
      const user = userEvent.setup();
      renderComponent({ canAddRemove: true });

      // Open the add menu
      const addButton = screen.getByTestId("add-output-button");
      await user.click(addButton);

      // Should show LLM types: str, float, bool, json_schema
      await waitFor(() => {
        expect(screen.getByText("Text")).toBeInTheDocument();
        expect(screen.getByText("Number")).toBeInTheDocument();
        expect(screen.getByText("Boolean")).toBeInTheDocument();
        expect(screen.getByText("JSON Schema")).toBeInTheDocument();
      });

      // Should NOT show code-only types
      expect(screen.queryByText("Object")).not.toBeInTheDocument();
      expect(screen.queryByText("List")).not.toBeInTheDocument();
      expect(screen.queryByText("Image")).not.toBeInTheDocument();
    });

    it("shows only LLM_OUTPUT_TYPES when explicitly set", async () => {
      const user = userEvent.setup();
      renderComponent({ canAddRemove: true, availableTypes: LLM_OUTPUT_TYPES });

      const addButton = screen.getByTestId("add-output-button");
      await user.click(addButton);

      await waitFor(() => {
        expect(screen.getByText("Text")).toBeInTheDocument();
        expect(screen.getByText("JSON Schema")).toBeInTheDocument();
      });

      expect(screen.queryByText("Object")).not.toBeInTheDocument();
      expect(screen.queryByText("List")).not.toBeInTheDocument();
    });

    it("shows CODE_OUTPUT_TYPES when set for code blocks", async () => {
      const user = userEvent.setup();
      renderComponent({ canAddRemove: true, availableTypes: CODE_OUTPUT_TYPES });

      const addButton = screen.getByTestId("add-output-button");
      await user.click(addButton);

      // Should show code types: str, float, bool, dict, list, image
      await waitFor(() => {
        expect(screen.getByText("Text")).toBeInTheDocument();
        expect(screen.getByText("Number")).toBeInTheDocument();
        expect(screen.getByText("Boolean")).toBeInTheDocument();
        expect(screen.getByText("Object")).toBeInTheDocument();
        expect(screen.getByText("List")).toBeInTheDocument();
        expect(screen.getByText("Image")).toBeInTheDocument();
      });

      // Should NOT show JSON Schema (LLM-only type)
      expect(screen.queryByText("JSON Schema")).not.toBeInTheDocument();
    });

    it("filters type dropdown options based on availableTypes", async () => {
      const user = userEvent.setup();
      const outputs: Output[] = [{ identifier: "output", type: "str" }];
      const { container } = renderComponent({
        outputs,
        availableTypes: CODE_OUTPUT_TYPES,
      });

      // Find the type selector dropdown and check its options
      const select = container.querySelector("select");
      expect(select).toBeInTheDocument();

      if (select) {
        const options = Array.from(select.querySelectorAll("option")).map(
          (opt) => opt.textContent
        );
        // Should have code types
        expect(options).toContain("Text");
        expect(options).toContain("Object");
        expect(options).toContain("List");
        expect(options).toContain("Image");
        // Should NOT have JSON Schema
        expect(options).not.toContain("JSON Schema");
      }
    });
  });

  // Note: Adding outputs via menu is tested in integration tests
  // The menu interaction is complex due to Chakra portals

  describe("removing outputs", () => {
    it("calls onChange without the removed output", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const outputs: Output[] = [
        { identifier: "output1", type: "str" },
        { identifier: "output2", type: "str" },
      ];
      renderComponent({ outputs, onChange, canAddRemove: true });

      // Find and click the remove button for output2
      const removeButton = screen.getByTestId("remove-output-output2");
      await user.click(removeButton);

      expect(onChange).toHaveBeenCalledWith([{ identifier: "output1", type: "str" }]);
    });

    it("disables remove button for last output", () => {
      const outputs: Output[] = [{ identifier: "output", type: "str" }];
      renderComponent({ outputs, canAddRemove: true });

      // Remove button should exist but be disabled for single output
      const removeButton = screen.getByTestId("remove-output-output");
      expect(removeButton).toBeDisabled();
    });
  });

  describe("editing output identifier", () => {
    it("allows editing identifier on click", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const outputs: Output[] = [{ identifier: "output", type: "str" }];
      renderComponent({ outputs, onChange });

      // Click on the identifier to edit
      const identifier = screen.getByText("output");
      await user.click(identifier);

      // Should show input field
      const input = screen.getByRole("textbox");
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue("output");
    });

    it("updates identifier on blur", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const outputs: Output[] = [{ identifier: "output", type: "str" }];
      renderComponent({ outputs, onChange });

      // Click to edit
      const identifier = screen.getByText("output");
      await user.click(identifier);

      // Change the value
      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "new_output");
      fireEvent.blur(input);

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ identifier: "new_output", type: "str" }),
      ]);
    });
  });

  describe("changing output type", () => {
    it("updates type when selecting from dropdown", async () => {
      const onChange = vi.fn();
      const outputs: Output[] = [{ identifier: "output", type: "str" }];
      const { container } = renderComponent({ outputs, onChange });

      // Find the type selector
      const select = container.querySelector("select");
      expect(select).toBeInTheDocument();

      // Change to float
      if (select) {
        fireEvent.change(select, { target: { value: "float" } });
      }

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ identifier: "output", type: "float" }),
      ]);
    });
  });

  describe("read-only mode", () => {
    it("prevents editing identifier in read-only mode", async () => {
      const user = userEvent.setup();
      const outputs: Output[] = [{ identifier: "output", type: "str" }];
      renderComponent({ outputs, readOnly: true });

      // Click on identifier
      const identifier = screen.getByText("output");
      await user.click(identifier);

      // Should NOT show input field
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("hides type selector in read-only mode", () => {
      const outputs: Output[] = [{ identifier: "output", type: "str" }];
      const { container } = renderComponent({ outputs, readOnly: true });

      // In read-only mode, there's no select - just an icon
      const select = container.querySelector("select");
      expect(select).not.toBeInTheDocument();
    });

    it("hides remove button in read-only mode", () => {
      const outputs: Output[] = [
        { identifier: "output1", type: "str" },
        { identifier: "output2", type: "str" },
      ];
      renderComponent({ outputs, readOnly: true });

      expect(screen.queryByTestId("remove-output-output1")).not.toBeInTheDocument();
    });
  });
});
