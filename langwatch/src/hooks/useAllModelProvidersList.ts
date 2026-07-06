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
 * Note on the loading signal: a disabled query (the org/project id is
 * momentarily unresolved, e.g. before the app-shell context hydrates)
 * reports `isLoading: false` with `providers: []` — react-query only
 * reports `isLoading` for a query that's actually enabled and fetching.
 * Consumers that gate a seed-once form on "don't mount off an empty list"
 * (`EditModelProviderDrawer`) rely on the surrounding settings page having
 * already hydrated org/project before the drawer can even open; this hook
 * does not itself distinguish "genuinely empty" from "not ready yet".
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
    isLoading: activeQuery.isLoading,
    refetch: activeQuery.refetch,
  } as const;
}

/**
 * Resolves a single row by id from the flat list above. Shared by
 * `ModelProviderForm`'s edit-target memo and `EditModelProviderDrawer`'s
 * title lookup so the two can never again resolve different rows for the
 * same id — the #5380 bug was exactly two separate resolvers drifting.
 */
export function findModelProviderById(
  providers: MaybeStoredModelProvider[],
  modelProviderId: string | undefined,
): MaybeStoredModelProvider | undefined {
  if (!modelProviderId || modelProviderId === "new") return undefined;
  return providers.find((p) => p.id === modelProviderId);
}
