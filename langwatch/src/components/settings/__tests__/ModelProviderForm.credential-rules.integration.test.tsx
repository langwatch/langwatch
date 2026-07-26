/**
 * @vitest-environment jsdom
 *
 * Two credential behaviours of the model-provider drawer, exercised through
 * the real form tree:
 *
 *   #6172 — a provider that accepts either an API key or a base URL must
 *   stop demanding the key the moment a base URL is entered, and demand it
 *   again when that base URL goes away.
 *   #6173 — pointing an already-credentialed provider at a new base URL
 *   sends the saved key somewhere new, so the drawer says where.
 *
 * Covers @integration scenarios from
 * specs/model-providers/provider-configuration.feature.
 *
 * `useModelProviderForm`, `useCredentialKeys` and `CredentialsSection` are
 * deliberately NOT mocked — requiredness is recomputed from the schema as
 * the customer types, so only the real state flow can show it moving. Just
 * the boundaries are stubbed: the tRPC client, the router-backed drawer,
 * org/project context, feature flags, the API-key probe and the toaster.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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

import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { EditModelProviderForm } from "../ModelProviderForm";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const SELF_HOSTED_URL = "https://llm.acme.internal/v1";

/** A saved provider whose API key is already on file. */
function keyedRow({
  providerKey,
  apiKey,
  baseUrl,
  storedBaseUrl = "",
}: {
  providerKey: string;
  apiKey: string;
  baseUrl: string;
  storedBaseUrl?: string;
}): MaybeStoredModelProvider {
  return {
    id: `row-${providerKey}`,
    name: providerKey,
    provider: providerKey,
    enabled: true,
    // Stored keys reach the browser masked, never in plaintext.
    customKeys: {
      [apiKey]: MASKED_KEY_PLACEHOLDER,
      [baseUrl]: storedBaseUrl,
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

function readyQueryResult<T>(data: T) {
  return {
    data,
    isSuccess: true,
    isError: false,
    isLoading: false,
    status: "success" as const,
    refetch: vi.fn(),
  };
}

function primeQueries(rows: MaybeStoredModelProvider[]) {
  const collapsed = Object.fromEntries(rows.map((row) => [row.provider, row]));
  mockGetAllForProjectForFrontendQuery.mockReturnValue(
    readyQueryResult({ providers: collapsed, modelMetadata: {} }),
  );
  const flat = readyQueryResult({ providers: rows, modelMetadata: {} });
  mockListAllForOrganizationForFrontendQuery.mockReturnValue(flat);
  mockListAllForProjectForFrontendQuery.mockReturnValue(flat);
}

/**
 * Credential inputs are labelled with a plain `Text` (no `htmlFor`/`id`),
 * so walk up from the label to the wrapper that owns exactly one input.
 */
function fieldWrapper(labelText: string): HTMLElement {
  const label = screen.getByText(labelText);
  let node: HTMLElement | null = label;
  while (node && node.querySelectorAll("input").length !== 1) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`no field found for label "${labelText}"`);
  return node;
}

function inputFor(labelText: string): HTMLInputElement {
  return fieldWrapper(labelText).querySelector("input")!;
}

/**
 * Whether the field is marked required: the asterisk the customer sees
 * (`Field.RequiredIndicator`) and the `required` the field puts on its own
 * input. Both come from the same `Field.Root` prop, so a disagreement means
 * the affordance and the form semantics have come apart — worth failing on
 * rather than silently reading one of them.
 */
function isMarkedRequired(labelText: string): boolean {
  const wrapper = fieldWrapper(labelText);
  const hasIndicator = !!wrapper.querySelector(
    ".chakra-field__requiredIndicator",
  );
  const inputIsRequired =
    wrapper.querySelector("input")?.hasAttribute("required") ?? false;
  if (hasIndicator !== inputIsRequired) {
    throw new Error(
      `"${labelText}": required marker (${hasIndicator}) disagrees with the input (${inputIsRequired})`,
    );
  }
  return hasIndicator;
}

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

/**
 * Providers whose schema accepts one credential in place of another. The
 * rule belongs to the shape, not to openai, so the drawer is driven for
 * every provider that carries it — a fourth one joins by adding a row.
 */
const eitherOrProviders = [
  {
    providerKey: "openai",
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
  },
  {
    providerKey: "anthropic",
    apiKey: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_BASE_URL",
  },
];

describe("Feature: the drawer asks for the credentials the provider actually needs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
    mockValidateApiKey.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  describe.each(eitherOrProviders)(
    "given $providerKey, which accepts an API key or a base URL",
    ({ providerKey, apiKey, baseUrl }) => {
      describe("when no base URL is entered", () => {
        beforeEach(() => {
          primeQueries([]);
          renderDrawer({ modelProviderId: "new", providerKey });
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
    it("keeps the API key required and offers no base URL", () => {
      primeQueries([]);
      render(
        <Wrapper>
          <EditModelProviderForm
            projectId="proj-1"
            organizationId="org-1"
            modelProviderId="new"
            providerKey="gemini"
          />
        </Wrapper>,
      );

      expect(isMarkedRequired("GEMINI_API_KEY")).toBe(true);
      expect(screen.queryByText(/BASE_URL/)).toBeNull();
    });
  });

  describe.each(eitherOrProviders)(
    "given a saved $providerKey provider that already holds an API key",
    ({ providerKey, apiKey, baseUrl }) => {
      const repointWarning = /requests carry it to/i;
      const rowId = `row-${providerKey}`;

      describe("when a base URL is added", () => {
        /** @scenario Adding a base URL warns where the saved API key will go */
        it("says the saved key starts going to that host", async () => {
          primeQueries([keyedRow({ providerKey, apiKey, baseUrl })]);
          renderDrawer({ modelProviderId: rowId, providerKey });
          const user = userEvent.setup();

          expect(screen.queryByText(repointWarning)).toBeNull();

          await user.type(inputFor(baseUrl), SELF_HOSTED_URL);

          await waitFor(() => {
            expect(
              screen.getByText(
                "After you save, requests carry it to llm.acme.internal.",
              ),
            ).toBeInTheDocument();
          });
          expect(
            screen.getByText("The saved API key follows this change"),
          ).toBeInTheDocument();
        });

        /**
         * The two fixes have to compose: the key is optional now (a base URL
         * covers it) AND it is still on file, so it still travels.
         */
        /** @scenario Adding a base URL warns where the saved API key will go */
        it("stops marking the API key required while still warning about it", async () => {
          primeQueries([keyedRow({ providerKey, apiKey, baseUrl })]);
          renderDrawer({ modelProviderId: rowId, providerKey });
          const user = userEvent.setup();

          expect(isMarkedRequired(apiKey)).toBe(true);
          await user.type(inputFor(baseUrl), SELF_HOSTED_URL);

          await waitFor(() => {
            expect(isMarkedRequired(apiKey)).toBe(false);
          });
          expect(screen.getByText(repointWarning)).toBeInTheDocument();
        });
      });

      describe("when the base URL it already had is cleared", () => {
        /** @scenario Clearing the base URL warns that the saved API key goes back to the provider */
        it("says the saved key goes back to the provider's own endpoint", async () => {
          primeQueries([
            keyedRow({
              providerKey,
              apiKey,
              baseUrl,
              storedBaseUrl: SELF_HOSTED_URL,
            }),
          ]);
          renderDrawer({ modelProviderId: rowId, providerKey });
          const user = userEvent.setup();

          await user.clear(inputFor(baseUrl));

          await waitFor(() => {
            expect(
              screen.getByText(
                "After you save, requests carry it to the provider's own endpoint.",
              ),
            ).toBeInTheDocument();
          });
        });
      });

      describe("when the drawer is opened and the base URL left alone", () => {
        /** @scenario Editing a provider without touching its base URL shows no warning */
        it("says nothing about where the key goes", () => {
          primeQueries([
            keyedRow({
              providerKey,
              apiKey,
              baseUrl,
              storedBaseUrl: SELF_HOSTED_URL,
            }),
          ]);
          renderDrawer({ modelProviderId: rowId, providerKey });

          expect(screen.queryByText(repointWarning)).toBeNull();
        });
      });

      describe("when the saved provider is edited and saved", () => {
        /** @scenario Adding a base URL warns where the saved API key will go */
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
      });
    },
  );

  describe("given a provider being configured for the first time", () => {
    /** @scenario Configuring a provider for the first time shows no warning */
    it("says nothing about a saved key when a base URL is typed", async () => {
      primeQueries([]);
      renderDrawer({ modelProviderId: "new" });
      const user = userEvent.setup();

      await user.type(inputFor("OPENAI_API_KEY"), "sk-typed-just-now");
      await user.type(inputFor("OPENAI_BASE_URL"), SELF_HOSTED_URL);

      expect(screen.queryByText(/requests carry it to/i)).toBeNull();
    });
  });
});
