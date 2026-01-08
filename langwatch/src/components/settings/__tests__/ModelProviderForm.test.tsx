/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

// Mock functions
const mockCloseDrawer = vi.fn();
const mockSubmit = vi.fn();
const mockValidateApiKey = vi.fn().mockResolvedValue(true);
const mockClearApiKeyError = vi.fn();
const mockSetUseApiGateway = vi.fn();

vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: {
      id: "test-project-id",
      defaultModel: "openai/gpt-4o",
      topicClusteringModel: "openai/gpt-4o-mini",
      embeddingsModel: "openai/text-embedding-3-small",
    },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

// Mock providers data
const mockProviders = {
  openai: {
    id: "provider-openai",
    provider: "openai",
    enabled: true,
    customKeys: null,
    models: null,
    embeddingsModels: null,
    disabledByDefault: false,
    deploymentMapping: null,
    extraHeaders: [],
  },
  azure: {
    id: "provider-azure",
    provider: "azure",
    enabled: false,
    customKeys: null,
    models: null,
    embeddingsModels: null,
    disabledByDefault: true,
    deploymentMapping: null,
    extraHeaders: [],
  },
};

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    providers: mockProviders,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

// Mock state for useModelProviderForm
const mockFormState = {
  useApiGateway: false,
  customKeys: {},
  displayKeys: {},
  extraHeaders: [],
  customModels: [],
  chatModelOptions: [],
  defaultModel: null,
  useAsDefaultProvider: false,
  projectDefaultModel: "openai/gpt-4o",
  projectTopicClusteringModel: "openai/gpt-4o-mini",
  projectEmbeddingsModel: "openai/text-embedding-3-small",
  isSaving: false,
  errors: {},
};

const mockFormActions = {
  setEnabled: vi.fn(),
  setUseApiGateway: mockSetUseApiGateway,
  setCustomKey: vi.fn(),
  addExtraHeader: vi.fn(),
  removeExtraHeader: vi.fn(),
  toggleExtraHeaderConcealed: vi.fn(),
  setExtraHeaderKey: vi.fn(),
  setExtraHeaderValue: vi.fn(),
  setCustomModels: vi.fn(),
  setDefaultModel: vi.fn(),
  setUseAsDefaultProvider: vi.fn(),
  setProjectDefaultModel: vi.fn(),
  setProjectTopicClusteringModel: vi.fn(),
  setProjectEmbeddingsModel: vi.fn(),
  setManaged: vi.fn(),
  submit: mockSubmit,
};

vi.mock("~/hooks/useModelProviderForm", () => ({
  useModelProviderForm: () => [mockFormState, mockFormActions],
}));

vi.mock("~/hooks/useModelProviderApiKeyValidation", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: mockValidateApiKey,
    isValidating: false,
    validationError: undefined,
    clearError: mockClearApiKeyError,
  }),
}));

// Mock the model providers registry
vi.mock("~/server/modelProviders/registry", () => ({
  modelProviders: {
    openai: { keysSchema: null },
    azure: { keysSchema: null },
  },
}));

// Mock child components
vi.mock("../ModelProviderCredentialsSection", () => ({
  CredentialsSection: () => (
    <div data-testid="credentials-section">Credentials Section</div>
  ),
}));

vi.mock("../ModelProviderExtraHeadersSection", () => ({
  ExtraHeadersSection: () => (
    <div data-testid="extra-headers-section">Extra Headers Section</div>
  ),
}));

vi.mock("../ModelProviderCustomModelInput", () => ({
  CustomModelInputSection: () => (
    <div data-testid="custom-model-input-section">Custom Model Input Section</div>
  ),
}));

vi.mock("../ModelProviderDefaultSection", () => ({
  DefaultProviderSection: () => (
    <div data-testid="default-provider-section">Default Provider Section</div>
  ),
}));

// Import after mocks
import { EditModelProviderForm } from "../ModelProviderForm";

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("EditModelProviderForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset form state
    mockFormState.useApiGateway = false;
    mockFormState.isSaving = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Save button", () => {
    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-openai"
      />
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("renders credentials section", () => {
    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-openai"
      />
    );
    expect(screen.getByTestId("credentials-section")).toBeInTheDocument();
  });

  it("renders extra headers section", () => {
    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-openai"
      />
    );
    expect(screen.getByTestId("extra-headers-section")).toBeInTheDocument();
  });

  it("renders custom model input section", () => {
    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-openai"
      />
    );
    expect(screen.getByTestId("custom-model-input-section")).toBeInTheDocument();
  });

  it("renders default provider section", () => {
    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-openai"
      />
    );
    expect(screen.getByTestId("default-provider-section")).toBeInTheDocument();
  });

  it("shows API Gateway switch for azure provider", () => {
    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-azure"
      />
    );
    expect(screen.getByText("Use API Gateway")).toBeInTheDocument();
  });

  it("does not show API Gateway switch for non-azure providers", () => {
    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-openai"
      />
    );
    expect(screen.queryByText("Use API Gateway")).not.toBeInTheDocument();
  });

  it("calls submit on save click", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-openai"
      />
    );

    const saveButton = screen.getByRole("button", { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalled();
    });
  });

  it("shows loading state while saving", () => {
    mockFormState.isSaving = true;

    renderWithProviders(
      <EditModelProviderForm
        projectId="test-project-id"
        modelProviderId="provider-openai"
      />
    );

    // When loading, Chakra hides the button text so we find by role only
    const saveButton = screen.getByRole("button");
    expect(saveButton).toHaveAttribute("data-loading");
  });
});
