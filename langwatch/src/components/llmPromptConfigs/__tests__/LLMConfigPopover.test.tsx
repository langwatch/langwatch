/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock useModelLimits hook
vi.mock("~/hooks/useModelLimits", () => ({
  useModelLimits: ({ model }: { model: string }) => ({
    limits: model?.includes("gpt-5")
      ? { maxOutputTokens: 131072, maxTokens: 131072 }
      : { maxOutputTokens: 4096, maxTokens: 4096 },
  }),
}));

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
  useSession: () => ({ data: { user: { id: "test-user" } }, status: "authenticated" }),
}));

// Mock ModelSelector to simplify testing
vi.mock("../../ModelSelector", () => ({
  allModelOptions: [
    { value: "gpt-4o", label: "GPT-4o", provider: "openai" },
    { value: "gpt-5", label: "GPT-5", provider: "openai" },
    { value: "claude-3-opus", label: "Claude 3 Opus", provider: "anthropic" },
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
      <option value="gpt-4o">GPT-4o</option>
      <option value="gpt-5">GPT-5</option>
      <option value="claude-3-opus">Claude 3 Opus</option>
    </select>
  ),
}));

import { LLMConfigPopover, type LLMConfigValues, type Output } from "../LLMConfigPopover";
import { Popover } from "../../ui/popover";

const renderComponent = (
  props: Partial<Parameters<typeof LLMConfigPopover>[0]> = {}
) => {
  const defaultProps: Parameters<typeof LLMConfigPopover>[0] = {
    values: { model: "gpt-4o", temperature: 0.7, max_tokens: 1024 },
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
    </ChakraProvider>
  );
};

describe("LLMConfigPopover", () => {
  afterEach(() => {
    cleanup();
  });

  describe("header", () => {
    it("displays LLM Config title", () => {
      renderComponent();
      expect(screen.getByText("LLM Config")).toBeInTheDocument();
    });

    it("has a close button", () => {
      renderComponent();
      // X icon button should be present
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe("model selection", () => {
    it("displays current model", () => {
      renderComponent({ values: { model: "gpt-4o", temperature: 0.7 } });
      const selector = screen.getByTestId("model-selector");
      expect(selector).toHaveValue("gpt-4o");
    });

    it("calls onChange when model is changed", async () => {
      const onChange = vi.fn();
      renderComponent({
        values: { model: "gpt-4o", temperature: 0.7 },
        onChange,
      });

      const selector = screen.getByTestId("model-selector");
      fireEvent.change(selector, { target: { value: "claude-3-opus" } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-3-opus" })
      );
    });
  });

  describe("temperature control", () => {
    it("shows Temperature label", () => {
      renderComponent({ values: { model: "gpt-4o", temperature: 0.7 } });
      expect(screen.getByText("Temperature")).toBeInTheDocument();
    });

    it("shows helper text about randomness", () => {
      renderComponent({ values: { model: "gpt-4o", temperature: 0.7 } });
      expect(screen.getByText(/Controls randomness/)).toBeInTheDocument();
    });

    describe("GPT-5 constraints", () => {
      it("shows message that temperature is fixed for GPT-5", () => {
        renderComponent({ values: { model: "gpt-5", temperature: 1 } });
        expect(
          screen.getByText("Temperature is fixed to 1 for GPT-5 models")
        ).toBeInTheDocument();
      });

      it("does not show GPT-5 message for other models", () => {
        renderComponent({ values: { model: "gpt-4o", temperature: 0.7 } });
        expect(
          screen.queryByText("Temperature is fixed to 1 for GPT-5 models")
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("max tokens control", () => {
    it("shows Max Tokens label", () => {
      renderComponent({ values: { model: "gpt-4o", temperature: 0.7 } });
      expect(screen.getByText("Max Tokens")).toBeInTheDocument();
    });

    it("shows min/max token limits helper text", () => {
      renderComponent({ values: { model: "gpt-4o", temperature: 0.7 } });
      expect(screen.getByText(/Min:/)).toBeInTheDocument();
      expect(screen.getByText(/Max:/)).toBeInTheDocument();
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

    describe("when default output (toggle should be off)", () => {
      it("does not show Outputs section", () => {
        const outputs: Output[] = [{ identifier: "output", type: "str" }];
        renderComponent({
          showStructuredOutputs: true,
          outputs,
          onOutputsChange: vi.fn(),
        });
        // "Structured Outputs" label shows but not a separate "Outputs" section
        expect(screen.getByText("Structured Outputs")).toBeInTheDocument();
        // There should be no standalone "Outputs" heading
        expect(screen.queryByText(/^Outputs$/)).not.toBeInTheDocument();
      });
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
        // Both labels should show
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
        errors: { temperature: { message: "Temperature must be between 0 and 2" } },
      });
      expect(
        screen.getByText("Temperature must be between 0 and 2")
      ).toBeInTheDocument();
    });

    it("shows maxTokens error when provided", () => {
      renderComponent({
        errors: { maxTokens: { message: "Max tokens must be positive" } },
      });
      expect(
        screen.getByText("Max tokens must be positive")
      ).toBeInTheDocument();
    });
  });
});
