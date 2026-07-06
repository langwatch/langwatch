/**
 * @vitest-environment jsdom
 * @regression
 *
 * Regression tests for issue #5380: editing a model-provider row resolves
 * the wrong row when a second same-type row exists at a narrower scope,
 * producing a blank API-key field and, on save, a duplicate row.
 *
 * Covers @regression @integration scenarios from
 * specs/model-providers/scope-and-multi-instance.feature:
 *   /** @scenario Editing a row shows its own saved credential, not another row's
 *   /** @scenario Saving an edited row updates it in place, not as a duplicate
 *
 * Root cause: `EditModelProviderForm` (src/components/settings/ModelProviderForm.tsx)
 * resolves the row being edited by searching the COLLAPSED
 * `Record<providerKey, MaybeStoredModelProvider>` returned by
 * `useModelProvidersSettings` (one winner per provider type — the
 * narrowest scope wins). The settings table, however, passes the real
 * DB id from the UNCOLLAPSED flat list. When the id being edited is not
 * the collapse winner, the lookup misses and the form silently falls
 * back to a blank draft with no id: the API key field renders empty,
 * and Save sends `id: undefined`, which the server treats as a create
 * — producing a duplicate row instead of an update.
 *
 * `useModelProviderForm` and `useModelProvidersSettings` are deliberately
 * NOT mocked below — the row-resolution memo and the real submit payload
 * must actually execute for this test to exercise the bug.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// `useModelProviderForm` / `useModelProvidersSettings` are NOT mocked here
// (see file header) — only their external boundaries are:
//   - the tRPC client (`utils/api`)
//   - peripheral hooks that reach outside this component's own logic
//     (router-backed drawer state, feature flags, org/team/project context,
//     the async API-key validation round-trip, and the toaster).
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
      update: {
        useMutation: () => ({ mutateAsync: mockMutateAsync }),
      },
      setRoleAssignmentForScope: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
        }),
      },
      isManagedProvider: {
        useQuery: () => ({ data: { managed: false } }),
      },
    },
    useContext: () => ({
      organization: {
        getAll: { invalidate: vi.fn() },
      },
      modelProvider: {
        getAllForProject: { invalidate: vi.fn() },
        getAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForProjectForFrontend: { invalidate: vi.fn() },
        // Not read by any query above on current (buggy) code — included
        // up front so this file is byte-identical across the fail-on-main
        // run and the pass-after-fix run once the fix adds this
        // invalidation to useProviderFormSubmit's awaited Promise.all.
        listAllForOrganizationForFrontend: { invalidate: vi.fn() },
        getResolvedDefault: { invalidate: vi.fn() },
        getDefaultModelsForProject: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
  }),
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

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { EditModelProviderForm } from "../ModelProviderForm";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// rowA is the edit TARGET: the wider (organization) scope, absent from the
// collapsed record because rowB (narrower scope) wins the provider-type
// dedupe. rowB is that collapse winner.
const rowA: MaybeStoredModelProvider = {
  id: "row-a",
  name: "OpenAI",
  provider: "openai",
  enabled: true,
  customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER, OPENAI_BASE_URL: "" },
  models: null,
  embeddingsModels: null,
  customModels: null,
  customEmbeddingsModels: null,
  disabledByDefault: false,
  deploymentMapping: null,
  extraHeaders: [],
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
};

const rowB: MaybeStoredModelProvider = {
  ...rowA,
  id: "row-b",
  scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
  scopeType: "PROJECT",
  scopeId: "proj-1",
};

function primeQueries() {
  mockGetAllForProjectForFrontendQuery.mockReturnValue({
    data: { providers: { openai: rowB }, modelMetadata: {} },
    isLoading: false,
    refetch: vi.fn(),
  });
  mockListAllForOrganizationForFrontendQuery.mockReturnValue({
    data: { providers: [rowA, rowB], modelMetadata: {} },
    isLoading: false,
    refetch: vi.fn(),
  });
  mockListAllForProjectForFrontendQuery.mockReturnValue({
    data: { providers: [rowA, rowB], modelMetadata: {} },
    isLoading: false,
    refetch: vi.fn(),
  });
}

/**
 * `CredentialsSection` labels each credential input with a plain `Text`
 * (no `htmlFor`/`id` association — see ModelProviderCredentialsSection.tsx
 * lines ~99-136), so `getByLabelText` can't find it. Instead, walk up from
 * the label text node to the first ancestor that contains an `<input>`
 * descendant (the field's own wrapper) and return that input.
 */
function getInputNearLabel(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  let node: HTMLElement | null = label;
  while (node && !node.querySelector("input")) {
    node = node.parentElement;
  }
  if (!node) {
    throw new Error(`no input found near label "${labelText}"`);
  }
  // Exactly one input, not just "at least one" — if a future Field.Root
  // flattening merges this field's wrapper with a sibling field's, a
  // loose `querySelector` would silently return whichever input happens
  // to come first in DOM order instead of failing loudly.
  const inputs = node.querySelectorAll("input");
  if (inputs.length !== 1) {
    throw new Error(
      `expected exactly one input near label "${labelText}", found ${inputs.length}`,
    );
  }
  return inputs[0] as HTMLInputElement;
}

describe("Feature: editing a model-provider row resolves the correct row by id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given two openai rows exist at different scopes (org-wide and project-scoped)", () => {
    describe("when the form renders targeting the wider-scope row (edit flow)", () => {
      beforeEach(() => {
        primeQueries();
        render(
          <Wrapper>
            <EditModelProviderForm
              projectId="proj-1"
              organizationId="org-1"
              modelProviderId="row-a"
              providerKey="openai"
            />
          </Wrapper>,
        );
      });

      /** @scenario Editing a row shows its own saved credential, not another row's */
      it("shows the targeted row's saved API key, masked", () => {
        const input = getInputNearLabel("OPENAI_API_KEY");
        expect(input.value).toBe(MASKED_KEY_PLACEHOLDER);
      });
    });

    describe("when the user re-enters the API key and clicks Save", () => {
      beforeEach(async () => {
        primeQueries();
        render(
          <Wrapper>
            <EditModelProviderForm
              projectId="proj-1"
              organizationId="org-1"
              modelProviderId="row-a"
              providerKey="openai"
            />
          </Wrapper>,
        );
        const user = userEvent.setup();
        const input = getInputNearLabel("OPENAI_API_KEY");
        await user.clear(input);
        await user.type(input, "sk-reentered-key");
        await user.click(screen.getByRole("button", { name: /^save$/i }));
      });

      /** @scenario Saving an edited row updates it in place, not as a duplicate */
      it("submits the update for the targeted row's id instead of a blank create", async () => {
        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "row-a",
            provider: "openai",
            customKeys: expect.objectContaining({
              OPENAI_API_KEY: "sk-reentered-key",
            }),
          }),
        );
      });
    });
  });
});
