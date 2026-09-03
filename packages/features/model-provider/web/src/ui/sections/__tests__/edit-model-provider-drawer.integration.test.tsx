// @vitest-environment jsdom
/**
 * The one place in the product a model-provider credential is typed.
 *
 * NEW WITH THE RECOVERY. `platform/app` shipped this drawer with no test that
 * rendered it — the whole `provider-configuration.feature` UI block is a run of
 * `@unimplemented` scenarios saying "need a JSDOM render of ModelProviderForm"
 * — and when the component was deleted in `cc91631cd8` nothing failed. The
 * Model Providers screen kept writing `?drawer.open=editModelProvider` from its
 * Add menu and from every row's Edit, and the census recorded the result
 * plainly: a customer could not add or edit a credential at all.
 *
 * SO THIS TEST'S JOB IS THE HEADLINE ONE: the drawer opens on the provider the
 * address names, the field the customer types into reaches
 * `modelProvider.update`, and the key travels as the customer typed it.
 * Anything narrower would pass just as well against the empty drawer that
 * caused the outage.
 *
 * @see specs/model-providers/provider-configuration.feature
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockValidateApiKey, mockProviders, mockCloseDrawer } = vi.hoisted(() => ({
  mockUpdate: vi.fn().mockResolvedValue({ id: "mp-1" }),
  mockValidateApiKey: vi.fn().mockResolvedValue({ valid: true }),
  mockCloseDrawer: vi.fn(),
  mockProviders: {
    current: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ closeDrawer: mockCloseDrawer }),
}));

vi.mock("@langwatch/workflow-web/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

/**
 * The collapsed record the drawer resolves its TITLE from: one entry per
 * provider type, whichever row currently owns it. An organization adding its
 * first OpenAI key has an entry with nothing in it, which is what this is.
 */
vi.mock("../../../behavior/use-model-providers-settings", () => ({
  useModelProvidersSettings: () => ({
    providers: {
      openai: {
        provider: "openai",
        enabled: false,
        customKeys: null,
        customModels: [],
        customEmbeddingsModels: [],
        models: null,
        embeddingsModels: null,
        scopes: [],
      },
    },
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: false,
  }),
}));

vi.mock("../../../behavior/model-provider-api", () => {
  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, isSuccess: true, refetch: vi.fn() }),
  });
  return {
    modelProviderApi: {
      useUtils: () => ({
        modelProvider: {
          invalidate: vi.fn(),
          getAllForProject: { invalidate: vi.fn() },
          getAllForProjectForFrontend: { invalidate: vi.fn() },
          listAllForProjectForFrontend: { invalidate: vi.fn() },
          listAllForOrganizationForFrontend: { invalidate: vi.fn() },
          getResolvedDefault: { invalidate: vi.fn() },
          getDefaultModelsForProject: { invalidate: vi.fn() },
        },
      }),
      modelProvider: {
        listAllForOrganizationForFrontend: query(mockProviders.current),
        listAllForProjectForFrontend: query(mockProviders.current),
        isManagedProvider: query({ managed: false }),
        update: { useMutation: () => ({ mutateAsync: mockUpdate, isPending: false }) },
        validateApiKey: {
          useMutation: () => ({ mutateAsync: mockValidateApiKey, isPending: false }),
        },
        setRoleAssignmentForScope: {
          useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        },
      },
    },
    api: {
      useUtils: () => ({
        modelProvider: {
          invalidate: vi.fn(),
          getAllForProject: { invalidate: vi.fn() },
          getAllForProjectForFrontend: { invalidate: vi.fn() },
          listAllForProjectForFrontend: { invalidate: vi.fn() },
          listAllForOrganizationForFrontend: { invalidate: vi.fn() },
          getResolvedDefault: { invalidate: vi.fn() },
          getDefaultModelsForProject: { invalidate: vi.fn() },
        },
      }),
      modelProvider: {
        listAllForOrganizationForFrontend: query(mockProviders.current),
        listAllForProjectForFrontend: query(mockProviders.current),
        isManagedProvider: query({ managed: false }),
        update: { useMutation: () => ({ mutateAsync: mockUpdate, isPending: false }) },
        validateApiKey: {
          useMutation: () => ({ mutateAsync: mockValidateApiKey, isPending: false }),
        },
        setRoleAssignmentForScope: {
          useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        },
      },
    },
  };
});

import { EditModelProviderDrawer } from "../edit-model-provider-drawer";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";

const OPEN_FOR_A_NEW_OPENAI_KEY = (
  <EditModelProviderDrawer providerKey="openai" modelProviderId="new" projectId="proj-1" />
);

/** The credential field is a password input, so it is found by its concealment. */
async function typeTheKey(user: ReturnType<typeof userEvent.setup>, key: string) {
  await screen.findByText("OPENAI_API_KEY");
  const field = document.querySelector<HTMLInputElement>("input[type=password]");
  await user.type(field!, key);
}

describe("given the model-provider editor drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ id: "mp-1" });
    mockValidateApiKey.mockResolvedValue({ valid: true });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when it opens on a provider", () => {
    /** @scenario "OpenAI provider form fields" */
    it("names the provider and offers its credential fields", async () => {
      renderWithModelProviderHost(OPEN_FOR_A_NEW_OPENAI_KEY, new FakeModelProviderHost());

      expect(await screen.findByRole("heading", { name: "OpenAI" })).toBeInTheDocument();
      expect(await screen.findByText("OPENAI_API_KEY")).toBeInTheDocument();
      expect(screen.getByText("OPENAI_BASE_URL")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    });

    /**
     * The field is NAMED for the environment variable the server reads, which
     * is what the customer's own provider dashboard calls it too — so the hint
     * underneath is what says where to go and get one. That hint is the half of
     * the recovered field-metadata map the form actually renders; without it a
     * reader sees a bare variable name and has to guess.
     */
    /** @scenario "OpenAI provider form fields" */
    it("says where the key comes from underneath it", async () => {
      renderWithModelProviderHost(OPEN_FOR_A_NEW_OPENAI_KEY, new FakeModelProviderHost());

      expect(
        await screen.findByText("Your OpenAI API key from platform.openai.com/api-keys"),
      ).toBeInTheDocument();
    });

    /**
     * A credential is a password field, so it is never read back off the screen
     * — by a person looking over a shoulder or by a screenshot in a support
     * ticket.
     */
    it("conceals the key as it is typed", async () => {
      const { container } = renderWithModelProviderHost(
        OPEN_FOR_A_NEW_OPENAI_KEY,
        new FakeModelProviderHost(),
      );

      await screen.findByText("OPENAI_API_KEY");
      expect(container.ownerDocument.querySelector("input[type=password]")).toBeTruthy();
    });
  });

  describe("when a credential is typed and saved", () => {
    /** @scenario "Configure API keys with manual input" */
    it("sends the key the customer typed to modelProvider.update", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithModelProviderHost(OPEN_FOR_A_NEW_OPENAI_KEY, new FakeModelProviderHost());

      await typeTheKey(user, "sk-test123");
      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(mockUpdate.mock.calls[0]?.[0]).toMatchObject({
        provider: "openai",
        enabled: true,
        customKeys: expect.objectContaining({ OPENAI_API_KEY: "sk-test123" }),
      });
    });

    /**
     * The probe runs from OUR servers, so a refusal is a strong signal and not
     * proof: a key restricted to the customer's own network looks exactly like
     * a bad one. The key is still checked before the first save.
     */
    /** @scenario "Configure API keys with manual input" */
    it("checks the key with the provider before storing it", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithModelProviderHost(OPEN_FOR_A_NEW_OPENAI_KEY, new FakeModelProviderHost());

      await typeTheKey(user, "sk-test123");
      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => expect(mockValidateApiKey).toHaveBeenCalled());
      expect(mockValidateApiKey.mock.calls[0]?.[0]).toMatchObject({
        provider: "openai",
        customKeys: expect.objectContaining({ OPENAI_API_KEY: "sk-test123" }),
      });
    });
  });
});
