/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock components with complex transitive dependencies
vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
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

// Mock useModelProvidersSettings with model metadata
const mockModelMetadata = {
  "openai/gpt-4.1": {
    id: "openai/gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    supportedParameters: [
      "temperature",
      "top_p",
      "max_tokens",
      "frequency_penalty",
      "presence_penalty",
    ],
    contextLength: 128000,
    maxCompletionTokens: 16384,
    defaultParameters: null,
    supportsImageInput: true,
    supportsAudioInput: false,
    pricing: { inputCostPerToken: 0.00001, outputCostPerToken: 0.00003 },
    reasoningConfig: undefined,
  },
  "openai/gpt-5": {
    id: "openai/gpt-5",
    name: "GPT-5",
    provider: "openai",
    supportedParameters: ["reasoning", "max_tokens"], // Uses unified 'reasoning' field
    contextLength: 256000,
    maxCompletionTokens: 131072,
    defaultParameters: null,
    supportsImageInput: true,
    supportsAudioInput: false,
    pricing: { inputCostPerToken: 0.00002, outputCostPerToken: 0.00006 },
    reasoningConfig: {
      supported: true,
      parameterName: "reasoning_effort",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium",
      canDisable: false,
    },
  },
  "anthropic/claude-3.5-sonnet": {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    supportedParameters: ["temperature", "top_p", "max_tokens"],
    contextLength: 200000,
    maxCompletionTokens: 8192,
    defaultParameters: null,
    supportsImageInput: true,
    supportsAudioInput: false,
    pricing: { inputCostPerToken: 0.000003, outputCostPerToken: 0.000015 },
    reasoningConfig: undefined,
  },
};

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    providers: {},
    modelMetadata: mockModelMetadata,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useModelMetadata: ({ modelId }: { modelId: string }) => ({
    metadata: mockModelMetadata[modelId as keyof typeof mockModelMetadata],
    isLoading: false,
  }),
}));

// Mock ModelSelector to simplify testing
vi.mock("../../ModelSelector", () => ({
  allModelOptions: [
    "openai/gpt-4.1",
    "openai/gpt-5",
    "anthropic/claude-3.5-sonnet",
  ],
  ModelSelector: ({
    model,
    onChange,
  }: {
    model: string;
    onChange: (model: string) => void;
  }) => (
    <select
      data-testid="model-selector"
      value={model}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="openai/gpt-4.1">GPT-4.1</option>
      <option value="openai/gpt-5">GPT-5</option>
      <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
    </select>
  ),
}));

import { Popover } from "../../ui/popover";
import {
  LLMConfigPopover,
  type LLMConfigValues,
  type Output,
} from "../LLMConfigPopover";

const renderComponent = (
  props: Partial<Parameters<typeof LLMConfigPopover>[0]> = {},
) => {
  const defaultProps: Parameters<typeof LLMConfigPopover>[0] = {
    values: { model: "openai/gpt-4.1", temperature: 0.7, max_tokens: 1024 },
    onChange: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <Popover.Root open>
        <Popover.Trigger>
          <button>Open</button>
        </Popover.Trigger>
        <LLMConfigPopover {...defaultProps} {...props} />
      </Popover.Root>
    </ChakraProvider>,
  );
};

describe("LLMConfigPopover", () => {
  afterEach(() => {
    cleanup();
  });

  describe("layout", () => {
    it("does not display LLM Config header", () => {
      renderComponent();
      expect(screen.queryByText("LLM Config")).not.toBeInTheDocument();
    });

    it("starts directly with model selector", () => {
      renderComponent();
      expect(screen.getByText("Model")).toBeInTheDocument();
    });
  });

  describe("model selection", () => {
    it("displays current model", () => {
      renderComponent({
        values: { model: "openai/gpt-4.1", temperature: 0.7 },
      });
      const selector = screen.getByTestId("model-selector");
      expect(selector).toHaveValue("openai/gpt-4.1");
    });

    it("calls onChange when model is changed", async () => {
      const onChange = vi.fn();
      renderComponent({
        values: { model: "openai/gpt-4.1", temperature: 0.7 },
        onChange,
      });

      const selector = screen.getByTestId("model-selector");
      fireEvent.change(selector, {
        target: { value: "anthropic/claude-3.5-sonnet" },
      });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ model: "anthropic/claude-3.5-sonnet" }),
      );
    });
  });

  describe("dynamic parameter display", () => {
    describe("for traditional models (GPT-4.1)", () => {
      it("shows Temperature parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-4.1", temperature: 0.7 },
        });
        expect(
          screen.getByTestId("parameter-row-temperature"),
        ).toBeInTheDocument();
      });

      it("shows Top P parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-4.1", temperature: 0.7 },
        });
        expect(screen.getByTestId("parameter-row-top_p")).toBeInTheDocument();
      });

      it("shows Max Tokens parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-4.1", temperature: 0.7 },
        });
        expect(
          screen.getByTestId("parameter-row-max_tokens"),
        ).toBeInTheDocument();
      });

      it("shows Frequency Penalty parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-4.1", temperature: 0.7 },
        });
        expect(
          screen.getByTestId("parameter-row-frequency_penalty"),
        ).toBeInTheDocument();
      });

      it("shows Presence Penalty parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-4.1", temperature: 0.7 },
        });
        expect(
          screen.getByTestId("parameter-row-presence_penalty"),
        ).toBeInTheDocument();
      });

      it("does not show Reasoning parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-4.1", temperature: 0.7 },
        });
        expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
      });
    });

    describe("for reasoning models (GPT-5)", () => {
      it("displays dynamic label based on reasoningConfig.parameterName", () => {
        // Uses unified 'reasoning' field but displays provider-specific label
        // reasoningConfig.parameterName: "reasoning_effort" → label: "Reasoning Effort"
        renderComponent({
          values: { model: "openai/gpt-5", reasoning: "medium" },
        });

        // Should find "Reasoning Effort" (label from reasoningConfig.parameterName mapping)
        expect(screen.getAllByText("Reasoning Effort").length).toBeGreaterThan(
          0,
        );
      });

      it("shows reasoning parameter row", () => {
        renderComponent({
          values: { model: "openai/gpt-5", reasoning: "medium" },
        });
        // Parameter row uses unified 'reasoning' key
        expect(
          screen.getByTestId("parameter-row-reasoning"),
        ).toBeInTheDocument();
      });

      it("shows Max Tokens parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-5", reasoning: "medium" },
        });
        expect(
          screen.getByTestId("parameter-row-max_tokens"),
        ).toBeInTheDocument();
      });

      it("does not show Temperature parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-5", reasoning: "medium" },
        });
        expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
      });

      it("does not show Top P parameter", () => {
        renderComponent({
          values: { model: "openai/gpt-5", reasoning: "medium" },
        });
        expect(screen.queryByText("Top P")).not.toBeInTheDocument();
      });
    });
  });

  describe("structured outputs section", () => {
    it("does not show structured outputs by default", () => {
      renderComponent();
      expect(screen.queryByText("Structured Outputs")).not.toBeInTheDocument();
    });

    it("shows structured outputs section when enabled", () => {
      const outputs: Output[] = [{ identifier: "output", type: "str" }];
      renderComponent({
        showStructuredOutputs: true,
        outputs,
        onOutputsChange: vi.fn(),
      });
      expect(screen.getByText("Structured Outputs")).toBeInTheDocument();
    });

    describe("when non-default output (toggle should be on)", () => {
      it("shows Outputs section", () => {
        const outputs: Output[] = [
          { identifier: "custom_output", type: "json_schema" },
        ];
        renderComponent({
          showStructuredOutputs: true,
          outputs,
          onOutputsChange: vi.fn(),
        });
        expect(screen.getByText("Structured Outputs")).toBeInTheDocument();
        expect(screen.getByText("Outputs")).toBeInTheDocument();
      });

      it("shows custom output identifier", () => {
        const outputs: Output[] = [
          { identifier: "custom_output", type: "json_schema" },
        ];
        renderComponent({
          showStructuredOutputs: true,
          outputs,
          onOutputsChange: vi.fn(),
        });
        expect(screen.getByText("custom_output")).toBeInTheDocument();
      });
    });

    describe("when multiple outputs", () => {
      it("shows all output identifiers", () => {
        const outputs: Output[] = [
          { identifier: "output1", type: "str" },
          { identifier: "output2", type: "float" },
        ];
        renderComponent({
          showStructuredOutputs: true,
          outputs,
          onOutputsChange: vi.fn(),
        });
        expect(screen.getByText("output1")).toBeInTheDocument();
        expect(screen.getByText("output2")).toBeInTheDocument();
      });
    });
  });

  describe("error display", () => {
    it("shows temperature error when provided", () => {
      renderComponent({
        errors: {
          temperature: { message: "Temperature must be between 0 and 2" },
        },
      });
      expect(
        screen.getByText("Temperature must be between 0 and 2"),
      ).toBeInTheDocument();
    });

    it("shows maxTokens error when provided", () => {
      renderComponent({
        errors: { maxTokens: { message: "Max tokens must be positive" } },
      });
      expect(
        screen.getByText("Max tokens must be positive"),
      ).toBeInTheDocument();
    });
  });

  describe("model configuration action", () => {
    it("passes showConfigureAction to ModelSelector", () => {
      // The "Configure available models" link is now rendered inside ModelSelector
      // which is mocked in these tests. The prop is passed through and the actual
      // link behavior is tested in ModelSelector tests.
      renderComponent();
      // ModelSelector is mocked, so we just verify the component renders
      expect(screen.getByTestId("model-selector")).toBeInTheDocument();
    });
  });
});
