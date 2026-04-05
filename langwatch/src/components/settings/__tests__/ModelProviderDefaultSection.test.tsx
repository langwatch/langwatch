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
});
