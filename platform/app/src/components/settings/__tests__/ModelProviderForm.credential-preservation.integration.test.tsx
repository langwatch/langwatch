/**
 * @vitest-environment jsdom
 *
 * Editing a provider that already holds a saved API key. Two failure modes
 * found while walking this flow are pinned here: the drawer stripped the
 * masked placeholder from the payload, so a base-URL edit deleted the
 * stored key; and emptying the base URL did not count as a change, so a
 * URL added by mistake could never be removed.
 *
 * Covers @integration scenarios from
 * specs/model-providers/provider-configuration.feature.
 *
 * Only the boundaries are stubbed (see the requiredness suite for why):
 * the drawer's own state flow is what shapes the save payload.
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

import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { EditModelProviderForm } from "../ModelProviderForm";
import {
  eitherOrProviders,
  inputFor,
  isMarkedRequired,
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

describe("Feature: edits beside a saved credential leave that credential intact", () => {
  beforeEach(resetMocks);

  afterEach(() => {
    cleanup();
  });

  describe.each(
    eitherOrProviders,
  )("given a saved $providerKey provider that already holds an API key", ({
    providerKey,
    apiKey,
    baseUrl,
  }) => {
    const rowId = `row-${providerKey}`;

    describe("when a base URL is added", () => {
      /** @scenario The API key stops being required once a base URL is entered */
      it("stops marking the API key required once the base URL covers it", async () => {
        primeQueries([keyedRow({ providerKey, apiKey, baseUrl })]);
        renderDrawer({ modelProviderId: rowId, providerKey });
        const user = userEvent.setup();

        expect(isMarkedRequired(apiKey)).toBe(true);
        await user.type(inputFor(baseUrl), SELF_HOSTED_URL);

        await waitFor(() => {
          expect(isMarkedRequired(apiKey)).toBe(false);
        });
      });
    });

    describe("when the saved provider is edited and saved", () => {
      it("leaves the provider's scope selection untouched", async () => {
        primeQueries([keyedRow({ providerKey, apiKey, baseUrl })]);
        renderDrawer({ modelProviderId: rowId, providerKey });
        const user = userEvent.setup();

        await user.type(inputFor(baseUrl), SELF_HOSTED_URL);
        await user.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            id: rowId,
            scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
          }),
        );
      });

      /**
       * The key the customer never retyped has to go back exactly as it
       * came: the masked placeholder is what tells the server to keep the
       * credential on file. Send the field stripped instead and the save
       * reads as "this provider has no key", which is how a base-URL edit
       * came to delete it.
       */
      /** @scenario Preserve original API key when saving with masked placeholder */
      it("sends the untouched key back masked so the stored one survives", async () => {
        primeQueries([keyedRow({ providerKey, apiKey, baseUrl })]);
        renderDrawer({ modelProviderId: rowId, providerKey });
        const user = userEvent.setup();

        await user.type(inputFor(baseUrl), SELF_HOSTED_URL);
        await user.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            customKeys: {
              [apiKey]: MASKED_KEY_PLACEHOLDER,
              [baseUrl]: SELF_HOSTED_URL,
            },
          }),
        );
      });
    });

    describe("when the base URL it already had is removed", () => {
      const renderWithStoredBaseUrl = () => {
        primeQueries([
          keyedRow({
            providerKey,
            apiKey,
            baseUrl,
            storedBaseUrl: SELF_HOSTED_URL,
          }),
        ]);
        renderDrawer({ modelProviderId: rowId, providerKey });
        return userEvent.setup();
      };

      // Prefill is the scenario's given: the drawer must show the stored
      // value, or an untouched field would read as cleared on save.
      it("shows the stored base URL in the field to begin with", async () => {
        renderWithStoredBaseUrl();

        await waitFor(() => {
          expect(inputFor(baseUrl).value).toBe(SELF_HOSTED_URL);
        });
      });

      /**
       * Emptying a field is a change like any other. Reading it as
       * "nothing happened" left Save disabled, so a base URL added by
       * mistake could never be taken off again.
       */
      /** @scenario Removing the base URL is a change that can be saved */
      it("lets the customer save the removal, keeping the key on file", async () => {
        const user = renderWithStoredBaseUrl();

        await user.clear(inputFor(baseUrl));
        const save = screen.getByRole("button", { name: /^save$/i });
        await waitFor(() => expect(save).toBeEnabled());
        await user.click(save);

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            customKeys: {
              [apiKey]: MASKED_KEY_PLACEHOLDER,
              [baseUrl]: "",
            },
          }),
        );
      });
    });
  });
});
