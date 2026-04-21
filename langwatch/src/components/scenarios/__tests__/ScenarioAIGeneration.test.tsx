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
      mockUseModelProvidersSettings.mockReturnValue({
        // OpenAI is enabled, but Azure is not — yet the default model is Azure
        providers: { openai: { enabled: true } },
        hasEnabledProviders: true,
        isLoading: false,
      });
    });

    it("treats model as disabled by disabling the textarea in input view", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      // Switch from prompt view to input view
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      const textarea = screen.getByRole("textbox");
      expect(textarea).toBeDisabled();
    });
  });
});

describe("when no model providers are configured", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "project-123", defaultModel: "azure/my-gpt4-deployment" },
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

  it("renders a Configure model provider button linking to /settings/model-providers in a new tab", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    // The Card contains both an inline link and a primary button (asChild <a>).
    // Both have the same name; assert at least one link with the correct attributes exists.
    const links = screen.getAllByRole("link", { name: "Configure model provider" });
    expect(links.length).toBeGreaterThanOrEqual(1);
    const primaryLink = links[links.length - 1]!; // button is rendered after the inline link
    expect(primaryLink).toHaveAttribute("href", "/settings/model-providers");
    expect(primaryLink).toHaveAttribute("target", "_blank");
    expect(primaryLink).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(primaryLink).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("keeps the inline explanatory text alongside the button", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    expect(
      screen.getByText(/Scenarios require a model provider to run/i),
    ).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for issue #2919 — misleading "API keys" error in AI gen
// ─────────────────────────────────────────────────────────────────────────────

describe("given azure is the only enabled provider and project.defaultModel is azure/my-gpt4", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "p1", defaultModel: "azure/my-gpt4" },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: { azure: { enabled: true }, openai: { enabled: false } },
      hasEnabledProviders: true,
      isLoading: false,
    });
  });

  describe("when user switches to input view", () => {
    it("does not disable the textarea (healthy non-openai default)", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      const textarea = screen.getByRole("textbox");
      expect(textarea).not.toBeDisabled();
    });

    it("does not render API keys warning", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      expect(screen.queryByText(/api keys/i)).not.toBeInTheDocument();
    });
  });
});

describe("given azure is the only enabled provider and project.defaultModel is null", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      // null defaultModel → getDefaultModelState returns { ok: false, reason: "no-default" }
      project: { id: "p1", defaultModel: null },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: { azure: { enabled: true }, openai: { enabled: false } },
      hasEnabledProviders: true,
      isLoading: false,
    });
  });

  describe("when user switches to input view", () => {
    it("does not render API keys warning (misleading bug message)", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      expect(screen.queryByText(/api keys/i)).not.toBeInTheDocument();
    });

    it("renders an error mentioning default model", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      expect(screen.getByText(/default model/i)).toBeInTheDocument();
    });
  });
});

describe("given azure is the only enabled provider and project.defaultModel is openai/gpt-5.2 (stale)", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "p1", defaultModel: "openai/gpt-5.2" },
    });
    // openai provider is disabled → getDefaultModelState returns { ok: false, reason: "stale-default" }
    mockUseModelProvidersSettings.mockReturnValue({
      providers: { azure: { enabled: true }, openai: { enabled: false } },
      hasEnabledProviders: true,
      isLoading: false,
    });
  });

  describe("when user switches to input view", () => {
    it("does not render API keys warning (misleading bug message)", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      expect(screen.queryByText(/api keys/i)).not.toBeInTheDocument();
    });

    it("renders an error mentioning the provider is disabled", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      expect(screen.getByText(/provider.*disabled|disabled.*provider/i)).toBeInTheDocument();
    });
  });
});

describe("given providers are still loading", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "p1", defaultModel: "openai/gpt-5.2" },
    });
    // providers: undefined → getDefaultModelState returns { ok: true } (no-flash during load)
    mockUseModelProvidersSettings.mockReturnValue({
      providers: undefined,
      hasEnabledProviders: true,
      isLoading: true,
    });
  });

  describe("when the component renders in prompt view", () => {
    it("does not render any error banner", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      expect(screen.queryByText(/api keys/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/no default model/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/provider.*disabled/i)).not.toBeInTheDocument();
    });

    it("renders the Generate with AI button", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
    });
  });
});
