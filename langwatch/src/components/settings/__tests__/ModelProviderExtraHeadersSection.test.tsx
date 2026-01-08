/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ExtraHeadersSection } from "../ModelProviderExtraHeadersSection";

// Mock SmallLabel
vi.mock("../../SmallLabel", () => ({
  SmallLabel: ({ children }: { children: React.ReactNode }) => (
    <label>{children}</label>
  ),
}));

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
  setDefaultModel: vi.fn(),
  setUseAsDefaultProvider: vi.fn(),
  setProjectDefaultModel: vi.fn(),
  setProjectTopicClusteringModel: vi.fn(),
  setProjectEmbeddingsModel: vi.fn(),
  setManaged: vi.fn(),
  submit: vi.fn(),
};

const createMockState = (extraHeaders: Array<{ key: string; value: string; concealed?: boolean }> = []) => ({
  useApiGateway: false,
  customKeys: {},
  displayKeys: {},
  extraHeaders,
  customModels: [],
  chatModelOptions: [],
  defaultModel: null,
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

describe("ExtraHeadersSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders for azure provider", () => {
    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState()}
        actions={mockActions}
        provider={createMockProvider("azure")}
      />
    );
    expect(screen.getByText("Add Header")).toBeInTheDocument();
  });

  it("renders for custom provider", () => {
    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState()}
        actions={mockActions}
        provider={createMockProvider("custom")}
      />
    );
    expect(screen.getByText("Add Header")).toBeInTheDocument();
  });

  it("does not render for openai provider", () => {
    const { container } = renderWithProviders(
      <ExtraHeadersSection
        state={createMockState()}
        actions={mockActions}
        provider={createMockProvider("openai")}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render for gemini provider", () => {
    const { container } = renderWithProviders(
      <ExtraHeadersSection
        state={createMockState()}
        actions={mockActions}
        provider={createMockProvider("gemini")}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Extra Headers label when headers exist", () => {
    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState([{ key: "api-key", value: "secret", concealed: true }])}
        actions={mockActions}
        provider={createMockProvider("azure")}
      />
    );
    expect(screen.getByText("Extra Headers")).toBeInTheDocument();
  });

  it("renders header inputs when headers exist", () => {
    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState([{ key: "api-key", value: "secret", concealed: false }])}
        actions={mockActions}
        provider={createMockProvider("azure")}
      />
    );
    expect(screen.getByDisplayValue("api-key")).toBeInTheDocument();
    expect(screen.getByDisplayValue("secret")).toBeInTheDocument();
  });

  it("calls addExtraHeader on Add Header click", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState()}
        actions={mockActions}
        provider={createMockProvider("azure")}
      />
    );

    await user.click(screen.getByText("Add Header"));
    expect(mockActions.addExtraHeader).toHaveBeenCalled();
  });

  it("calls removeExtraHeader on delete click", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState([{ key: "api-key", value: "secret", concealed: false }])}
        actions={mockActions}
        provider={createMockProvider("azure")}
      />
    );

    // Find the delete button (Trash2 icon button)
    const buttons = screen.getAllByRole("button");
    const deleteButton = buttons.find(btn => btn.querySelector("svg.lucide-trash-2"));
    await user.click(deleteButton!);

    expect(mockActions.removeExtraHeader).toHaveBeenCalledWith(0);
  });

  it("calls toggleExtraHeaderConcealed on eye click", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState([{ key: "api-key", value: "secret", concealed: false }])}
        actions={mockActions}
        provider={createMockProvider("azure")}
      />
    );

    // Find the eye button
    const buttons = screen.getAllByRole("button");
    const eyeButton = buttons.find(btn => btn.querySelector("svg.lucide-eye"));
    await user.click(eyeButton!);

    expect(mockActions.toggleExtraHeaderConcealed).toHaveBeenCalledWith(0);
  });

  it("calls setExtraHeaderKey on key input change", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState([{ key: "", value: "", concealed: false }])}
        actions={mockActions}
        provider={createMockProvider("azure")}
      />
    );

    const keyInput = screen.getByPlaceholderText("Header name");
    await user.type(keyInput, "x-custom");

    expect(mockActions.setExtraHeaderKey).toHaveBeenCalled();
  });

  it("calls setExtraHeaderValue on value input change", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ExtraHeadersSection
        state={createMockState([{ key: "", value: "", concealed: false }])}
        actions={mockActions}
        provider={createMockProvider("azure")}
      />
    );

    const valueInput = screen.getByPlaceholderText("Header value");
    await user.type(valueInput, "my-value");

    expect(mockActions.setExtraHeaderValue).toHaveBeenCalled();
  });
});
