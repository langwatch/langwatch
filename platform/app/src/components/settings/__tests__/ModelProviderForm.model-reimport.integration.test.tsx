/**
 * @vitest-environment jsdom
 *
 * A stored provider that imports its model listing re-imports on every save,
 * so the drawer keeps Save enabled when nothing was edited.
 *
 * Covers @integration scenarios from
 * specs/model-providers/custom-provider-model-import.feature.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMutateAsync,
  mockGetAllForProjectForFrontendQuery,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
  mockValidateApiKey,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockGetAllForProjectForFrontendQuery: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
  mockValidateApiKey: vi.fn().mockResolvedValue(true),
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
    validate: mockValidateApiKey,
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

import { EditModelProviderForm } from "../ModelProviderForm";
import {
  keyedRow,
  makePrimeQueries,
  SELF_HOSTED_URL,
  Wrapper,
} from "./modelProviderDrawerHarness";

const primeQueries = makePrimeQueries({
  collapsedQuery: mockGetAllForProjectForFrontendQuery,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const renderDrawer = (
  props: { modelProviderId?: string; providerKey?: string } = {},
) =>
  render(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey={props.providerKey ?? "openai"}
        modelProviderId={props.modelProviderId}
      />
    </Wrapper>,
  );

const resetMocks = () => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue({});
  mockValidateApiKey.mockResolvedValue(true);
};

describe("Feature: saving a provider re-imports its model listing", () => {
  beforeEach(resetMocks);

  afterEach(() => {
    cleanup();
  });

  const saveButton = () => screen.getByRole("button", { name: /^save$/i });

  describe("given a saved custom provider with nothing edited", () => {
    /** @scenario An unchanged provider that imports can be saved to re-import */
    it("keeps Save enabled and sends the save", async () => {
      primeQueries([
        keyedRow({
          providerKey: "custom",
          apiKey: "CUSTOM_API_KEY",
          baseUrl: "CUSTOM_BASE_URL",
          storedBaseUrl: SELF_HOSTED_URL,
        }),
      ]);
      renderDrawer({ modelProviderId: "row-custom", providerKey: "custom" });
      const user = userEvent.setup();

      await waitFor(() => {
        expect(saveButton()).toBeEnabled();
      });
      await user.click(saveButton());

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      });
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: "row-custom", provider: "custom" }),
      );
    });
  });

  describe("given a saved OpenAI provider on another base URL with nothing edited", () => {
    it("keeps Save enabled", async () => {
      primeQueries([
        keyedRow({
          providerKey: "openai",
          apiKey: "OPENAI_API_KEY",
          baseUrl: "OPENAI_BASE_URL",
          storedBaseUrl: SELF_HOSTED_URL,
        }),
      ]);
      renderDrawer({ modelProviderId: "row-openai", providerKey: "openai" });

      await waitFor(() => {
        expect(saveButton()).toBeEnabled();
      });
    });
  });

  describe("given a saved OpenAI provider on OpenAI's own endpoint with nothing edited", () => {
    it("keeps Save disabled, since nothing would be imported", async () => {
      primeQueries([
        keyedRow({
          providerKey: "openai",
          apiKey: "OPENAI_API_KEY",
          baseUrl: "OPENAI_BASE_URL",
        }),
      ]);
      renderDrawer({ modelProviderId: "row-openai", providerKey: "openai" });

      await waitFor(() => {
        expect(saveButton()).toBeDisabled();
      });
    });
  });
});
