/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { describe, expect, it } from "vitest";
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

function renderRuntimeParametersField(initialParameters: Record<string, unknown> = {}) {
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

describe("<RuntimeParametersField />", () => {
  it("writes valid JSON object values to the form", async () => {
    /**
     * @scenario Prompt editor saves runtime parameters from a JSON editor
     */
    const user = userEvent.setup();
    renderRuntimeParametersField();

    await user.click(screen.getByRole("button", { name: /runtime parameters/i }));
    const editor = screen.getByRole("textbox", {
      name: /runtime parameters json/i,
    });
    fireEvent.change(editor, {
      target: {
        value: '{"output_schema":{"type":"object"},"enabled":true}',
      },
    });

    expect(screen.getByTestId("parameters-value")).toHaveTextContent(
      '{"output_schema":{"type":"object"},"enabled":true}',
    );
  });

  it("shows a validation error for invalid JSON", async () => {
    /**
     * @scenario Prompt editor blocks invalid runtime parameters JSON
     */
    const user = userEvent.setup();
    renderRuntimeParametersField();

    const triggers = screen.getAllByRole("button", { name: /runtime parameters/i });
    await user.click(triggers[0]!);
    const editor = screen.getByRole("textbox", {
      name: /runtime parameters json/i,
    });
    fireEvent.change(editor, { target: { value: "{invalid" } });

    expect(screen.getByText("Parameters must be valid JSON")).toBeInTheDocument();
  });
});
