/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

// Mock dependencies before importing the component
vi.mock("../../SmallLabel", () => ({
  SmallLabel: ({ children }: { children: React.ReactNode }) => (
    <label>{children}</label>
  ),
}));

vi.mock("../../ui/switch", () => ({
  Switch: ({
    children,
    checked,
    disabled,
    onCheckedChange,
  }: {
    children: React.ReactNode;
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (details: { checked: boolean }) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange({ checked: e.target.checked })}
        data-testid="default-provider-switch"
      />
      {children}
    </label>
  ),
}));

vi.mock("../../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../ProviderModelSelector", () => ({
  ProviderModelSelector: ({
    model,
    onChange,
  }: {
    model: string;
    options: string[];
    onChange: (model: string) => void;
    providerKey: string;
  }) => (
    <select
      data-testid="model-selector"
      value={model}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value={model}>{model}</option>
    </select>
  ),
}));

vi.mock("../../ModelSelector", () => ({
  modelSelectorOptions: [
    { value: "openai/gpt-4o", mode: "chat" },
    { value: "openai/gpt-4o-mini", mode: "chat" },
    { value: "openai/text-embedding-3-small", mode: "embedding" },
    { value: "azure/gpt-4", mode: "chat" },
    { value: "azure/text-embedding-ada-002", mode: "embedding" },
  ],
}));

vi.mock("../../../utils/modelProviderHelpers", () => ({
  isProviderEffectiveDefault: vi.fn(() => false),
}));

import { DefaultProviderSection } from "../ModelProviderDefaultSection";
import { isProviderEffectiveDefault } from "../../../utils/modelProviderHelpers";

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
  setUseAsDefaultProvider: vi.fn(),
  setProjectDefaultModel: vi.fn(),
  setProjectTopicClusteringModel: vi.fn(),
  setProjectEmbeddingsModel: vi.fn(),
  setManaged: vi.fn(),
  submit: vi.fn(),
};

const createMockState = (overrides = {}) => ({
  useApiGateway: false,
  customKeys: {},
  displayKeys: {},
  extraHeaders: [],
  customModels: [],
  useAsDefaultProvider: false,
  projectDefaultModel: "openai/gpt-4o",
  projectTopicClusteringModel: "openai/gpt-4o-mini",
  projectEmbeddingsModel: "openai/text-embedding-3-small",
  isSaving: false,
  errors: {},
  ...overrides,
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

const mockProject = {
  defaultModel: "openai/gpt-4o",
  topicClusteringModel: "openai/gpt-4o-mini",
  embeddingsModel: "openai/text-embedding-3-small",
};

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("DefaultProviderSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isProviderEffectiveDefault).mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders default provider toggle", () => {
    renderWithProviders(
      <DefaultProviderSection
        state={createMockState()}
        actions={mockActions}
        provider={createMockProvider("openai")}
        enabledProvidersCount={2}
        project={mockProject}
      />
    );
    expect(screen.getByText("Use as default provider for models")).toBeInTheDocument();
  });

  it("does not show model selectors when toggle is off", () => {
    renderWithProviders(
      <DefaultProviderSection
        state={createMockState({ useAsDefaultProvider: false })}
        actions={mockActions}
        provider={createMockProvider("openai")}
        enabledProvidersCount={2}
        project={mockProject}
      />
    );
    expect(screen.queryByText("Default Model")).not.toBeInTheDocument();
  });

  it("shows model selectors when toggle is on", () => {
    renderWithProviders(
      <DefaultProviderSection
        state={createMockState({ useAsDefaultProvider: true })}
        actions={mockActions}
        provider={createMockProvider("openai")}
        enabledProvidersCount={2}
        project={mockProject}
      />
    );
    expect(screen.getByText("Default Model")).toBeInTheDocument();
    expect(screen.getByText("Topic Clustering Model")).toBeInTheDocument();
    expect(screen.getByText("Embeddings Model")).toBeInTheDocument();
  });

  it("shows description text when toggle is on", () => {
    renderWithProviders(
      <DefaultProviderSection
        state={createMockState({ useAsDefaultProvider: true })}
        actions={mockActions}
        provider={createMockProvider("openai")}
        enabledProvidersCount={2}
        project={mockProject}
      />
    );
    expect(
      screen.getByText(/Configure the default models used for workflows/)
    ).toBeInTheDocument();
  });

  it("calls setUseAsDefaultProvider on toggle change", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <DefaultProviderSection
        state={createMockState({ useAsDefaultProvider: false })}
        actions={mockActions}
        provider={createMockProvider("openai")}
        enabledProvidersCount={2}
        project={mockProject}
      />
    );

    const toggle = screen.getByTestId("default-provider-switch");
    await user.click(toggle);

    expect(mockActions.setUseAsDefaultProvider).toHaveBeenCalledWith(true);
  });

  it("disables toggle when provider is used for defaults", () => {
    vi.mocked(isProviderEffectiveDefault).mockReturnValue(true);

    renderWithProviders(
      <DefaultProviderSection
        state={createMockState({ useAsDefaultProvider: true })}
        actions={mockActions}
        provider={createMockProvider("openai")}
        enabledProvidersCount={2}
        project={mockProject}
      />
    );

    const toggle = screen.getByTestId("default-provider-switch");
    expect(toggle).toBeDisabled();
  });

  it("disables toggle when only one provider is enabled", () => {
    renderWithProviders(
      <DefaultProviderSection
        state={createMockState({ useAsDefaultProvider: true })}
        actions={mockActions}
        provider={createMockProvider("openai")}
        enabledProvidersCount={1}
        project={mockProject}
      />
    );

    const toggle = screen.getByTestId("default-provider-switch");
    expect(toggle).toBeDisabled();
  });

  it("enables toggle when multiple providers exist and not used for defaults", () => {
    renderWithProviders(
      <DefaultProviderSection
        state={createMockState({ useAsDefaultProvider: false })}
        actions={mockActions}
        provider={createMockProvider("azure")}
        enabledProvidersCount={2}
        project={mockProject}
      />
    );

    const toggle = screen.getByTestId("default-provider-switch");
    expect(toggle).not.toBeDisabled();
  });

  it("renders three model selectors when toggle is on", () => {
    renderWithProviders(
      <DefaultProviderSection
        state={createMockState({ useAsDefaultProvider: true })}
        actions={mockActions}
        provider={createMockProvider("openai")}
        enabledProvidersCount={2}
        project={mockProject}
      />
    );

    const selectors = screen.getAllByTestId("model-selector");
    expect(selectors).toHaveLength(3);
  });
});
