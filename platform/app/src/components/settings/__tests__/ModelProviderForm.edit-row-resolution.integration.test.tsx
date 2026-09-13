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
 * left on the shared harness's real-implementation fallback — the
 * row-resolution memo and the real submit payload must actually execute for
 * this test to exercise the bug.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import {
  inputFor,
  modelProviderDrawerMocks,
  notReadyQueryResult,
  readyQueryResult,
  resetModelProviderDrawerMocks,
  Wrapper,
} from "./modelProviderDrawerHarness";
import { EditModelProviderForm } from "../ModelProviderForm";

const {
  mockMutateAsync,
  mockGetAllForProjectForFrontendQuery,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
} = modelProviderDrawerMocks;

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

describe("Feature: editing a model-provider row resolves the correct row by id", () => {
  beforeEach(() => {
    resetModelProviderDrawerMocks();
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
        expect(inputFor("OPENAI_API_KEY").value).toBe("");
        expect(screen.queryByText(/no longer exists/i)).toBeNull();
      });
    });

    describe("when the user enters a key and clicks Save", () => {
      beforeEach(async () => {
        primeQueries();
        renderNew();
        const user = userEvent.setup();
        const input = inputFor("OPENAI_API_KEY");
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

        const input = inputFor("OPENAI_API_KEY");
        await user.clear(input);
        await user.type(input, "sk-survives-rerender");
        expect(inputFor("OPENAI_API_KEY").value).toBe("sk-survives-rerender");

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

        expect(inputFor("OPENAI_API_KEY").value).toBe("sk-survives-rerender");
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
        const input = inputFor("OPENAI_API_KEY");
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
        const input = inputFor("OPENAI_API_KEY");
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
