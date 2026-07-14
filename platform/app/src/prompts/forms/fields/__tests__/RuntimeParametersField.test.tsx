/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import type { PromptConfigFormValues } from "~/prompts/types";
import { RuntimeParametersField } from "../RuntimeParametersField";

function FormValueProbe() {
  const methods = useFormContext<PromptConfigFormValues>();
  return (
    <output data-testid="parameters-value">
      {JSON.stringify(methods.watch("version.parameters"))}
    </output>
  );
}

function renderField(initialParameters: Record<string, unknown> = {}) {
  function Wrapper() {
    const methods = useForm<PromptConfigFormValues>({
      defaultValues: {
        handle: "search-agent",
        scope: "PROJECT",
        version: {
          parameters: initialParameters,
          configData: {
            llm: { model: "openai/gpt-4o" },
            messages: [],
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      },
    });

    return (
      <ChakraProvider value={defaultSystem}>
        <FormProvider {...methods}>
          <RuntimeParametersField />
          <FormValueProbe />
        </FormProvider>
      </ChakraProvider>
    );
  }

  return render(<Wrapper />);
}

afterEach(cleanup);

describe("<RuntimeParametersField />", () => {
  describe("when rendering empty state", () => {
    /** @scenario Parameters tab shows empty state when no parameters are defined */
    it("shows header with + Add button and empty state text", () => {
      renderField();

      expect(screen.getByText("Parameters")).toBeInTheDocument();
      expect(screen.getByTestId("add-parameter-button")).toBeInTheDocument();
      expect(screen.getByText("No parameters defined")).toBeInTheDocument();
    });
  });

  describe("when adding key-value parameters", () => {
    /** @scenario Parameters tab shows "+ Add" button and allows adding key-value parameters */
    it("adds a parameter row and writes to the form", async () => {
      const user = userEvent.setup();
      renderField({ existing: "value" });

      await user.click(screen.getByTestId("add-parameter-button"));

      const keyInput = await waitFor(() => screen.getByTestId("param-key-1"));
      const valueInput = screen.getByTestId("param-value-1");

      fireEvent.change(keyInput, { target: { value: "search_iterations" } });
      fireEvent.change(valueInput, { target: { value: "5" } });

      expect(screen.getByTestId("parameters-value")).toHaveTextContent(
        '"search_iterations":5',
      );
    });
  });

  describe("when removing a parameter", () => {
    /** @scenario User deletes a parameter via the remove button */
    it("removes the row and updates the form", async () => {
      const user = userEvent.setup();
      renderField({ enabled: true, retries: 3 });

      expect(screen.getByTestId("param-key-0")).toHaveValue("enabled");
      expect(screen.getByTestId("param-key-1")).toHaveValue("retries");

      await user.click(screen.getByTestId("remove-param-0"));

      expect(screen.getByTestId("parameters-value")).toHaveTextContent(
        '{"retries":3}',
      );
    });
  });

  describe("when loading existing parameters", () => {
    it("displays pre-populated key-value rows", () => {
      renderField({
        confidence: 0.85,
        use_documents: true,
      });

      expect(screen.getByTestId("param-key-0")).toHaveValue("confidence");
      expect(screen.getByTestId("param-value-0")).toHaveValue("0.85");
      expect(screen.getByTestId("param-key-1")).toHaveValue("use_documents");
      expect(screen.getByTestId("param-value-1")).toHaveValue("true");
    });
  });

  describe("when editing a parameter value", () => {
    /** @scenario User edits parameter key and value inline */
    it("updates the form with the new value", () => {
      renderField({ environment: "production" });

      const valueInput = screen.getByTestId("param-value-0");
      fireEvent.change(valueInput, { target: { value: "staging" } });

      expect(screen.getByTestId("parameters-value")).toHaveTextContent(
        '"environment":"staging"',
      );
    });
  });

  describe("when editing a parameter key", () => {
    it("updates the form with the new key", () => {
      renderField({ old_key: "value" });

      const keyInput = screen.getByTestId("param-key-0");
      fireEvent.change(keyInput, { target: { value: "new_key" } });

      expect(screen.getByTestId("parameters-value")).toHaveTextContent(
        '"new_key":"value"',
      );
    });
  });

  describe("when a string value looks like another JSON type", () => {
    // Regression: parameters set via REST/tRPC/SDK carry real JSON. A string
    // like "007" must not be silently coerced to the number 7 when an
    // unrelated row is edited. Such strings are shown quoted and round-trip
    // back to the same string.
    it("displays type-ambiguous string values quoted", () => {
      renderField({ port: "123", flag: "true", blob: "{}" });

      expect(screen.getByTestId("param-value-0")).toHaveValue('"123"');
      expect(screen.getByTestId("param-value-1")).toHaveValue('"true"');
      expect(screen.getByTestId("param-value-2")).toHaveValue('"{}"');
    });

    it("preserves the string type when an unrelated row is edited", () => {
      renderField({ port: "123", other: "x" });

      // Edit the unrelated row, which re-serializes every row.
      fireEvent.change(screen.getByTestId("param-value-1"), {
        target: { value: "y" },
      });

      const stored = screen.getByTestId("parameters-value");
      // port stays the string "123", does NOT become the number 123.
      expect(stored).toHaveTextContent('"port":"123"');
      expect(stored).not.toHaveTextContent('"port":123');
    });

    it("still coerces unquoted numbers and booleans to their JSON types", async () => {
      const user = userEvent.setup();
      renderField();

      await user.click(screen.getByTestId("add-parameter-button"));
      fireEvent.change(screen.getByTestId("param-key-0"), {
        target: { value: "count" },
      });
      fireEvent.change(screen.getByTestId("param-value-0"), {
        target: { value: "5" },
      });

      expect(screen.getByTestId("parameters-value")).toHaveTextContent(
        '"count":5',
      );
    });
  });
});
