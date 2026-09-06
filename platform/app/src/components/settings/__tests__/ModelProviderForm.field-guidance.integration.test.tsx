/**
 * @vitest-environment jsdom
 *
 * The drawer labelled each credential with its raw env-var name and nothing
 * else, so a customer looking at "GEMINI_API_KEY" had to guess which of
 * Google's several key types was wanted — and a Google Cloud key scoped to
 * another API was rejected with no hint as to why. The registry has carried
 * a sentence for each credential all along; it just was not rendered.
 *
 * Covers @integration scenarios from
 * specs/model-providers/credential-validation.feature.
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
import { EditModelProviderForm } from "../ModelProviderForm";
import {
  keyedRow,
  makePrimeQueries,
  Wrapper,
} from "./modelProviderDrawerHarness";

const primeQueries = makePrimeQueries({
  collapsedQuery: mockGetAllForProjectForFrontendQuery,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const renderDrawer = (providerKey: string) =>
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

const geminiEntry = modelProviderRegistry.find(
  (entry) => entry.backendModelProviderKey === "gemini",
);

describe("Feature: the drawer says where each credential comes from", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a provider whose credential needs explaining", () => {
    describe("when the drawer is opened", () => {
      it("shows the guidance the registry carries for that field", () => {
        primeQueries([
          keyedRow({
            providerKey: "gemini",
            apiKey: "GEMINI_API_KEY",
            baseUrl: "GEMINI_BASE_URL",
          }),
        ]);
        renderDrawer("gemini");

        const description =
          geminiEntry?.fieldMetadata?.GEMINI_API_KEY?.description;
        expect(description).toBeTruthy();
        expect(screen.getByText(description!)).toBeInTheDocument();
      });
    });
  });

  /**
   * A Google Cloud key is commonly restricted to a single Google service,
   * and both kinds now belong on this one provider: validation detects
   * which door the key opens. The copy has to say an Agent Platform key is
   * welcome here — the old text sent those customers hunting for another
   * provider, which is exactly how a valid key came to read as invalid.
   * Pinned so it cannot quietly drift back to "your Gemini API key".
   */
  describe("given the customer holds a Google Cloud key", () => {
    describe("when they read the credential field", () => {
      it("says either kind of Google key belongs here", () => {
        const description =
          geminiEntry?.fieldMetadata?.GEMINI_API_KEY?.description ?? "";

        expect(description).toContain("AI Studio");
        expect(description).toContain("Gemini Enterprise Agent Platform");
      });
    });
  });
});
