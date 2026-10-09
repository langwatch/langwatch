/**
 * @vitest-environment jsdom
 *
 * #7892: bifrost v1.5 pins Azure's api-version itself, so a caller-supplied
 * AZURE_OPENAI_API_VERSION / AZURE_API_GATEWAY_VERSION is silently dropped
 * on the AI Gateway dispatch path (still honored on direct/Studio dispatch
 * via prepareLitellmParams). The settings drawer offered both fields with no
 * indication of that split. This pins the registry helper text the drawer
 * renders for each field, in customer-facing language that never names an
 * internal component (bifrost/aigateway), per CLAUDE.md copywriting rules.
 *
 * Covers @integration scenarios from
 * specs/ai-gateway/azure-api-version-override.feature.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMutateAsync,
  mockGetAllForProjectForFrontendQuery,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockGetAllForProjectForFrontendQuery: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: mockGetAllForProjectForFrontendQuery,
      },
      listAllForOrganizationForFrontend: {
        useQuery: mockListAllForOrganizationForFrontendQuery,
      },
      listAllForProjectForFrontend: {
        useQuery: mockListAllForProjectForFrontendQuery,
      },
      update: { useMutation: () => ({ mutateAsync: mockMutateAsync }) },
      setRoleAssignmentForScope: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
        }),
      },
      isManagedProvider: { useQuery: () => ({ data: { managed: false } }) },
    },
    useUtils: () => ({
      organization: { getAll: { invalidate: vi.fn() } },
      modelProvider: {
        getAllForProject: { invalidate: vi.fn() },
        getAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForOrganizationForFrontend: { invalidate: vi.fn() },
        getResolvedDefault: { invalidate: vi.fn() },
        getDefaultModelsForProject: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", name: "Web App", slug: "web-app" },
    team: { id: "team-1", name: "Platform" },
    organization: {
      id: "org-1",
      name: "Acme",
      teams: [
        {
          id: "team-1",
          name: "Platform",
          projects: [{ id: "proj-1", name: "Web App" }],
        },
      ],
    },
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
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../ui/toaster", () => ({ toaster: { create: vi.fn() } }));

import { modelProviderRegistry } from "../../../features/onboarding/regions/model-providers/registry";
import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { EditModelProviderForm } from "../ModelProviderForm";
import { makePrimeQueries, Wrapper } from "./modelProviderDrawerHarness";

const primeQueries = makePrimeQueries({
  collapsedQuery: mockGetAllForProjectForFrontendQuery,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const renderDrawer = ({ providerKey }: { providerKey: string }) =>
  render(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey={providerKey}
        modelProviderId={`row-${providerKey}`}
      />
    </Wrapper>,
  );

/** Direct mode: no AZURE_API_GATEWAY_BASE_URL, so the drawer shows the
 * AZURE_OPENAI_* fields (see getDisplayKeysForProvider). */
function azureDirectRow(): MaybeStoredModelProvider {
  return {
    id: "row-azure",
    name: "azure",
    provider: "azure",
    enabled: true,
    customKeys: {
      AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
      AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
    },
    models: null,
    embeddingsModels: null,
    customModels: null,
    customEmbeddingsModels: null,
    disabledByDefault: false,
    deploymentMapping: null,
    extraHeaders: [],
    scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
    scopeType: "PROJECT",
    scopeId: "proj-1",
  };
}

/** Gateway (APIM) mode: AZURE_API_GATEWAY_BASE_URL set flips
 * computeInitialUseApiGateway to true, so the drawer shows the
 * AZURE_API_GATEWAY_* fields instead. */
function azureGatewayRow(): MaybeStoredModelProvider {
  return {
    ...azureDirectRow(),
    customKeys: {
      AZURE_API_GATEWAY_BASE_URL: "https://gateway.example.com",
    },
  };
}

function openaiRow(): MaybeStoredModelProvider {
  return {
    id: "row-openai",
    name: "openai",
    provider: "openai",
    enabled: true,
    customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER },
    models: null,
    embeddingsModels: null,
    customModels: null,
    customEmbeddingsModels: null,
    disabledByDefault: false,
    deploymentMapping: null,
    extraHeaders: [],
    scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
    scopeType: "PROJECT",
    scopeId: "proj-1",
  };
}

const azureEntry = modelProviderRegistry.find(
  (entry) => entry.backendModelProviderKey === "azure",
);

describe("Feature: the Azure drawer says the api-version override is ignored on AI Gateway routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the Azure provider in direct-dispatch mode", () => {
    describe("when the drawer is opened", () => {
      /** @scenario "The Azure provider drawer tells the customer the api-version is ignored on AI Gateway routing" */
      it("shows the direct-mode api-version note saying the value is ignored on Gateway routing", () => {
        primeQueries([azureDirectRow()]);
        renderDrawer({ providerKey: "azure" });

        const description =
          azureEntry?.fieldMetadata?.AZURE_OPENAI_API_VERSION?.description;
        expect(description).toBeTruthy();
        expect(description).toMatch(/ignored/i);
        expect(description).not.toMatch(/bifrost|aigateway/i);
        expect(screen.getByText(description!)).toBeInTheDocument();
      });
    });
  });

  describe("given the Azure provider in API Management gateway mode", () => {
    describe("when the drawer is opened", () => {
      /** @scenario "The Azure provider drawer tells the customer the api-version is ignored on AI Gateway routing" */
      it("shows the gateway-mode api-version note saying the value is ignored on Gateway routing", () => {
        primeQueries([azureGatewayRow()]);
        renderDrawer({ providerKey: "azure" });

        const description =
          azureEntry?.fieldMetadata?.AZURE_API_GATEWAY_VERSION?.description;
        expect(description).toBeTruthy();
        expect(description).toMatch(/ignored/i);
        expect(description).not.toMatch(/bifrost|aigateway/i);
        expect(screen.getByText(description!)).toBeInTheDocument();
      });
    });
  });

  describe("given a non-Azure provider", () => {
    describe("when the drawer is opened", () => {
      /** @scenario "A non-Azure provider drawer shows no api-version note" */
      it("shows no ignored api-version note", () => {
        primeQueries([openaiRow()]);
        renderDrawer({ providerKey: "openai" });

        expect(screen.queryByText(/ignored/i)).toBeNull();
      });
    });
  });
});
