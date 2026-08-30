import { api, type RouterOutputs } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

// A fresh `[]` on every render with no data (a disabled, in-flight, or
// errored query) hands each render a new array reference. Any consumer that
// lists `providers` in an effect or memo dependency then re-fires every
// render — the render-loop class behind #5380, the same one
// `useModelProviderForm`'s reset effect trips on through `provider.extraHeaders`.
// A module-level constant keeps the empty-list identity stable so those
// dependency arrays don't churn. `readonly` because every caller shares this
// one instance: a stray `push`/`sort` on a "local" copy would corrupt the
// empty list for everyone.
/**
 * One element type for this hook, taken from the procedure rather than
 * asserted beside it.
 *
 * The empty case used to be typed `ModelProviderEditorValue[]` while the
 * queries answer `(…).map(toLegacyProvider)`. The two differ, so
 * `data ?? NO_PROVIDERS` produced a UNION, and a union does not satisfy
 * `filterProvidersByScope<T extends ProviderWithScopes>` — `T` collapsed to
 * the constraint and every caller lost the fields it reads.
 */
type ListedModelProvider = RouterOutputs["modelProvider"]["listAllForProjectForFrontend"][number];

const NO_PROVIDERS: readonly ListedModelProvider[] = [];

/**
 * Flat (uncollapsed) list of every stored ModelProvider row the caller can
 * see — one entry per row, never deduped by provider type. Canonical
 * rationale for this hook's existence — point comments elsewhere at this
 * block instead of restating it.
 *
 * `useModelProvidersSettings` returns a `Record<providerKey, row>` collapsed
 * to a single winner per provider type (narrowest scope wins), which is
 * correct for surfaces that render "the effective config for provider X"
 * but wrong for anything that resolves a SPECIFIC row by id: a
 * multi-instance setup (two "openai" rows at different scopes) drops the
 * non-winning row from that Record entirely, so an id lookup against it
 * silently misses and falls back to a blank draft (#5380). Any caller that
 * looks up a row by id — not by provider key — must read from this flat
 * list instead, via `findModelProviderById` below.
 *
 * Note on the loading signal: the flat list answers two different questions,
 * so this hook exposes two flags. They are NOT complementary — both go false
 * once the query errors — so do not "simplify" either into `!other`.
 *
 *   - `isReady` (≡ react-query `isSuccess`) means the list *definitively
 *     arrived*: the query ran and resolved. It is false for a disabled query
 *     (org/project id not yet hydrated), an in-flight fetch, AND an errored
 *     one. A caller that must tell "genuinely empty" apart from "not loaded
 *     yet" — e.g. deciding an id lookup is a real stale miss rather than a
 *     not-ready list — gates on `isReady`, so an empty array only counts as
 *     empty once `isReady` is true. (Opposite direction to the `isReady` in
 *     `features/traces-v2/hooks/useTraceQueryArgs.ts`, which is a *pre-fetch*
 *     gate meaning "we have enough input to enable the query at all". Same
 *     word, different question.)
 *   - `isLoading` is react-query's own flag, forwarded unchanged
 *     (`status === 'loading'`). It stays true for a *disabled* query — v4
 *     leaves a never-fetched query at `status: 'loading'` — which is what
 *     `EditModelProviderDrawer` wants: keep spinning until org/project
 *     hydrate rather than mount a form off an empty list. It flips false the
 *     moment the query *errors* (a 403 under `retry: false`), so a permission
 *     failure shows the (empty) surface instead of spinning forever.
 *
 *     Deliberately NOT `isLoading` (`isLoading && isFetching`), which
 *     is false for a disabled query and would make the drawer skip its
 *     spinner and mount the form off an empty list — the exact failure this
 *     signal exists to prevent.
 */
export function useAllModelProvidersList() {
  const { project, organization, hasPermission } = useOrganizationTeamProject();

  // "All you can see" fans out across the whole organization so an
  // org:view admin sees providers a sibling project has configured.
  // Members without `organization:view` (project-only members) 403 on
  // that endpoint and must fall back to the per-project list, which they
  // always have permission to read.
  const canViewOrg = hasPermission("organization:view");

  const orgQuery = api.modelProvider.listAllForOrganizationForFrontend.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization?.id && canViewOrg,
      retry: false,
      // A focus refetch mid-edit would re-seed whichever form is reading
      // this list and wipe the user's in-progress typing — same failure
      // shape #5357 fixed for the model picker.
      refetchOnWindowFocus: false,
    },
  );
  const projectQuery = api.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id && !canViewOrg,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const activeQuery = canViewOrg ? orgQuery : projectQuery;

  // Both procedures resolve to the same thing: the provider LIST itself,
  // `(await …listFor…()).map(toLegacyProvider)`. They used to answer
  // `{ providers, modelMetadata }`, and this read `data?.providers` — which on
  // an array is `undefined`, so `?? NO_PROVIDERS` turned the whole settings
  // page into an empty list without an error anywhere.
  return {
    providers: activeQuery.data ?? NO_PROVIDERS,
    // See the "Note on the loading signal" block above for what each of these
    // answers, and why they are not complementary.
    isReady: activeQuery.isSuccess,
    isLoading: activeQuery.isLoading,
    refetch: activeQuery.refetch,
  } as const;
}

/**
 * True when `modelProviderId` names an actual stored row — i.e. it's
 * neither absent nor the Add-flow sentinel `"new"`. Shared so every
 * caller that branches on "is there a specific row to resolve" uses the
 * same rule.
 */
export function isResolvableProviderId(modelProviderId: string | undefined): boolean {
  return !!modelProviderId && modelProviderId !== "new";
}

/**
 * Resolves a single row by id from the flat list above. Shared by
 * `ModelProviderForm`'s edit-target memo and `EditModelProviderDrawer`'s
 * title lookup so the two can never again resolve different rows for the
 * same id — the #5380 bug was exactly two separate resolvers drifting.
 */
export function findModelProviderById<T extends { id: string }>({
  providers,
  modelProviderId,
}: {
  // Generic over the row, not pinned to one shape: this resolves out of
  // whatever list the caller holds, and naming a concrete type here would
  // hand every caller back something narrower than what it passed in — the
  // same way `filterProvidersByScope`'s constraint does when its argument is
  // a union.
  providers: readonly T[];
  modelProviderId: string | undefined;
}): T | undefined {
  if (!isResolvableProviderId(modelProviderId)) return undefined;
  return providers.find((p) => p.id === modelProviderId);
}
