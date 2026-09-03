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
      useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ ok: true }), isPending: false }),
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
import { inputFor, keyedRow, makePrimeQueries, Wrapper } from "./model-provider-drawer-harness";

const primeQueries = makePrimeQueries({
  providersSettingsMock: mockUseModelProvidersSettings,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const PROVIDER_KEY = "openai";
const API_KEY_FIELD = "OPENAI_API_KEY";
const BASE_URL_FIELD = "OPENAI_BASE_URL";
const ROW_ID = `row-${PROVIDER_KEY}`;

const renderDrawer = () =>
  renderWithModelProviderHost(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey={PROVIDER_KEY}
        modelProviderId={ROW_ID}
      />
    </Wrapper>,
    new FakeModelProviderHost(),
  );

const saveButton = () => screen.getByRole("button", { name: /^save( anyway)?$/i });

/** Types a fresh key over the masked placeholder the drawer starts with. */
const enterKey = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
  const field = inputFor(API_KEY_FIELD);
  await user.clear(field);
  await user.type(field, value);
};

describe("Feature: a refused API key is not a dead end", () => {
  beforeEach(async () => {
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
        await screen.findByText(API_KEY_FIELD);
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
        await screen.findByText(API_KEY_FIELD);
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
        await screen.findByText(API_KEY_FIELD);
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
        await screen.findByText(API_KEY_FIELD);
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
