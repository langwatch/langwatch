/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

// Mock SmallLabel
vi.mock("../../SmallLabel", () => ({
  SmallLabel: ({ children }: { children: React.ReactNode }) => (
    <label>{children}</label>
  ),
}));

import { CustomModelInputSection } from "../ModelProviderCustomModelInput";

const mockActions = {
  setEnabled: vi.fn(),
  setUseApiGateway: vi.fn(),
  setCustomKey: vi.fn(),
  addExtraHeader: vi.fn(),
  removeExtraHeader: vi.fn(),
  toggleExtraHeaderConcealed: vi.fn(),
  setExtraHeaderKey: vi.fn(),
  setExtraHeaderValue: vi.fn(),
  setCustomModels: vi.fn(),
  setCustomEmbeddingsModels: vi.fn(),
  addCustomModelsFromText: vi.fn(),
  addCustomEmbeddingsFromText: vi.fn(),
  setUseAsDefaultProvider: vi.fn(),
  setProjectDefaultModel: vi.fn(),
  setProjectTopicClusteringModel: vi.fn(),
  setProjectEmbeddingsModel: vi.fn(),
  setManaged: vi.fn(),
  submit: vi.fn(),
};

const createMockState = (customModels: Array<{ value: string; label: string }> = []) => ({
  useApiGateway: false,
  customKeys: {},
  displayKeys: {},
  extraHeaders: [],
  customModels,
  customEmbeddingsModels: [],
  useAsDefaultProvider: false,
  projectDefaultModel: null,
  projectTopicClusteringModel: null,
  projectEmbeddingsModel: null,
  isSaving: false,
  errors: {},
});

const createMockProvider = (providerName: string) => ({
  id: `provider-${providerName}`,
  provider: providerName,
  enabled: true,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  disabledByDefault: false,
  deploymentMapping: null,
  extraHeaders: [],
});

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("CustomModelInputSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders for custom provider", () => {
    renderWithProviders(
      <CustomModelInputSection
        state={createMockState()}
        actions={mockActions}
        provider={createMockProvider("custom")}
      />
    );
    expect(screen.getByText("Models")).toBeInTheDocument();
  });

  it("shows input placeholder", () => {
    renderWithProviders(
      <CustomModelInputSection
        state={createMockState()}
        actions={mockActions}
        provider={createMockProvider("custom")}
      />
    );
    expect(screen.getByPlaceholderText("Add custom model")).toBeInTheDocument();
  });

  it("renders existing custom models as tags", () => {
    const customModels = [
      { value: "gpt-4-turbo", label: "gpt-4-turbo" },
      { value: "llama-3-70b", label: "llama-3-70b" },
    ];

    renderWithProviders(
      <CustomModelInputSection
        state={createMockState(customModels)}
        actions={mockActions}
        provider={createMockProvider("custom")}
      />
    );

    expect(screen.getByText("gpt-4-turbo")).toBeInTheDocument();
    expect(screen.getByText("llama-3-70b")).toBeInTheDocument();
  });

  it("renders empty state with no models", () => {
    renderWithProviders(
      <CustomModelInputSection
        state={createMockState([])}
        actions={mockActions}
        provider={createMockProvider("custom")}
      />
    );

    // Should still render the input
    expect(screen.getByPlaceholderText("Add custom model")).toBeInTheDocument();
    // No model tags present
    expect(screen.queryByText("gpt-4-turbo")).not.toBeInTheDocument();
  });
});
