/**
 * @vitest-environment jsdom
 *
 * Integration tests for the "Advanced (Gateway)" accordion on
 * EditModelProviderForm.
 *
 * Covers @integration scenarios from
 * specs/ai-gateway/gateway-provider-settings.feature:
 *   /** @scenario Advanced (Gateway) is hidden when the AI gateway feature flag is off
 *   /** @scenario Advanced (Gateway) renders as a collapsed accordion when the flag is on
 *   /** @scenario Single Save persists basic credentials and advanced gateway fields together
 *
 * The drawer renders Advanced as a collapsible accordion gated on the
 * `release_ui_ai_gateway_menu_enabled` flag for the caller's org. The
 * second-"Save Advanced" button is gone: a single Save funnels basic +
 * advanced to one `api.modelProvider.update` mutation.
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

const {
  mockUseModelProviderForm,
  mockUseModelProvidersSettings,
  mockUseFeatureFlag,
} = vi.hoisted(() => ({
  mockUseModelProviderForm: vi.fn(),
  mockUseModelProvidersSettings: vi.fn(),
  mockUseFeatureFlag: vi.fn(),
}));

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
    hasPermission: () => true,
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

vi.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: (...args: unknown[]) => mockUseFeatureFlag(...args),
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

import { EditModelProviderForm } from "../ModelProviderForm";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function buildState(
  overrides: Partial<UseModelProviderFormState> = {},
): UseModelProviderFormState {
  return {
    useApiGateway: false,
    customKeys: {},
    displayKeys: {
      OPENAI_API_KEY: z.string().nullable().optional(),
    } as unknown as Record<string, unknown>,
    initialKeys: {},
    extraHeaders: [],
    customModels: [],
    customEmbeddingsModels: [],
    useAsDefaultProvider: false,
    projectDefaultModel: null,
    projectTopicClusteringModel: null,
    projectEmbeddingsModel: null,
    name: "OpenAI",
    scopes: [],
    scopeType: "PROJECT",
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
    setName: vi.fn(),
    setScopes: vi.fn(),
    setScopeType: vi.fn(),
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

function primeHooks({ gatewayEnabled }: { gatewayEnabled: boolean }) {
  mockUseFeatureFlag.mockImplementation((flag: string) =>
    flag === "release_ui_ai_gateway_menu_enabled"
      ? { enabled: gatewayEnabled, isLoading: false }
      : { enabled: false, isLoading: false },
  );

  const provider: MaybeStoredModelProvider = {
    id: "mp_existing",
    provider: "openai",
    enabled: true,
    customKeys: { OPENAI_API_KEY: "sk-stored" },
    models: ["openai/gpt-4o"],
    embeddingsModels: ["openai/text-embedding-3-small"],
    disabledByDefault: false,
    deploymentMapping: null,
    extraHeaders: [],
  };
  mockUseModelProvidersSettings.mockReturnValue({
    providers: { openai: provider },
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: true,
  });
  mockUseModelProviderForm.mockReturnValue([buildState(), buildActions()]);
}

describe("Feature: Advanced (Gateway) accordion on ModelProvider drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the AI gateway feature flag is OFF for the org", () => {
    describe("when the drawer renders for openai", () => {
      beforeEach(() => {
        primeHooks({ gatewayEnabled: false });
        render(
          <Wrapper>
            <EditModelProviderForm
              projectId="proj-1"
              organizationId="org-1"
              modelProviderId="mp_existing"
              providerKey="openai"
            />
          </Wrapper>,
        );
      });

      /** @scenario Advanced (Gateway) is hidden when the AI gateway feature flag is off */
      it("does not render the Advanced (Gateway) accordion trigger", () => {
        expect(screen.queryByText(/advanced \(gateway\)/i)).toBeNull();
      });

      it("does not render any rate-limit input", () => {
        expect(screen.queryByPlaceholderText(/no cap/i)).toBeNull();
      });

      it("still renders the main Save button", () => {
        expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
      });
    });
  });

  describe("given the AI gateway feature flag is ON for the org", () => {
    describe("when the drawer renders for openai", () => {
      beforeEach(() => {
        primeHooks({ gatewayEnabled: true });
        render(
          <Wrapper>
            <EditModelProviderForm
              projectId="proj-1"
              organizationId="org-1"
              modelProviderId="mp_existing"
              providerKey="openai"
            />
          </Wrapper>,
        );
      });

      /** @scenario Advanced (Gateway) renders as a collapsed accordion when the flag is on */
      it("renders the Advanced (Gateway) accordion trigger", () => {
        expect(screen.getByText(/advanced \(gateway\)/i)).toBeTruthy();
      });

      it("keeps the rate-limit inputs hidden until the accordion is expanded", () => {
        // Collapsed-by-default: the accordion content is in the DOM but
        // hidden from accessibility queries via `hidden` attribute. We
        // assert no rate-limit input is exposed.
        const placeholderMatches = screen.queryAllByPlaceholderText(/no cap/i);
        const visible = placeholderMatches.filter(
          (el) => !el.closest("[hidden]"),
        );
        expect(visible).toHaveLength(0);
      });

      // Render-side surface for the single-Save scenario. Wire-level
      // assertion (the payload actually carries basic + advanced
      // together) lives in `useProviderFormSubmit.integration.test.tsx`
      // and binds the same scenario name.
      it("renders only one Save button (no separate Save Advanced)", () => {
        expect(screen.queryByText(/save advanced/i)).toBeNull();
        const saveButtons = screen.getAllByRole("button", {
          name: /^save$/i,
        });
        expect(saveButtons).toHaveLength(1);
      });
    });
  });
});
