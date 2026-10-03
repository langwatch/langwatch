/**
 * Shared harness for the model-provider drawer integration tests.
 *
 * Holds everything that is not a behaviour assertion: the shared module
 * mocks, Chakra wrapper, provider-row fixture, query priming, and the DOM
 * readers for a credential field. Import this before `ModelProviderForm` so
 * the mocks register before the component module evaluates.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";

const modelProviderDrawerMocks = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockSetRoleAssignmentForScope: vi.fn().mockResolvedValue({ ok: true }),
  mockGetAllForProjectForFrontendQuery: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
  mockIsManagedProviderQuery: vi.fn(() => ({ data: { managed: false } })),
  mockValidateApiKey: vi.fn().mockResolvedValue(true),
  mockValidateWithCustomUrl: vi.fn().mockResolvedValue(true),
  mockUseFeatureFlag: vi.fn((_: string) => ({
    enabled: false,
    isLoading: false,
  })),
  mockCloseDrawer: vi.fn(),
  mockOpenDrawer: vi.fn(),
  mockUseOrganizationTeamProject: vi.fn(() => ({
    project: {
      id: "proj-1",
      name: "Web App",
      slug: "web-app",
      defaultModel: null,
    },
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
  })),
  mockUseModelProviderForm: vi.fn(),
  mockUseModelProvidersSettings: vi.fn(),
  mockCodexSignInStart: vi.fn(),
  mockCodexSignInPoll: vi.fn(),
  mockDeleteModelProvider: vi.fn(),
}));

export { modelProviderDrawerMocks };

vi.mock("../../../utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: modelProviderDrawerMocks.mockGetAllForProjectForFrontendQuery,
      },
      listAllForOrganizationForFrontend: {
        useQuery:
          modelProviderDrawerMocks.mockListAllForOrganizationForFrontendQuery,
      },
      listAllForProjectForFrontend: {
        useQuery: modelProviderDrawerMocks.mockListAllForProjectForFrontendQuery,
      },
      update: {
        useMutation: () => ({
          mutateAsync: modelProviderDrawerMocks.mockMutateAsync,
        }),
      },
      setRoleAssignmentForScope: {
        useMutation: () => ({
          mutateAsync: modelProviderDrawerMocks.mockSetRoleAssignmentForScope,
        }),
      },
      isManagedProvider: {
        useQuery: modelProviderDrawerMocks.mockIsManagedProviderQuery,
      },
      codexStatus: {
        useQuery: () => ({ data: { connected: false }, isLoading: false }),
      },
      codexSignInStart: {
        useMutation: () => ({
          mutateAsync: modelProviderDrawerMocks.mockCodexSignInStart,
          isLoading: false,
        }),
      },
      codexSignInPoll: {
        useMutation: () => ({
          mutateAsync: modelProviderDrawerMocks.mockCodexSignInPoll,
          isLoading: false,
        }),
      },
      delete: {
        useMutation: () => ({
          mutateAsync: modelProviderDrawerMocks.mockDeleteModelProvider,
          isLoading: false,
        }),
      },
    },
    useUtils: () => ({
      organization: {
        getAll: { invalidate: vi.fn() },
      },
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
  },
}));

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: modelProviderDrawerMocks.mockCloseDrawer,
    openDrawer: modelProviderDrawerMocks.mockOpenDrawer,
  }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject:
    modelProviderDrawerMocks.mockUseOrganizationTeamProject,
}));

vi.mock("../../../hooks/useModelProviderApiKeyValidation", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: modelProviderDrawerMocks.mockValidateApiKey,
    validateWithCustomUrl: modelProviderDrawerMocks.mockValidateWithCustomUrl,
    isValidating: false,
    validationError: undefined,
    clearError: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: modelProviderDrawerMocks.mockUseFeatureFlag,
}));

vi.mock("../../ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("../../../hooks/useModelProviderForm", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../hooks/useModelProviderForm")>();

  return {
    ...actual,
    useModelProviderForm: (
      ...args: Parameters<typeof actual.useModelProviderForm>
    ) => {
      if (
        modelProviderDrawerMocks.mockUseModelProviderForm.getMockImplementation()
      ) {
        return modelProviderDrawerMocks.mockUseModelProviderForm(
          ...args,
        ) as ReturnType<typeof actual.useModelProviderForm>;
      }

      return actual.useModelProviderForm(...args);
    },
  };
});

vi.mock("../../../hooks/useModelProvidersSettings", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../hooks/useModelProvidersSettings")
    >();

  return {
    ...actual,
    useModelProvidersSettings: (
      ...args: Parameters<typeof actual.useModelProvidersSettings>
    ) => {
      if (
        modelProviderDrawerMocks.mockUseModelProvidersSettings.getMockImplementation()
      ) {
        return modelProviderDrawerMocks.mockUseModelProvidersSettings(
          ...args,
        ) as ReturnType<typeof actual.useModelProvidersSettings>;
      }

      return actual.useModelProvidersSettings(...args);
    },
  };
});

export function resetModelProviderDrawerMocks() {
  modelProviderDrawerMocks.mockMutateAsync.mockReset();
  modelProviderDrawerMocks.mockMutateAsync.mockResolvedValue({});
  modelProviderDrawerMocks.mockSetRoleAssignmentForScope.mockReset();
  modelProviderDrawerMocks.mockSetRoleAssignmentForScope.mockResolvedValue({
    ok: true,
  });
  modelProviderDrawerMocks.mockGetAllForProjectForFrontendQuery.mockReset();
  modelProviderDrawerMocks.mockListAllForOrganizationForFrontendQuery.mockReset();
  modelProviderDrawerMocks.mockListAllForProjectForFrontendQuery.mockReset();
  modelProviderDrawerMocks.mockIsManagedProviderQuery.mockReset();
  modelProviderDrawerMocks.mockIsManagedProviderQuery.mockReturnValue({
    data: { managed: false },
  });
  modelProviderDrawerMocks.mockValidateApiKey.mockReset();
  modelProviderDrawerMocks.mockValidateApiKey.mockResolvedValue(true);
  modelProviderDrawerMocks.mockValidateWithCustomUrl.mockReset();
  modelProviderDrawerMocks.mockValidateWithCustomUrl.mockResolvedValue(true);
  modelProviderDrawerMocks.mockUseFeatureFlag.mockReset();
  modelProviderDrawerMocks.mockUseFeatureFlag.mockReturnValue({
    enabled: false,
    isLoading: false,
  });
  modelProviderDrawerMocks.mockCloseDrawer.mockReset();
  modelProviderDrawerMocks.mockOpenDrawer.mockReset();
  modelProviderDrawerMocks.mockUseOrganizationTeamProject.mockReset();
  modelProviderDrawerMocks.mockUseOrganizationTeamProject.mockReturnValue({
    project: {
      id: "proj-1",
      name: "Web App",
      slug: "web-app",
      defaultModel: null,
    },
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
  });
  modelProviderDrawerMocks.mockUseModelProviderForm.mockReset();
  modelProviderDrawerMocks.mockUseModelProvidersSettings.mockReset();
  modelProviderDrawerMocks.mockCodexSignInStart.mockReset();
  modelProviderDrawerMocks.mockCodexSignInPoll.mockReset();
  modelProviderDrawerMocks.mockDeleteModelProvider.mockReset();
}

export const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

export const SELF_HOSTED_URL = "https://llm.acme.internal/v1";

/**
 * Providers whose schema accepts one credential in place of another. The
 * rule belongs to the shape, not to openai, so the drawer is driven for
 * every provider that carries it — a fourth one joins by adding a row.
 */
export const eitherOrProviders = [
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

/** A saved provider whose API key is already on file. */
export function keyedRow({
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

export function readyQueryResult<T>(data: T) {
  return {
    data,
    isSuccess: true,
    isError: false,
    isLoading: false,
    status: "success" as const,
    refetch: vi.fn(),
  };
}

export function notReadyQueryResult() {
  return {
    data: undefined,
    isSuccess: false,
    isError: false,
    isLoading: true,
    status: "loading" as const,
    refetch: vi.fn(),
  };
}

/**
 * Builds the `primeQueries(rows)` used by a test file, bound to that file's
 * own query mocks: the collapsed record the settings page reads and the two
 * flat lists the drawer resolves its row from.
 */
export function makePrimeQueries({
  collapsedQuery,
  organizationListQuery,
  projectListQuery,
}: {
  collapsedQuery: ReturnType<typeof vi.fn>;
  organizationListQuery: ReturnType<typeof vi.fn>;
  projectListQuery: ReturnType<typeof vi.fn>;
}) {
  return (rows: MaybeStoredModelProvider[]) => {
    const collapsed = Object.fromEntries(
      rows.map((row) => [row.provider, row]),
    );
    collapsedQuery.mockReturnValue(
      readyQueryResult({ providers: collapsed, modelMetadata: {} }),
    );
    const flat = readyQueryResult({ providers: rows, modelMetadata: {} });
    organizationListQuery.mockReturnValue(flat);
    projectListQuery.mockReturnValue(flat);
  };
}

/**
 * Credential inputs are labelled with a plain `Text` (no `htmlFor`/`id`),
 * so walk up from the label to the wrapper that owns exactly one input.
 */
export function fieldWrapper(labelText: string): HTMLElement {
  const label = screen.getByText(labelText);
  let node: HTMLElement | null = label;
  while (node && node.querySelectorAll("input").length !== 1) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`no field found for label "${labelText}"`);
  return node;
}

export function inputFor(labelText: string): HTMLInputElement {
  return fieldWrapper(labelText).querySelector("input")!;
}

/**
 * Whether the field is marked required: the asterisk the customer sees
 * (`Field.RequiredIndicator`) and the `required` the field puts on its own
 * input. Both come from the same `Field.Root` prop, so a disagreement means
 * the affordance and the form semantics have come apart — worth failing on
 * rather than silently reading one of them.
 */
export function isMarkedRequired(labelText: string): boolean {
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
