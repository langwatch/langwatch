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
import type { ReactNode } from "react";
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

const Wrapper = ({ children }: { children: ReactNode }) => (
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

/**
 * Minimal but *realistic* TanStack Query v4 result. `useAllModelProvidersList`
 * gates on `isSuccess`/`isError` (not just `isLoading`) to tell "the list
 * definitively arrived" apart from "not loaded yet". A mock that returns only
 * `{ data, isLoading }` leaves those gates `undefined` — silently falsy — so
 * every `isReady`-derived branch would be untested by accident. These helpers
 * set the full status triplet so the gates actually run.
 */
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

function notReadyQueryResult() {
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
 * Primes the collapsed-record query and BOTH flat-list queries (org and
 * project variants). `flatList` drives the uncollapsed list the row-by-id
 * resolution reads: an explicit row array (ready), `[]` (ready but empty),
 * or "not-ready" (query still disabled/in-flight, no definitive answer).
 */
function primeQueries({
  flatList = [rowA, rowB],
  collapsed = { openai: rowB },
}: {
  flatList?: MaybeStoredModelProvider[] | "not-ready";
  collapsed?: Record<string, MaybeStoredModelProvider>;
} = {}) {
  mockGetAllForProjectForFrontendQuery.mockReturnValue(
    readyQueryResult({ providers: collapsed, modelMetadata: {} }),
  );
  const flatResult =
    flatList === "not-ready"
      ? notReadyQueryResult()
      : readyQueryResult({ providers: flatList, modelMetadata: {} });
  mockListAllForOrganizationForFrontendQuery.mockReturnValue(flatResult);
  mockListAllForProjectForFrontendQuery.mockReturnValue(flatResult);
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

  describe("given an id-targeted edit whose row is absent from the flat list", () => {
    const renderStale = () =>
      render(
        <Wrapper>
          <EditModelProviderForm
            projectId="proj-1"
            organizationId="org-1"
            modelProviderId="row-stale"
            providerKey="openai"
          />
        </Wrapper>,
      );

    describe("when the flat list has arrived and is non-empty", () => {
      beforeEach(() => {
        primeQueries({ flatList: [rowA, rowB] });
        renderStale();
      });

      /**
       * @regression #5380 P2 stale-id phantom-row: a resolvable id that no
       * longer names a row must surface the miss and block Save, never
       * silently degrade to the create path and write a duplicate row.
       */
      /** @scenario Editing a provider that was deleted in another session shows it no longer exists */
      it("shows the provider-no-longer-exists error copy", () => {
        expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
      });

      it("keeps Save disabled and never calls mutateAsync", () => {
        expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
        expect(mockMutateAsync).not.toHaveBeenCalled();
      });
    });

    describe("when the flat list has arrived and is empty", () => {
      beforeEach(() => {
        primeQueries({ flatList: [], collapsed: {} });
        renderStale();
      });

      /**
       * @regression #5380 P2 empty-org hole: a stale deep-link into an org
       * with zero providers must STILL block Save. The pre-fix guard proxied
       * "list loaded" as `allProviders.length > 0`, which reads a legitimately
       * empty org as "not loaded" — the miss never fired and the phantom
       * duplicate slipped through. This is the exact hole: it fails against
       * the pre-fix draft (empty list → no error copy).
       */
      it("shows the provider-no-longer-exists error copy", () => {
        expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
      });

      /** @scenario A stale edit link still blocks save when the organization has no providers at all */
      it("keeps Save disabled and never calls mutateAsync", () => {
        expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
        expect(mockMutateAsync).not.toHaveBeenCalled();
      });
    });

    describe("when the flat list has not arrived yet", () => {
      beforeEach(() => {
        primeQueries({ flatList: "not-ready" });
        renderStale();
      });

      /**
       * @regression #5380 P2: the miss is not *definitive* until the list
       * arrives, so the error copy must not flash mid-load — yet Save still
       * stays blocked so an unresolved target can never submit.
       */
      /** @scenario While the provider list is still loading the drawer does not claim the provider is missing */
      it("does not render the no-longer-exists error copy while loading", () => {
        expect(screen.queryByText(/no longer exists/i)).toBeNull();
      });

      it("keeps Save disabled while the target is unresolved", () => {
        expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
      });
    });
  });

  describe("given a brand-new provider (modelProviderId=new)", () => {
    const renderNew = () =>
      render(
        <Wrapper>
          <EditModelProviderForm
            projectId="proj-1"
            organizationId="org-1"
            modelProviderId="new"
            providerKey="openai"
          />
        </Wrapper>,
      );

    describe("when the form first renders", () => {
      beforeEach(() => {
        primeQueries();
        renderNew();
      });

      it("renders a blank credential field and no stale-miss error", () => {
        expect(getInputNearLabel("OPENAI_API_KEY").value).toBe("");
        expect(screen.queryByText(/no longer exists/i)).toBeNull();
      });
    });

    describe("when the user enters a key and clicks Save", () => {
      beforeEach(async () => {
        primeQueries();
        renderNew();
        const user = userEvent.setup();
        const input = getInputNearLabel("OPENAI_API_KEY");
        await user.clear(input);
        await user.type(input, "sk-brand-new-key");
        await user.click(screen.getByRole("button", { name: /^save$/i }));
      });

      it("submits a create with no id (server upserts a fresh row)", async () => {
        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.not.objectContaining({ id: expect.anything() }),
        );
      });
    });

    /**
     * @regression #5380 add-flow render loop: the blank template must keep a
     * stable reference across renders. The pre-fix draft dropped the
     * `useMemo`, so `extraHeaders: []` was reallocated every render;
     * useModelProviderForm's reset effect (deps include `provider.extraHeaders`)
     * then refired on every render — "Maximum update depth exceeded" — and
     * re-seeded the form, wiping the user's input. Re-rendering with unchanged
     * props exercises the runtime path and observes the clobber, not source
     * text.
     */
    describe("when the parent re-renders with unchanged props after the user typed", () => {
      /** @scenario Adding a new provider does not wipe the credentials I am typing */
      it("retains the user's typed key (the blank template is not re-seeded per render)", async () => {
        primeQueries();
        const user = userEvent.setup();
        const { rerender } = renderNew();

        const input = getInputNearLabel("OPENAI_API_KEY");
        await user.clear(input);
        await user.type(input, "sk-survives-rerender");
        expect(getInputNearLabel("OPENAI_API_KEY").value).toBe(
          "sk-survives-rerender",
        );

        rerender(
          <Wrapper>
            <EditModelProviderForm
              projectId="proj-1"
              organizationId="org-1"
              modelProviderId="new"
              providerKey="openai"
            />
          </Wrapper>,
        );

        expect(getInputNearLabel("OPENAI_API_KEY").value).toBe(
          "sk-survives-rerender",
        );
      });
    });
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
