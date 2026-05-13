/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { describe, expect, it } from "vitest";
import type { PromptConfigFormValues } from "~/prompts/types";
import { RuntimeConfigField } from "../RuntimeConfigField";

function FormValueProbe() {
  const methods = useFormContext<PromptConfigFormValues>();
  return (
    <output data-testid="config-value">
      {JSON.stringify(methods.watch("version.config"))}
    </output>
  );
}

function renderRuntimeConfigField(initialConfig: Record<string, unknown> = {}) {
  function Wrapper() {
    const methods = useForm<PromptConfigFormValues>({
      defaultValues: {
        handle: "search-agent",
        scope: "PROJECT",
        version: {
          config: initialConfig,
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
          <RuntimeConfigField />
          <FormValueProbe />
        </FormProvider>
      </ChakraProvider>
    );
  }

  return render(<Wrapper />);
}

describe("<RuntimeConfigField />", () => {
  it("writes valid JSON object values to the form", async () => {
    /**
     * @scenario Prompt editor saves runtime config from a JSON editor
     */
    const user = userEvent.setup();
    renderRuntimeConfigField();

    await user.click(screen.getByRole("button", { name: /runtime config/i }));
    const editor = screen.getByRole("textbox", {
      name: /runtime config json/i,
    });
    fireEvent.change(editor, {
      target: {
        value: '{"output_schema":{"type":"object"},"enabled":true}',
      },
    });

    expect(screen.getByTestId("config-value")).toHaveTextContent(
      '{"output_schema":{"type":"object"},"enabled":true}',
    );
  });

  it("shows a validation error for invalid JSON", async () => {
    /**
     * @scenario Prompt editor blocks invalid runtime config JSON
     */
    const user = userEvent.setup();
    renderRuntimeConfigField();

    await user.click(screen.getByRole("button", { name: /runtime config/i }));
    const editor = screen.getByRole("textbox", {
      name: /runtime config json/i,
    });
    fireEvent.change(editor, { target: { value: "{invalid" } });

    expect(screen.getByText("Config must be valid JSON")).toBeInTheDocument();
  });
});
