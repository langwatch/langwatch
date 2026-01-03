/**
 * @vitest-environment jsdom
 *
 * Integration tests for the locked input variable feature in prompt editing.
 * These tests verify that the VariablesSection correctly handles locked variables
 * with info tooltips, using the configuration defined in PromptTabbedSection.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VariablesSection, type Variable } from "~/components/variables";

// The locked variables configuration from PromptTabbedSection
const LOCKED_VARIABLES = new Set(["input"]);
const VARIABLE_INFO: Record<string, string> = {
  input: "This value comes from the Conversation tab input",
};

const renderVariablesSection = (props: {
  variables: Variable[];
  onChange?: (variables: Variable[]) => void;
  values?: Record<string, string>;
  onValueChange?: (identifier: string, value: string) => void;
}) => {
  const onChange = props.onChange ?? vi.fn();
  const onValueChange = props.onValueChange ?? vi.fn();

  return render(
    <ChakraProvider value={defaultSystem}>
      <VariablesSection
        variables={props.variables}
        onChange={onChange}
        values={props.values ?? {}}
        onValueChange={onValueChange}
        showMappings={false}
        canAddRemove={true}
        readOnly={false}
        title="Variables"
        lockedVariables={LOCKED_VARIABLES}
        variableInfo={VARIABLE_INFO}
      />
    </ChakraProvider>
  );
};

describe("Playground Variables Section Integration", () => {
  afterEach(() => {
    cleanup();
  });

  describe("locked input variable", () => {
    it("shows input variable with info icon", () => {
      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
      });

      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByTestId("variable-info-input")).toBeInTheDocument();
    });

    it("does not show delete button for input variable", () => {
      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
      });

      expect(screen.queryByTestId("remove-variable-input")).not.toBeInTheDocument();
    });

    it("shows delete button for non-locked variables", () => {
      renderVariablesSection({
        variables: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
      });

      // Input should not have delete button
      expect(screen.queryByTestId("remove-variable-input")).not.toBeInTheDocument();
      // Context should have delete button
      expect(screen.getByTestId("remove-variable-context")).toBeInTheDocument();
    });

    it("prevents editing locked variable name by making it read-only", () => {
      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
      });

      // The variable name should have cursor: default (not pointer) since it's locked
      const nameElement = screen.getByTestId("variable-name-input");
      expect(nameElement).toHaveStyle({ cursor: "default" });
    });
  });

  describe("adding and removing variables", () => {
    it("can add a new variable", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
        onChange,
      });

      await user.click(screen.getByTestId("add-variable-button"));

      // onChange should be called with the new variable added
      expect(onChange).toHaveBeenCalledWith([
        { identifier: "input", type: "str" },
        { identifier: "input_1", type: "str" },
      ]);
    });

    it("can remove a non-locked variable", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      renderVariablesSection({
        variables: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
        onChange,
      });

      await user.click(screen.getByTestId("remove-variable-context"));

      // onChange should be called with only input remaining
      expect(onChange).toHaveBeenCalledWith([{ identifier: "input", type: "str" }]);
    });

    it("cannot remove the locked input variable", () => {
      renderVariablesSection({
        variables: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
      });

      // Input delete button should not exist
      expect(screen.queryByTestId("remove-variable-input")).not.toBeInTheDocument();
      // But we can still see the variable
      expect(screen.getByText("input")).toBeInTheDocument();
    });
  });

  describe("variable values", () => {
    it("displays values for variables", () => {
      renderVariablesSection({
        variables: [
          { identifier: "input", type: "str" },
          { identifier: "context", type: "str" },
        ],
        values: {
          input: "Hello world",
          context: "Some context",
        },
      });

      // Values should be shown in inputs
      const inputs = screen.getAllByRole("textbox");
      expect(inputs.some((input) => (input as HTMLInputElement).value === "Hello world")).toBe(true);
      expect(inputs.some((input) => (input as HTMLInputElement).value === "Some context")).toBe(true);
    });

    it("calls onValueChange when value is edited", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();

      renderVariablesSection({
        variables: [{ identifier: "input", type: "str" }],
        values: { input: "" },
        onValueChange,
      });

      const inputs = screen.getAllByRole("textbox");
      const valueInput = inputs.find((input) => (input as HTMLInputElement).value === "");

      if (valueInput) {
        await user.type(valueInput, "test");
        expect(onValueChange).toHaveBeenCalled();
      }
    });
  });
});
