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
 * Root cause: `EditModelProviderForm` resolves the row being edited by
 * searching the COLLAPSED `Record<providerKey, entry>` returned by
 * `useModelProvidersSettings` (one winner per provider type — the
 * narrowest scope wins). The settings table, however, passes the real
 * DB id from the UNCOLLAPSED flat list (`useAllModelProvidersList`). When
 * the id being edited is not the collapse winner, the lookup misses and
 * the form silently falls back to a blank draft with no id: the API key
 * field renders empty, and Save sends `id: undefined`, which the server
 * treats as a create — producing a duplicate row instead of an update.
 *
 * `useModelProviderForm` and `useAllModelProvidersList` are deliberately
 * NOT mocked below — the row-resolution memo and the real submit payload
 * must actually execute for this test to exercise the bug. Only
 * `useModelProvidersSettings` (the collapsed record) and the tRPC/peripheral
 * boundaries are stubbed.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMutateAsync,
  mockUseModelProvidersSettings,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockUseModelProvidersSettings: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
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
    validateApiKey: {
      useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ valid: true }), isPending: false }),
    },
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
    validate: vi.fn().mockResolvedValue(true),
    validateWithCustomUrl: vi.fn().mockResolvedValue(true),
    isValidating: false,
    validationError: undefined,
    clearError: vi.fn(),
  }),
}));

import { MASKED_KEY_PLACEHOLDER } from "@langwatch/model-provider-contract";
import type { ModelProviderListEntry } from "@langwatch/model-provider-contract";
import { EditModelProviderForm } from "../model-provider-form";
import { FakeModelProviderHost } from "../../../testing";
import { ModelProviderHostProvider } from "../../../model/model-provider-host";
import { Wrapper } from "./model-provider-drawer-harness";

// rowA is the edit TARGET: the wider (organization) scope, absent from the
// collapsed record because rowB (narrower scope) wins the provider-type
// dedupe. rowB is that collapse winner.
const rowA: ModelProviderListEntry = {
  id: "row-a",
  name: "OpenAI",
  provider: "openai",
  enabled: true,
  disabledAt: null,
  healthStatus: null,
  customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER, OPENAI_BASE_URL: "" },
  deploymentMapping: null,
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
  models: null,
  embeddingsModels: null,
  customModels: [],
  customEmbeddingsModels: [],
};

const rowB: ModelProviderListEntry = {
  ...rowA,
  id: "row-b",
  scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
};

/**
 * Minimal but *realistic* TanStack Query result. `useAllModelProvidersList`
 * gates on `isSuccess`/`isError` (not just `isLoading`) to tell "the list
 * definitively arrived" apart from "not loaded yet". A mock that returns
 * only `{ data, isLoading }` leaves those gates `undefined` — silently
 * falsy — so every `isReady`-derived branch would be untested by accident.
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
 * Primes the collapsed-record hook and BOTH flat-list queries (org and
 * project variants). `flatList` drives the uncollapsed list the row-by-id
 * resolution reads: an explicit row array (ready), `[]` (ready but empty),
 * or "not-ready" (query still disabled/in-flight, no definitive answer).
 */
function primeQueries({
  flatList = [rowA, rowB],
  collapsed = { openai: rowB },
}: {
  flatList?: ModelProviderListEntry[] | "not-ready";
  collapsed?: Record<string, ModelProviderListEntry>;
} = {}) {
  mockUseModelProvidersSettings.mockReturnValue({
    providers: collapsed,
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: Object.values(collapsed).some((row) => row.enabled),
  });
  const flatResult = flatList === "not-ready" ? notReadyQueryResult() : readyQueryResult(flatList);
  mockListAllForOrganizationForFrontendQuery.mockReturnValue(flatResult);
  mockListAllForProjectForFrontendQuery.mockReturnValue(flatResult);
}

/**
 * `CredentialsSection` labels each credential input with a plain `Text`
 * (no `htmlFor`/`id` association), so `getByLabelText` can't find it.
 * Instead, walk up from the label text node to the first ancestor that
 * contains an `<input>` descendant (the field's own wrapper) and return
 * that input.
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

const host = new FakeModelProviderHost();

function formTree(props: { modelProviderId?: string; providerKey?: string }) {
  return (
    <Wrapper>
      <ModelProviderHostProvider value={host}>
        <EditModelProviderForm
          projectId="proj-1"
          organizationId="org-1"
          providerKey={props.providerKey ?? "openai"}
          modelProviderId={props.modelProviderId}
        />
      </ModelProviderHostProvider>
    </Wrapper>
  );
}

function renderForm(props: { modelProviderId?: string; providerKey?: string }) {
  return render(formTree(props));
}

describe("Feature: editing a model-provider row resolves the correct row by id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an id-targeted edit whose row is absent from the flat list", () => {
    const renderStale = () => renderForm({ modelProviderId: "row-stale", providerKey: "openai" });

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
      it("shows the provider-no-longer-exists error copy", async () => {
        expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
      });

      it("keeps Save disabled and never calls mutateAsync", async () => {
        await screen.findByText(/no longer exists/i);
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
      it("shows the provider-no-longer-exists error copy", async () => {
        expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
      });

      /** @scenario A stale edit link still blocks save when the organization has no providers at all */
      it("keeps Save disabled and never calls mutateAsync", async () => {
        await screen.findByText(/no longer exists/i);
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
    const renderNew = () => renderForm({ modelProviderId: "new", providerKey: "openai" });

    describe("when the form first renders", () => {
      beforeEach(() => {
        primeQueries();
        renderNew();
      });

      it("renders a blank credential field and no stale-miss error", async () => {
        await screen.findByText("OPENAI_API_KEY");
        expect(getInputNearLabel("OPENAI_API_KEY").value).toBe("");
        expect(screen.queryByText(/no longer exists/i)).toBeNull();
      });
    });

    describe("when the user enters a key and clicks Save", () => {
      beforeEach(async () => {
        primeQueries();
        renderNew();
        const user = userEvent.setup();
        await screen.findByText("OPENAI_API_KEY");
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
     * stable reference across renders. Re-rendering with unchanged props
     * exercises the runtime path and observes the clobber, not source text.
     */
    describe("when the parent re-renders with unchanged props after the user typed", () => {
      /** @scenario Adding a new provider does not wipe the credentials I am typing */
      it("retains the user's typed key (the blank template is not re-seeded per render)", async () => {
        primeQueries();
        const user = userEvent.setup();
        const { rerender } = renderNew();

        await screen.findByText("OPENAI_API_KEY");
        const input = getInputNearLabel("OPENAI_API_KEY");
        await user.clear(input);
        await user.type(input, "sk-survives-rerender");
        expect(getInputNearLabel("OPENAI_API_KEY").value).toBe("sk-survives-rerender");

        rerender(formTree({ modelProviderId: "new", providerKey: "openai" }));

        expect(getInputNearLabel("OPENAI_API_KEY").value).toBe("sk-survives-rerender");
      });
    });
  });

  describe("given two openai rows exist at different scopes (org-wide and project-scoped)", () => {
    describe("when the form renders targeting the wider-scope row (edit flow)", () => {
      beforeEach(() => {
        primeQueries();
        renderForm({ modelProviderId: "row-a", providerKey: "openai" });
      });

      /** @scenario Editing a row shows its own saved credential, not another row's */
      it("shows the targeted row's saved API key, masked", async () => {
        await screen.findByText("OPENAI_API_KEY");
        const input = getInputNearLabel("OPENAI_API_KEY");
        expect(input.value).toBe(MASKED_KEY_PLACEHOLDER);
      });
    });

    describe("when the user re-enters the API key and clicks Save", () => {
      beforeEach(async () => {
        primeQueries();
        renderForm({ modelProviderId: "row-a", providerKey: "openai" });
        const user = userEvent.setup();
        await screen.findByText("OPENAI_API_KEY");
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
