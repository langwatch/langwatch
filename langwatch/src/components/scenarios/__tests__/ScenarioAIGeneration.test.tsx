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

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => mockUseOrganizationTeamProject(),
}));

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

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => mockUseModelProvidersSettings(),
}));

vi.mock("../../ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

const mockResolvedDefault = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => mockResolvedDefault(),
      },
    },
  },
}));

const setResolved = (model: string | null) =>
  mockResolvedDefault.mockReturnValue({
    data: model ? { model, source: "test", scope: "PROJECT" } : null,
    isLoading: false,
  });

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
  mockResolvedDefault.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// Component Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("<ScenarioAIGeneration/>", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "project-123" },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: { openai: { enabled: true } },
      hasEnabledProviders: true,
      isLoading: false,
    });
    setResolved("openai/gpt-4");
  });

  it("shows prompt view by default", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    expect(screen.getByText("Need Help?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
  });
});

describe("when resolved default is an Azure deployment not in registry", () => {
  describe("when azure provider IS enabled", () => {
    beforeEach(() => {
      mockUseOrganizationTeamProject.mockReturnValue({
        project: { id: "project-123" },
      });
      mockUseModelProvidersSettings.mockReturnValue({
        providers: { azure: { enabled: true } },
        hasEnabledProviders: true,
        isLoading: false,
      });
      setResolved("azure/my-gpt4-deployment");
    });

    it("does not show Model Provider Required warning", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      expect(screen.queryByText("Model Provider Required")).not.toBeInTheDocument();
    });

    it("does not disable the textarea when switching to input view", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      const textarea = screen.getByRole("textbox");
      expect(textarea).not.toBeDisabled();
    });
  });

  describe("when azure provider is NOT enabled but another provider is", () => {
    beforeEach(() => {
      mockUseOrganizationTeamProject.mockReturnValue({
        project: { id: "project-123" },
      });
      mockUseModelProvidersSettings.mockReturnValue({
        providers: { openai: { enabled: true } },
        hasEnabledProviders: true,
        isLoading: false,
      });
      setResolved("azure/my-gpt4-deployment");
    });

    it("treats model as disabled by disabling the textarea in input view", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      const textarea = screen.getByRole("textbox");
      expect(textarea).toBeDisabled();
    });
  });
});

describe("when no model providers are configured", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "project-123" },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: {},
      hasEnabledProviders: false,
      isLoading: false,
    });
    setResolved(null);
  });

  it("shows Model Provider Required warning", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    expect(screen.getByText("Model Provider Required")).toBeInTheDocument();
  });

  it("renders a Configure model provider button linking to /settings/model-providers in a new tab", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    const primaryLink = screen.getByTestId(
      "scenario-ai-configure-model-provider-button",
    );
    expect(primaryLink).toHaveAccessibleName("Configure model provider");
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

describe("given azure is the only enabled provider and resolved default is azure/my-gpt4", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "p1" },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: { azure: { enabled: true }, openai: { enabled: false } },
      hasEnabledProviders: true,
      isLoading: false,
    });
    setResolved("azure/my-gpt4");
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

describe("given azure is the only enabled provider and resolved default is null", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "p1" },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: { azure: { enabled: true }, openai: { enabled: false } },
      hasEnabledProviders: true,
      isLoading: false,
    });
    setResolved(null);
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

      expect(screen.getByText(/no default model set/i)).toBeInTheDocument();
    });

    it("renders a Configure default model button linking to /settings/model-providers in a new tab", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      const link = screen.getByTestId(
        "scenario-ai-configure-default-model-button",
      );
      expect(link).toHaveAccessibleName("Configure default model");
      expect(link).toHaveAttribute("href", "/settings/model-providers");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    });
  });
});

describe("given azure is the only enabled provider and resolved default is openai/gpt-5.2 (stale)", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "p1" },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: { azure: { enabled: true }, openai: { enabled: false } },
      hasEnabledProviders: true,
      isLoading: false,
    });
    setResolved("openai/gpt-5.2");
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

    it("renders a Configure default model button linking to /settings/model-providers in a new tab", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

      const link = screen.getByTestId(
        "scenario-ai-configure-default-model-button",
      );
      expect(link).toHaveAccessibleName("Configure default model");
      expect(link).toHaveAttribute("href", "/settings/model-providers");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    });
  });
});

describe("given providers are still loading", () => {
  beforeEach(() => {
    mockUseOrganizationTeamProject.mockReturnValue({
      project: { id: "p1" },
    });
    mockUseModelProvidersSettings.mockReturnValue({
      providers: undefined,
      hasEnabledProviders: true,
      isLoading: true,
    });
    setResolved("openai/gpt-5.2");
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
