/**
 * @vitest-environment jsdom
 *
 * Credential requiredness in the model-provider drawer, exercised through
 * the real form tree: a provider that accepts either an API key or a base
 * URL must stop demanding the key the moment a base URL is entered, and
 * demand it again when that base URL goes away (#6172).
 *
 * Covers @integration scenarios from
 * specs/model-providers/provider-configuration.feature.
 *
 * `useModelProviderForm`, `useRequiredCredentialKeys` and `CredentialsSection`
 * are deliberately NOT mocked — requiredness is recomputed from the schema
 * as the customer types, so only the real state flow can show it moving.
 * Just the boundaries are stubbed: the tRPC client, the router-backed
 * drawer, feature flags, and the API-key probe.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

vi.mock("../../../behavior/use-model-providers-settings", () => ({
  useModelProvidersSettings: (...args: unknown[]) => mockUseModelProvidersSettings(...args),
}));

vi.mock("../../../behavior/model-provider-api", () => {
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

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("@langwatch/workflow-web/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../../behavior/use-model-provider-api-key-validation", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: mockValidateApiKey,
    validateWithCustomUrl: vi.fn().mockResolvedValue(true),
    isValidating: false,
    validationError: undefined,
    clearError: vi.fn(),
  }),
}));

import { EditModelProviderForm } from "../model-provider-form";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";
import {
  eitherOrProviders,
  fieldWrapper,
  inputFor,
  isMarkedRequired,
  makePrimeQueries,
  SELF_HOSTED_URL,
  Wrapper,
} from "./model-provider-drawer-harness";

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

describe("Feature: the drawer asks for the credentials the provider actually needs", () => {
  beforeEach(resetMocks);

  afterEach(() => {
    cleanup();
  });

  describe.each(eitherOrProviders)(
    "given $providerKey, which accepts an API key or a base URL",
    ({ providerKey, apiKey, baseUrl }) => {
      describe("when no base URL is entered", () => {
        beforeEach(async () => {
          primeQueries([]);
          renderDrawer({ modelProviderId: "new", providerKey });
          await screen.findByText(apiKey);
        });

        /** @scenario The API key stops being required once a base URL is entered */
        it("marks the API key required", () => {
          expect(isMarkedRequired(apiKey)).toBe(true);
        });

        it("never marks the base URL required", () => {
          expect(isMarkedRequired(baseUrl)).toBe(false);
        });
      });

      describe("when a base URL is entered and then cleared", () => {
        /** @scenario The API key stops being required once a base URL is entered */
        it("drops the required marker and brings it back", async () => {
          primeQueries([]);
          renderDrawer({ modelProviderId: "new", providerKey });
          await screen.findByText(apiKey);
          const user = userEvent.setup();

          await user.type(inputFor(baseUrl), SELF_HOSTED_URL);
          await waitFor(() => {
            expect(isMarkedRequired(apiKey)).toBe(false);
          });

          await user.clear(inputFor(baseUrl));
          await waitFor(() => {
            expect(isMarkedRequired(apiKey)).toBe(true);
          });
        });
      });

      describe("when only a base URL is entered and the form is saved", () => {
        /** @scenario A self-hosted endpoint is saved with no API key at all */
        it("saves with an empty API key and never probes the endpoint with one", async () => {
          primeQueries([]);
          renderDrawer({ modelProviderId: "new", providerKey });
          await screen.findByText(apiKey);
          const user = userEvent.setup();

          await user.type(inputFor(baseUrl), SELF_HOSTED_URL);
          await user.click(screen.getByRole("button", { name: /^save$/i }));

          await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledTimes(1);
          });
          expect(mockMutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({
              customKeys: expect.objectContaining({
                [apiKey]: "",
                [baseUrl]: SELF_HOSTED_URL,
              }),
            }),
          );
          expect(mockValidateApiKey).not.toHaveBeenCalled();
        });
      });

      describe("when neither credential is entered and the form is saved", () => {
        /** @scenario Saving with neither an API key nor a base URL says what to enter */
        it("explains what to enter, next to the API key field, and saves nothing", async () => {
          primeQueries([]);
          renderDrawer({ modelProviderId: "new", providerKey });
          await screen.findByText(apiKey);
          const user = userEvent.setup();

          // Something has to be dirty for Save to be clickable at all.
          await user.type(inputFor(baseUrl), "   ");
          await user.click(screen.getByRole("button", { name: /^save$/i }));

          await waitFor(() => {
            expect(
              within(fieldWrapper(apiKey)).getByText(
                "Add an API key, or a base URL if your endpoint does not need one.",
              ),
            ).toBeInTheDocument();
          });
          expect(mockMutateAsync).not.toHaveBeenCalled();
        });
      });
    },
  );

  describe("given a provider whose only credential is an API key", () => {
    /** @scenario A provider with a single credential keeps its required marker */
    it("keeps the API key required and offers no base URL", async () => {
      primeQueries([]);
      renderWithModelProviderHost(
        <Wrapper>
          <EditModelProviderForm
            projectId="proj-1"
            organizationId="org-1"
            modelProviderId="new"
            providerKey="gemini"
          />
        </Wrapper>,
        new FakeModelProviderHost(),
      );

      await screen.findByText("GEMINI_API_KEY");
      expect(isMarkedRequired("GEMINI_API_KEY")).toBe(true);
      expect(screen.queryByText(/BASE_URL/)).toBeNull();
    });
  });
});
