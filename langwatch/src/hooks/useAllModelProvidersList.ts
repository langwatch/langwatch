import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

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
 * so this hook exposes two flags rather than one overloaded `isLoading`:
 *
 *   - `isReady` (≡ react-query `isSuccess`) means the list *definitively
 *     arrived*: the query ran and resolved. It is false for a disabled query
 *     (org/project id not yet hydrated), an in-flight fetch, AND an errored
 *     one. A caller that must tell "genuinely empty" apart from "not loaded
 *     yet" — e.g. deciding an id lookup is a real stale miss rather than a
 *     not-ready list — gates on `isReady`, so an empty array only counts as
 *     empty once `isReady` is true.
 *   - `isLoading` here is a *spinner* signal: `!isSuccess && !isError`, i.e.
 *     "no definitive answer yet". It stays true for a disabled query — in
 *     react-query v4 a disabled query still reports `status: 'loading'`, and
 *     a surface like `EditModelProviderDrawer` genuinely should keep spinning
 *     until org/project hydrate rather than mount a form off an empty list.
 *     It flips to false the moment the query *errors* (a 403 with
 *     `retry:false`), so a permission failure shows the (empty) surface
 *     instead of spinning forever.
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

  // Both procedures resolve to the identical `{ providers, modelMetadata }`
  // shape (same MaybeStoredModelProvider[] / ModelMetadataForFrontend
  // types on both branches), so tRPC's inference already gives
  // `activeQuery.data?.providers` the right type here with no cast needed.
  return {
    providers: activeQuery.data?.providers ?? [],
    // The flat list definitively arrived (see the "Note on the loading
    // signal" block above): false for disabled, in-flight, and errored
    // queries.
    isReady: activeQuery.isSuccess,
    // Spinner signal — "no definitive answer yet". True while the query is
    // disabled or fetching; false once it resolves OR errors.
    isLoading: !activeQuery.isSuccess && !activeQuery.isError,
    refetch: activeQuery.refetch,
  } as const;
}

/**
 * True when `modelProviderId` names an actual stored row — i.e. it's
 * neither absent nor the Add-flow sentinel `"new"`. Shared so every
 * caller that branches on "is there a specific row to resolve" uses the
 * same rule.
 */
export function isResolvableProviderId(
  modelProviderId: string | undefined,
): boolean {
  return !!modelProviderId && modelProviderId !== "new";
}

/**
 * Resolves a single row by id from the flat list above. Shared by
 * `ModelProviderForm`'s edit-target memo and `EditModelProviderDrawer`'s
 * title lookup so the two can never again resolve different rows for the
 * same id — the #5380 bug was exactly two separate resolvers drifting.
 */
export function findModelProviderById({
  providers,
  modelProviderId,
}: {
  providers: MaybeStoredModelProvider[];
  modelProviderId: string | undefined;
}): MaybeStoredModelProvider | undefined {
  if (!isResolvableProviderId(modelProviderId)) return undefined;
  return providers.find((p) => p.id === modelProviderId);
}
