/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ScenarioAIGeneration } from "../ScenarioAIGeneration";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockUseOrganizationTeamProject = vi.fn();

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => mockUseOrganizationTeamProject(),
}));

// Mock useDrawer
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn().mockReturnValue(false),
    goBack: vi.fn(),
    canGoBack: false,
  }),
}));

const mockUseModelSelectionOptions = vi.fn();

// Mock useModelSelectionOptions
vi.mock("../../ModelSelector", () => ({
  allModelOptions: [],
  useModelSelectionOptions: (..._args: unknown[]) => mockUseModelSelectionOptions(),
}));

const mockUseModelProvidersSettings = vi.fn();

// Mock useModelProvidersSettings
vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => mockUseModelProvidersSettings(),
}));

// Mock toaster
vi.mock("../../ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Clean up after each test to avoid interference
afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Component Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("<ScenarioAIGeneration/>", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "project-123", defaultModel: "openai/gpt-4" },
    });
    mockUseModelSelectionOptions.mockReturnValue({
      modelOption: { isDisabled: false },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: { openai: { enabled: true } },
      hasEnabledProviders: true,
      isLoading: false,
    });
  });

  it("shows prompt view by default", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    // Should show the "Need Help?" prompt card
    expect(screen.getByText("Need Help?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
  });
});

describe("when default model is Azure deployment not in registry", () => {
  describe("when azure provider IS enabled", () => {
    beforeEach(() => {
      mockUseOrganizationTeamProject.mockReturnValue({
        project: { id: "project-123", defaultModel: "azure/my-gpt4-deployment" },
      });
      mockUseModelSelectionOptions.mockReturnValue({
        modelOption: undefined,
      });
      mockUseModelProvidersSettings.mockReturnValue({
        providers: { azure: { enabled: true } },
        hasEnabledProviders: true,
        isLoading: false,
      });
    });

    it("does not show Model Provider Required warning", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      expect(screen.queryByText("Model Provider Required")).not.toBeInTheDocument();
    });

    it("does not disable the textarea when switching to input view", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      // Switch from prompt view to input view
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      const textarea = screen.getByRole("textbox");
      expect(textarea).not.toBeDisabled();
    });
  });

  describe("when azure provider is NOT enabled but another provider is", () => {
    beforeEach(() => {
      // hasEnabledProviders=true simulates: OpenAI is configured
      // but the project's default model is azure/my-gpt4-deployment and Azure is NOT configured
      mockUseOrganizationTeamProject.mockReturnValue({
        project: { id: "project-123", defaultModel: "azure/my-gpt4-deployment" },
      });
      mockUseModelSelectionOptions.mockReturnValue({
        // modelOption is undefined because azure deployment is not in the static registry
        modelOption: undefined,
      });
      mockUseModelProvidersSettings.mockReturnValue({
        // OpenAI is enabled, but Azure is not — yet the default model is Azure
        providers: { openai: { enabled: true } },
        hasEnabledProviders: true,
        isLoading: false,
      });
    });

    // This test documents the bug: when modelOption is undefined (Azure deployment not in registry)
    // and the azure provider is not configured, the model should be treated as disabled.
    // Current code: `isDefaultModelDisabled = modelOption?.isDisabled ?? false` evaluates to false
    // because modelOption is undefined, so the textarea is NOT disabled.
    // After the fix, the textarea SHOULD be disabled.
    it("treats model as disabled by disabling the textarea in input view", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      // Switch from prompt view to input view
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      const textarea = screen.getByRole("textbox");
      // BUG: current code leaves textarea enabled; after fix it should be disabled
      expect(textarea).toBeDisabled();
    });
  });
});

describe("when no model providers are configured", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "project-123", defaultModel: "azure/my-gpt4-deployment" },
    });
    mockUseModelSelectionOptions.mockReturnValue({
      modelOption: undefined,
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: {},
      hasEnabledProviders: false,
      isLoading: false,
    });
  });

  it("shows Model Provider Required warning", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    expect(screen.getByText("Model Provider Required")).toBeInTheDocument();
  });
});
