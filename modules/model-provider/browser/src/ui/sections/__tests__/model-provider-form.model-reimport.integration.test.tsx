/**
 * @vitest-environment jsdom
 * A saved provider that imports its model listing can be saved untouched to import again.
 * @see specs/model-providers/custom-provider-model-import.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMutateAsync,
  mockUseModelProvidersSettings,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
  mockValidateApiKey,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockUseModelProvidersSettings: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
  mockValidateApiKey: vi.fn().mockResolvedValue(true),
}));

vi.mock("@langwatch/model-provider-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useModelProvidersSettings: (...args: unknown[]) => mockUseModelProvidersSettings(...args),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => {
  const modelProvider = {
    listAllForOrganizationForFrontend: { useQuery: mockListAllForOrganizationForFrontendQuery },
    listAllForProjectForFrontend: { useQuery: mockListAllForProjectForFrontendQuery },
    update: { useMutation: () => ({ mutateAsync: mockMutateAsync, isPending: false }) },
    setRoleAssignmentForScope: {
      useMutation: () => ({
        mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
        isPending: false,
      }),
    },
    isManagedProvider: { useQuery: () => ({ data: { managed: false } }) },
    validateApiKey: { useMutation: () => ({ mutateAsync: mockValidateApiKey, isPending: false }) },
  };
  const useUtils = () => ({ modelProvider: { invalidate: vi.fn() } });
  return {
    modelProviderApi: { useUtils, modelProvider },
    api: { useUtils, modelProvider },
  };
});

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../../behavior/use-model-provider-api-key-validation.ts", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: mockValidateApiKey,
    validateWithCustomUrl: vi.fn().mockResolvedValue(true),
    isValidating: false,
    validationError: undefined,
    clearError: vi.fn(),
  }),
}));

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { EditModelProviderForm } from "../model-provider-form.tsx";
import {
  keyedRow,
  makePrimeQueries,
  SELF_HOSTED_URL,
  Wrapper,
} from "./model-provider-drawer-harness.tsx";

const primeQueries = makePrimeQueries({
  providersSettingsMock: mockUseModelProvidersSettings,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const renderDrawer = (props: { modelProviderId?: string; providerKey?: string } = {}) =>
  renderWithModelProviderHost(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey={props.providerKey ?? "openai"}
        modelProviderId={props.modelProviderId}
      />
    </Wrapper>,
    new FakeModelProviderHost(),
  );

const resetMocks = () => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue({});
  mockValidateApiKey.mockResolvedValue(true);
};

describe("Feature: saving a provider imports its model listing again", () => {
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
});
