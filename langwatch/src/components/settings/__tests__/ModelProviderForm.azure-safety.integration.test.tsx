/**
 * @vitest-environment jsdom
 *
 * Integration tests for EditModelProviderForm section rendering rules.
 *
 * Covers @integration scenarios from specs/model-providers/azure-safety-provider.feature:
 * - "Azure Safety form only shows credentials and extra headers"
 *   (no Custom Models, no Default Model, no API Gateway toggle)
 *
 * The form is parent-gated: sections that only apply to LLM providers
 * (CustomModelInputSection, DefaultProviderSection, Azure API Gateway toggle)
 * must be hidden when the provider's registry `type` is "safety".
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockUseModelProviderForm, mockUseModelProvidersSettings } = vi.hoisted(
  () => ({
    mockUseModelProviderForm: vi.fn(),
    mockUseModelProvidersSettings: vi.fn(),
  }),
);

vi.mock("../../../hooks/useModelProviderForm", () => ({
  useModelProviderForm: (...args: unknown[]) =>
    mockUseModelProviderForm(...args),
}));

vi.mock("../../../hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: (...args: unknown[]) =>
    mockUseModelProvidersSettings(...args),
}));

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project", defaultModel: null },
    organization: { id: "org-1" },
  }),
}));

vi.mock("../../../hooks/useModelProviderApiKeyValidation", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: vi.fn().mockResolvedValue(true),
    validateWithCustomUrl: vi.fn().mockResolvedValue(true),
    isValidating: false,
    validationError: undefined,
    clearError: vi.fn(),
  }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    modelProvider: {
      isManagedProvider: {
        useQuery: () => ({ data: { managed: false } }),
      },
    },
  },
}));

// Import after mocks
import { EditModelProviderForm } from "../ModelProviderForm";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function buildState(
  overrides: Partial<UseModelProviderFormState> = {},
): UseModelProviderFormState {
  return {
    useApiGateway: false,
    customKeys: {},
    displayKeys: {},
    initialKeys: {},
    extraHeaders: [],
    customModels: [],
    customEmbeddingsModels: [],
    useAsDefaultProvider: false,
    projectDefaultModel: null,
    projectTopicClusteringModel: null,
    projectEmbeddingsModel: null,
    isSaving: false,
    errors: {},
    ...overrides,
  };
}

function buildActions(
  overrides: Partial<UseModelProviderFormActions> = {},
): UseModelProviderFormActions {
  return {
    setEnabled: vi.fn(),
    setUseApiGateway: vi.fn(),
    setCustomKey: vi.fn(),
    addExtraHeader: vi.fn(),
    removeExtraHeader: vi.fn(),
    toggleExtraHeaderConcealed: vi.fn(),
    setExtraHeaderKey: vi.fn(),
    setExtraHeaderValue: vi.fn(),
    addCustomModel: vi.fn(),
    removeCustomModel: vi.fn(),
    setCustomModels: vi.fn(),
    addCustomEmbeddingsModel: vi.fn(),
    removeCustomEmbeddingsModel: vi.fn(),
    setUseAsDefaultProvider: vi.fn(),
    setProjectDefaultModel: vi.fn(),
    setProjectTopicClusteringModel: vi.fn(),
    setProjectEmbeddingsModel: vi.fn(),
    setManaged: vi.fn(),
    submit: vi.fn(),
    ...overrides,
  };
}

function buildProvider(
  overrides: Partial<MaybeStoredModelProvider> = {},
): MaybeStoredModelProvider {
  return {
    provider: "azure_safety",
    enabled: false,
    customKeys: null,
    models: null,
    embeddingsModels: null,
    disabledByDefault: true,
    deploymentMapping: null,
    extraHeaders: [],
    ...overrides,
  };
}

function primeHooksForProvider({
  providerKey,
  displayKeys,
}: {
  providerKey: string;
  displayKeys: Record<string, z.ZodTypeAny>;
}) {
  const provider = buildProvider({ provider: providerKey });
  mockUseModelProvidersSettings.mockReturnValue({
    providers: { [providerKey]: provider },
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: false,
  });
  mockUseModelProviderForm.mockReturnValue([
    buildState({ displayKeys }),
    buildActions(),
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Feature: Azure Safety model provider form rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given providerKey is azure_safety", () => {
    describe("when the form renders", () => {
      beforeEach(() => {
        primeHooksForProvider({
          providerKey: "azure_safety",
          displayKeys: {
            AZURE_CONTENT_SAFETY_ENDPOINT: z.string().url(),
            AZURE_CONTENT_SAFETY_KEY: z.string().min(1),
          },
        });

        render(
          <Wrapper>
            <EditModelProviderForm
              projectId="proj-1"
              organizationId="org-1"
              providerKey="azure_safety"
            />
          </Wrapper>,
        );
      });

      it("renders the AZURE_CONTENT_SAFETY_ENDPOINT credential field", () => {
        expect(
          screen.getByText("AZURE_CONTENT_SAFETY_ENDPOINT"),
        ).toBeTruthy();
      });

      it("renders the AZURE_CONTENT_SAFETY_KEY credential field", () => {
        expect(screen.getByText("AZURE_CONTENT_SAFETY_KEY")).toBeTruthy();
      });

      it("does not render the Custom Models section", () => {
        expect(screen.queryByText("Custom Models")).toBeNull();
      });

      it("does not render the Default Provider toggle", () => {
        expect(
          screen.queryByText(/use .* as the default for langwatch/i),
        ).toBeNull();
      });

      it("does not render the Use API Gateway toggle", () => {
        expect(screen.queryByText("Use API Gateway")).toBeNull();
      });

      it("renders the Save button", () => {
        expect(
          screen.getByRole("button", { name: /save/i }),
        ).toBeTruthy();
      });
    });
  });

  describe("given providerKey is openai (control)", () => {
    describe("when the form renders", () => {
      beforeEach(() => {
        primeHooksForProvider({
          providerKey: "openai",
          displayKeys: {
            OPENAI_API_KEY: z.string().nullable().optional(),
            OPENAI_BASE_URL: z.string().nullable().optional(),
          },
        });

        render(
          <Wrapper>
            <EditModelProviderForm
              projectId="proj-1"
              organizationId="org-1"
              providerKey="openai"
            />
          </Wrapper>,
        );
      });

      it("renders the Custom Models section", () => {
        expect(screen.getByText("Custom Models")).toBeTruthy();
      });

      it("renders the Default Provider toggle", () => {
        expect(
          screen.getByText(/use openai as the default for langwatch/i),
        ).toBeTruthy();
      });

      it("does not render the Use API Gateway toggle", () => {
        // API Gateway is Azure-specific, not OpenAI
        expect(screen.queryByText("Use API Gateway")).toBeNull();
      });
    });
  });
});
