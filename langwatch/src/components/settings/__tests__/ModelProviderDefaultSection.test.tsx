/**
 * @vitest-environment jsdom
 *
 * Integration tests for the DefaultProviderSection component.
 *
 * Covers the @integration scenario from specs/model-providers/default-model-resolution.feature:
 * - Toggling "Use as default provider" for Azure sets projectDefaultModel to the first custom deployment
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { DefaultProviderSection } from "../ModelProviderDefaultSection";

// Mock modelSelectorOptions — Azure has no registry models
vi.mock("../../ModelSelector", () => ({
  modelSelectorOptions: [],
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function buildState(
  overrides: Partial<UseModelProviderFormState> = {},
): UseModelProviderFormState {
  return {
    name: "OpenAI",
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

const azureProvider: MaybeStoredModelProvider = {
  provider: "azure",
  enabled: true,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  disabledByDefault: false,
  deploymentMapping: null,
  extraHeaders: [],
};

describe("<DefaultProviderSection/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when toggling Azure as default provider", () => {
    describe("when Azure has custom models", () => {
      it("sets projectDefaultModel to first custom model", async () => {
        const setProjectDefaultModel = vi.fn();
        const state = buildState({
          useAsDefaultProvider: false,
          customModels: [
            { modelId: "my-gpt4-deployment", displayName: "My GPT-4 Deployment", mode: "chat" },
          ],
          projectDefaultModel: null,
        });
        const actions = buildActions({ setProjectDefaultModel });

        render(
          <Wrapper>
            <DefaultProviderSection
              state={state}
              actions={actions}
              provider={azureProvider}
              enabledProvidersCount={2}
              project={{ defaultModel: null }}
              providers={{ azure: azureProvider }}
            />
          </Wrapper>,
        );

        const toggle = screen.getByRole("checkbox", {
          name: /use azure openai as the default/i,
        });
        await userEvent.click(toggle);

        expect(setProjectDefaultModel).toHaveBeenCalledWith(
          "azure/my-gpt4-deployment",
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Regression tests — issue #3785: cross-provider default model mismatch warning
  // ---------------------------------------------------------------------------

  describe("given provider is azure, useAsDefaultProvider is true, and chatOptions has at least one azure model", () => {
    describe("when projectDefaultModel belongs to a different provider (openai/gpt-5.2)", () => {
      it("renders the orange mismatch warning under the Default Model field", () => {
        const state = buildState({
          useAsDefaultProvider: true,
          customModels: [
            { modelId: "my-azure-deployment", displayName: "My Azure Deployment", mode: "chat" },
          ],
          projectDefaultModel: "openai/gpt-5.2",
        });
        const actions = buildActions();

        render(
          <Wrapper>
            <DefaultProviderSection
              state={state}
              actions={actions}
              provider={azureProvider}
              enabledProvidersCount={2}
              project={{ defaultModel: "openai/gpt-5.2" }}
              providers={{ azure: azureProvider }}
            />
          </Wrapper>,
        );

        expect(
          screen.getByText(/Persisted default belongs to a different provider/i),
        ).toBeTruthy();
      });
    });

    describe("when projectDefaultModel matches the azure prefix (azure/gpt-5-mini)", () => {
      it("does not render the mismatch warning", () => {
        const state = buildState({
          useAsDefaultProvider: true,
          customModels: [
            { modelId: "gpt-5-mini", displayName: "GPT-5 Mini", mode: "chat" },
          ],
          projectDefaultModel: "azure/gpt-5-mini",
        });
        const actions = buildActions();

        render(
          <Wrapper>
            <DefaultProviderSection
              state={state}
              actions={actions}
              provider={azureProvider}
              enabledProvidersCount={2}
              project={{ defaultModel: "azure/gpt-5-mini" }}
              providers={{ azure: azureProvider }}
            />
          </Wrapper>,
        );

        expect(
          screen.queryByText(/Persisted default belongs to a different provider/i),
        ).toBeNull();
      });
    });
  });

  describe("given provider is azure, useAsDefaultProvider is true, and chatOptions is empty", () => {
    describe("when the section renders", () => {
      it("renders the empty-state hint text", () => {
        const state = buildState({
          useAsDefaultProvider: true,
          customModels: [],
          projectDefaultModel: null,
        });
        const actions = buildActions();

        render(
          <Wrapper>
            <DefaultProviderSection
              state={state}
              actions={actions}
              provider={azureProvider}
              enabledProvidersCount={2}
              project={{ defaultModel: null }}
              providers={{ azure: azureProvider }}
            />
          </Wrapper>,
        );

        expect(
          screen.getByText(/No Azure OpenAI models available/i),
        ).toBeTruthy();
      });

      it("does not render the mismatch warning", () => {
        const state = buildState({
          useAsDefaultProvider: true,
          customModels: [],
          projectDefaultModel: "openai/gpt-5.2",
        });
        const actions = buildActions();

        render(
          <Wrapper>
            <DefaultProviderSection
              state={state}
              actions={actions}
              provider={azureProvider}
              enabledProvidersCount={2}
              project={{ defaultModel: "openai/gpt-5.2" }}
              providers={{ azure: azureProvider }}
            />
          </Wrapper>,
        );

        // Warning only shows when chatOptions.length > 0 (component logic)
        expect(
          screen.queryByText(/Persisted default belongs to a different provider/i),
        ).toBeNull();
      });
    });
  });
});
