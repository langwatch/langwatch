/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// Mock useModelSelectionOptions
vi.mock("../../ModelSelector", () => ({
  allModelOptions: ["openai/gpt-4.1", "openai/gpt-5"],
  useModelSelectionOptions: (
    _options: string[],
    model: string,
    _mode: string,
  ) => {
    const knownModels: Record<
      string,
      { label: string; icon: React.ReactNode; isDisabled: boolean }
    > = {
      "openai/gpt-4.1": {
        label: "gpt-4.1",
        icon: <span data-testid="openai-icon">🤖</span>,
        isDisabled: false,
      },
      "openai/gpt-5": {
        label: "gpt-5",
        icon: <span data-testid="openai-icon">🤖</span>,
        isDisabled: false,
      },
      "disabled/model": {
        label: "disabled-model",
        icon: null,
        isDisabled: true,
      },
    };

    return {
      modelOption: knownModels[model] ?? undefined,
      selectOptions: Object.entries(knownModels).map(([value, opt]) => ({
        value,
        ...opt,
      })),
      groupedByProvider: [],
    };
  },
}));

import { LLMModelDisplay } from "../LLMModelDisplay";

const renderComponent = (
  props: Partial<Parameters<typeof LLMModelDisplay>[0]> = {},
) => {
  const defaultProps = {
    model: "openai/gpt-4.1",
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <LLMModelDisplay {...defaultProps} {...props} />
    </ChakraProvider>,
  );
};

describe("LLMModelDisplay", () => {
  afterEach(() => {
    cleanup();
  });

  describe("model name display", () => {
    it("displays the model label for known models", () => {
      renderComponent({ model: "openai/gpt-4.1" });
      expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    });

    it("displays the model ID for unknown models", () => {
      renderComponent({ model: "unknown/custom-model" });
      expect(screen.getByText("unknown/custom-model")).toBeInTheDocument();
    });

    it("displays provider icon when available", () => {
      renderComponent({ model: "openai/gpt-4.1" });
      expect(screen.getByTestId("openai-icon")).toBeInTheDocument();
    });
  });

  describe("subtitle", () => {
    it("displays subtitle when provided", () => {
      renderComponent({ model: "openai/gpt-4.1", subtitle: "Temp 0.7" });
      expect(screen.getByText("Temp 0.7")).toBeInTheDocument();
    });

    it("does not display subtitle when not provided", () => {
      renderComponent({ model: "openai/gpt-4.1" });
      expect(screen.queryByText("Temp")).not.toBeInTheDocument();
    });

    it("displays reasoning effort subtitle", () => {
      renderComponent({ model: "openai/gpt-5", subtitle: "High effort" });
      expect(screen.getByText("High effort")).toBeInTheDocument();
    });
  });

  describe("disabled models", () => {
    it("shows disabled styling for disabled models", () => {
      renderComponent({ model: "disabled/model" });
      // The disabled model should have line-through and gray color
      const text = screen.getByText("disabled-model");
      expect(text).toHaveStyle({ textDecoration: "line-through" });
    });
  });

  describe("unknown models (not deprecated)", () => {
    it("does not show deprecated label for unknown models", () => {
      renderComponent({ model: "unknown/new-model" });
      // Should show the model ID, not "(deprecated)"
      expect(screen.getByText("unknown/new-model")).toBeInTheDocument();
      expect(screen.queryByText("(deprecated)")).not.toBeInTheDocument();
    });
  });
});
