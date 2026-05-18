/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import type { PromptConfigFormValues } from "~/prompts/types";
import {
  RuntimeParametersField,
  RuntimeParametersReadonly,
} from "../RuntimeParametersField";

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

async function expandCollapsible(user: ReturnType<typeof userEvent.setup>) {
  const triggers = screen.getAllByRole("button", {
    name: /runtime parameters/i,
  });
  await user.click(triggers[0]!);
}

afterEach(cleanup);

describe("<RuntimeParametersField />", () => {
  describe("when adding key-value parameters", () => {
    it("adds a parameter row and writes to the form", async () => {
      /**
       * @scenario Prompt editor saves runtime parameters from key-value inputs
       */
      const user = userEvent.setup();
      renderField({ existing: "value" });

      await expandCollapsible(user);
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
    it("removes the row and updates the form", async () => {
      /**
       * @scenario Prompt editor removes a runtime parameter
       */
      const user = userEvent.setup();
      renderField({ enabled: true, retries: 3 });

      await expandCollapsible(user);

      expect(screen.getByTestId("param-key-0")).toHaveValue("enabled");
      expect(screen.getByTestId("param-key-1")).toHaveValue("retries");

      await user.click(screen.getByTestId("remove-param-0"));

      expect(screen.getByTestId("parameters-value")).toHaveTextContent(
        '{"retries":3}',
      );
    });
  });

  describe("when loading existing parameters", () => {
    it("displays pre-populated key-value rows", async () => {
      /**
       * @scenario Prompt editor displays existing runtime parameters as key-value rows
       */
      const user = userEvent.setup();
      renderField({
        confidence: 0.85,
        use_documents: true,
      });

      await expandCollapsible(user);

      expect(screen.getByTestId("param-key-0")).toHaveValue("confidence");
      expect(screen.getByTestId("param-value-0")).toHaveValue("0.85");
      expect(screen.getByTestId("param-key-1")).toHaveValue("use_documents");
      expect(screen.getByTestId("param-value-1")).toHaveValue("true");
    });
  });

  describe("when collapsible shows parameter count", () => {
    it("displays the count badge when parameters exist", () => {
      renderField({ a: 1, b: 2, c: 3 });

      expect(screen.getByText("(3)")).toBeInTheDocument();
    });
  });

  describe("when using JSON editor fallback", () => {
    it("switches to JSON editor and applies valid JSON", async () => {
      /**
       * @scenario Prompt editor allows editing parameters as raw JSON
       */
      const user = userEvent.setup();
      renderField();

      await expandCollapsible(user);
      await user.click(screen.getByText("Edit as JSON"));

      const textarea = screen.getByRole("textbox", {
        name: /runtime parameters json/i,
      });
      fireEvent.change(textarea, {
        target: { value: '{"timeout_ms": 5000}' },
      });
      await user.click(screen.getByText("Apply JSON"));

      expect(screen.getByTestId("parameters-value")).toHaveTextContent(
        '{"timeout_ms":5000}',
      );
    });

    it("shows error for invalid JSON", async () => {
      const user = userEvent.setup();
      renderField();

      await expandCollapsible(user);
      await user.click(screen.getByText("Edit as JSON"));

      const textarea = screen.getByRole("textbox", {
        name: /runtime parameters json/i,
      });
      fireEvent.change(textarea, { target: { value: "{invalid" } });
      await user.click(screen.getByText("Apply JSON"));

      expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
    });
  });
});

describe("<RuntimeParametersReadonly />", () => {
  describe("when parameters exist", () => {
    it("renders key-value rows", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <RuntimeParametersReadonly
            value={{ search_iterations: 5, enabled: true }}
          />
        </ChakraProvider>,
      );

      const container = screen.getByTestId("runtime-parameters-readonly");
      expect(
        within(container).getByText("search_iterations"),
      ).toBeInTheDocument();
      expect(within(container).getByText("5")).toBeInTheDocument();
      expect(within(container).getByText("enabled")).toBeInTheDocument();
      expect(within(container).getByText("true")).toBeInTheDocument();
    });
  });

  describe("when no parameters exist", () => {
    it("shows empty state", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <RuntimeParametersReadonly value={{}} />
        </ChakraProvider>,
      );

      expect(
        screen.getByTestId("runtime-parameters-readonly"),
      ).toHaveTextContent("No parameters defined");
    });
  });
});
