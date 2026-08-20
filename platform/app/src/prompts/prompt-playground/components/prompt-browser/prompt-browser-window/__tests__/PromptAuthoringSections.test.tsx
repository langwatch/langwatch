/**
 * @vitest-environment jsdom
 *
 * What a prompt declares — its variables and its parameters — now sits in the
 * editor pane beside the messages that reference them, rather than behind a
 * sub-tab on the conversation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts/types";
import { PromptAuthoringSections } from "../PromptAuthoringSections";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
    projectId: "test-project",
  }),
}));

function FormWrapper({
  children,
  defaultValues,
}: {
  children: React.ReactNode;
  defaultValues?: Partial<PromptConfigFormValues>;
}) {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      ...defaultValues,
      version: {
        parameters: {},
        configData: {
          inputs: [],
          demonstrations: { inline: { records: {} } },
        },
        ...(defaultValues?.version ?? {}),
      },
    },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

const renderSections = (formValues?: Partial<PromptConfigFormValues>) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <FormWrapper defaultValues={formValues}>
        <PromptAuthoringSections />
      </FormWrapper>
    </ChakraProvider>,
  );

const withConfig = (config: {
  inputs?: Array<{ identifier: string; type: string }>;
  parameters?: Record<string, unknown>;
}): Partial<PromptConfigFormValues> => ({
  version: {
    parameters: config.parameters ?? {},
    configData: {
      inputs: config.inputs ?? [],
      demonstrations: { inline: { records: {} } },
    },
  } as any,
});

describe("the prompt's declaration sections", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when a prompt is open in the editor", () => {
    /** @scenario The editor explains what parameters are, apart from variables */
    it("explains variables and parameters side by side", () => {
      renderSections(
        withConfig({ inputs: [{ identifier: "input", type: "str" }] }),
      );

      expect(
        screen.getByText(/variables are substituted into the prompt/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/parameters are arbitrary configurations/i),
      ).toBeInTheDocument();
    });

    /** @scenario Variables and parameters are reachable without leaving the prompt */
    it("shows both without anything to open first", () => {
      renderSections(
        withConfig({
          inputs: [{ identifier: "topic", type: "str" }],
          parameters: { environment: "production" },
        }),
      );

      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.getByTestId("variable-name-topic")).toBeInTheDocument();
      expect(screen.getByTestId("param-key-0")).toHaveValue("environment");
      expect(screen.getByTestId("param-value-0")).toHaveValue("production");
    });
  });

  describe("when the prompt declares variables", () => {
    /** @scenario A variable's value is not settable where it is declared */
    it("declares name and type only, with no value field", () => {
      renderSections(
        withConfig({ inputs: [{ identifier: "topic", type: "str" }] }),
      );

      expect(screen.getByTestId("variable-name-topic")).toBeInTheDocument();
      // The value a variable takes belongs to one run, and is set at the
      // message box. A second field for it here is a value nobody can be sure
      // of, which is what the sub-tab arrangement shipped.
      expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    });

    it("keeps the input variable listed but not removable", () => {
      renderSections(
        withConfig({
          inputs: [
            { identifier: "input", type: "str" },
            { identifier: "topic", type: "str" },
          ],
        }),
      );

      expect(screen.getByTestId("variable-name-input")).toBeInTheDocument();
      expect(screen.getByTestId("variable-info-input")).toBeInTheDocument();
      expect(
        screen.queryByTestId("remove-variable-input"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("remove-variable-topic")).toBeInTheDocument();
    });
  });
});
