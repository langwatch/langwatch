/**
 * @vitest-environment jsdom
 *
 * @regression Tests that LLM config validation errors are visible
 * when the config popover is closed (issue #863).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock @prisma/client (transitively imported via ~/prompts barrel export)
vi.mock("@prisma/client", () => ({
  PromptScope: { GLOBAL: "GLOBAL", LOCAL: "LOCAL" },
}));

// Mock deep transitive dependencies that don't exist in worktree env
vi.mock("~/optimization_studio/types/dsl", () => ({
  nodeDatasetSchema: { optional: () => ({}) },
}));

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: vi.fn(),
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
    organization: { id: "test-org" },
    team: null,
  }),
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "test-user" } },
    status: "authenticated",
  }),
}));

// Mock useModelProvidersSettings
vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    providers: {},
    modelMetadata: {
      "openai/gpt-5-mini": {
        id: "openai/gpt-5-mini",
        name: "GPT-5 Mini",
        provider: "openai",
        supportedParameters: ["temperature", "max_tokens"],
        contextLength: 128000,
        maxCompletionTokens: 16384,
      },
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useModelMetadata: () => ({
    metadata: undefined,
    isLoading: false,
  }),
}));

// Mock ModelSelector
vi.mock("~/components/ModelSelector", () => ({
  allModelOptions: ["openai/gpt-5-mini"],
  ModelSelector: ({ model }: { model: string }) => (
    <select
      data-testid="model-selector"
      value={model}
      onChange={() => {}}
    >
      <option value="openai/gpt-5-mini">GPT-5 Mini</option>
    </select>
  ),
  useModelSelectionOptions: (
    _options: string[],
    model: string,
    _mode: string,
  ) => ({
    modelOption: { label: model, icon: null, isDisabled: false },
  }),
}));

// Mock CodeEditor
vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
}));

import { ModelSelectFieldMini } from "../ModelSelectFieldMini";

// Form values type matching the component's expected shape
type TestFormValues = {
  version: {
    configData: {
      inputs: { identifier: string; type: string }[];
      outputs: { identifier: string; type: string }[];
      messages: unknown[];
      llm: {
        model: string;
        temperature: number;
        maxTokens: number;
      };
    };
  };
};

// Store form methods for programmatic error setting
let testFormMethods: ReturnType<typeof useForm<TestFormValues>> | null = null;

const defaultLlmConfig = {
  model: "openai/gpt-5-mini",
  temperature: 0.7,
  maxTokens: 4096,
};

const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const methods = useForm<TestFormValues>({
    defaultValues: {
      version: {
        configData: {
          inputs: [],
          outputs: [{ identifier: "output", type: "str" }],
          messages: [],
          llm: defaultLlmConfig,
        },
      },
    },
  });

  testFormMethods = methods;

  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...methods}>{children}</FormProvider>
    </ChakraProvider>
  );
};

const renderComponent = () => {
  return render(
    <TestWrapper>
      <ModelSelectFieldMini />
    </TestWrapper>,
  );
};

describe("<ModelSelectFieldMini/>", () => {
  afterEach(() => {
    cleanup();
    testFormMethods = null;
  });

  describe("when LLM config has no validation errors", () => {
    it("displays a normal border on the trigger", () => {
      renderComponent();

      const trigger = screen.getByTestId("model-select-trigger");
      expect(trigger).not.toHaveAttribute("data-error");
    });

    it("does not show error text below the trigger", () => {
      renderComponent();

      expect(
        screen.queryByTestId("model-select-error-text"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when LLM config has validation errors", () => {
    const setTemperatureError = () => {
      testFormMethods!.setError("version.configData.llm.temperature", {
        type: "manual",
        message: "Temperature must be between 0 and 2",
      });
    };

    const setMaxTokensError = () => {
      testFormMethods!.setError("version.configData.llm.maxTokens", {
        type: "manual",
        message: "Max tokens must be positive",
      });
    };

    describe("when popover is closed", () => {
      it("displays a red border on the trigger", async () => {
        renderComponent();
        setTemperatureError();

        const trigger = await screen.findByTestId("model-select-trigger");
        expect(trigger).toHaveAttribute("data-error", "true");
      });

      it("shows temperature error text below the trigger", async () => {
        renderComponent();
        setTemperatureError();

        const errorText = await screen.findByTestId(
          "model-select-error-text",
        );
        expect(errorText).toHaveTextContent(
          "Temperature must be between 0 and 2",
        );
      });

      it("shows maxTokens error text below the trigger", async () => {
        renderComponent();
        setMaxTokensError();

        const errorText = await screen.findByTestId(
          "model-select-error-text",
        );
        expect(errorText).toHaveTextContent("Max tokens must be positive");
      });

      it("shows both error messages when both fields have errors", async () => {
        renderComponent();
        setTemperatureError();
        setMaxTokensError();

        const errorText = await screen.findByTestId(
          "model-select-error-text",
        );
        expect(errorText).toHaveTextContent(
          "Temperature must be between 0 and 2",
        );
        expect(errorText).toHaveTextContent("Max tokens must be positive");
      });
    });

    describe("when popover is open", () => {
      it("hides error text below the trigger", async () => {
        const user = userEvent.setup();
        renderComponent();
        setTemperatureError();

        // Error text is visible before opening
        await screen.findByTestId("model-select-error-text");

        // Open popover by clicking the trigger
        const trigger = screen.getByTestId("model-select-trigger");
        await user.click(trigger);

        // Error text is hidden when popover is open
        expect(
          screen.queryByTestId("model-select-error-text"),
        ).not.toBeInTheDocument();
      });
    });
  });
});
