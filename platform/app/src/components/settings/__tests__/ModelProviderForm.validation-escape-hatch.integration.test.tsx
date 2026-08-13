/**
 * @vitest-environment jsdom
 *
 * A refused API key used to be the end of the road: the drawer would not
 * save, and there was no way past it. The probe runs from our servers, so a
 * key restricted to the customer's own network, a provider outage, or a key
 * that has not finished propagating all look exactly like a bad key — and
 * the customer, holding a key they know works, had nowhere to go.
 *
 * Covers @integration scenarios from
 * specs/model-providers/credential-validation.feature.
 *
 * Only the boundaries are stubbed: the drawer's own state flow is what
 * decides whether the probe gates the save.
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
      // The drawer offers a credential check, so the form reaches for both
      // routes it can take. Neither is exercised here.
      testConnection: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      validateApiKey: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useContext: () => ({
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
  inputFor,
  keyedRow,
  makePrimeQueries,
  Wrapper,
} from "./modelProviderDrawerHarness";

const primeQueries = makePrimeQueries({
  collapsedQuery: mockGetAllForProjectForFrontendQuery,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const PROVIDER_KEY = "openai";
const API_KEY_FIELD = "OPENAI_API_KEY";
const BASE_URL_FIELD = "OPENAI_BASE_URL";
const ROW_ID = `row-${PROVIDER_KEY}`;

const renderDrawer = () =>
  render(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey={PROVIDER_KEY}
        modelProviderId={ROW_ID}
      />
    </Wrapper>,
  );

const saveButton = () =>
  screen.getByRole("button", { name: /^save( anyway)?$/i });

/** Types a fresh key over the masked placeholder the drawer starts with. */
const enterKey = async (
  user: ReturnType<typeof userEvent.setup>,
  value: string,
) => {
  const field = inputFor(API_KEY_FIELD);
  await user.clear(field);
  await user.type(field, value);
};

describe("Feature: a refused API key is not a dead end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
    mockValidateApiKey.mockResolvedValue(true);
    primeQueries([
      keyedRow({
        providerKey: PROVIDER_KEY,
        apiKey: API_KEY_FIELD,
        baseUrl: BASE_URL_FIELD,
      }),
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the provider refuses the key the customer entered", () => {
    describe("when they save once", () => {
      /** @scenario A refused key can still be saved */
      it("holds the save back and offers to save anyway", async () => {
        mockValidateApiKey.mockResolvedValue(false);
        renderDrawer();
        const user = userEvent.setup();

        await enterKey(user, "sk-refused-by-the-provider");
        await user.click(saveButton());

        await waitFor(() => {
          expect(mockValidateApiKey).toHaveBeenCalledTimes(1);
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
        await waitFor(() => {
          expect(saveButton()).toHaveTextContent(/save anyway/i);
        });
      });
    });

    describe("when they save a second time", () => {
      /** @scenario Saving anyway keeps the credential I entered */
      it("saves the key without probing again", async () => {
        mockValidateApiKey.mockResolvedValue(false);
        renderDrawer();
        const user = userEvent.setup();

        await enterKey(user, "sk-refused-by-the-provider");
        await user.click(saveButton());
        await waitFor(() => {
          expect(saveButton()).toHaveTextContent(/save anyway/i);
        });

        await user.click(saveButton());

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        // Still the one probe from the first attempt: the second save is
        // the customer overriding it, not a retry.
        expect(mockValidateApiKey).toHaveBeenCalledTimes(1);
      });
    });

    describe("when they correct the key instead of overriding", () => {
      /** @scenario Correcting a refused key has it checked again */
      it("probes the corrected key rather than trusting the refusal", async () => {
        mockValidateApiKey.mockResolvedValue(false);
        renderDrawer();
        const user = userEvent.setup();

        await enterKey(user, "sk-refused-by-the-provider");
        await user.click(saveButton());
        await waitFor(() => {
          expect(saveButton()).toHaveTextContent(/save anyway/i);
        });

        mockValidateApiKey.mockResolvedValue(true);
        await enterKey(user, "sk-the-corrected-key");

        await waitFor(() => {
          expect(saveButton()).toHaveTextContent(/^save$/i);
        });

        await user.click(saveButton());

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockValidateApiKey).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given the provider accepts the key", () => {
    describe("when they save", () => {
      it("saves on the first click with no override offered", async () => {
        renderDrawer();
        const user = userEvent.setup();

        await enterKey(user, "sk-accepted-by-the-provider");
        await user.click(saveButton());

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(saveButton()).toHaveTextContent(/^save$/i);
      });
    });
  });
});
