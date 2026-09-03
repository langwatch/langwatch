/**
 * Flat (uncollapsed) list of every stored provider row the caller can see —
 * one entry per row, never deduped by provider type.
 *
 * `useModelProvidersSettings` (still `platform/app`'s, for the editor drawer)
 * returns a `Record<providerKey, row>` collapsed to a single winner per
 * provider type, which is correct for a surface that renders "the effective
 * config for provider X" and wrong for anything that resolves a SPECIFIC row by
 * id: a multi-instance setup (two "openai" rows at different scopes) drops the
 * non-winning row from that Record entirely, so an id lookup against it
 * silently misses (#5380). The providers table lists rows, so it reads this.
 *
 * Harvested from `platform/app/src/hooks/useAllModelProvidersList.ts`. The
 * providers table took the hook alone; `findModelProviderById`,
 * `isResolvableProviderId` and the `isReady` signal followed when the provider
 * editor drawer was recovered, because those three exist for exactly one
 * question — "is there a specific stored row to resolve, and has the list
 * settled enough to say" — and the drawer is what asks it.
 */

import type { ModelProviderListEntry } from "@langwatch/model-provider-contract";
import { useModelProviderHost } from "../model/model-provider-host";
import { modelProviderApi } from "./model-provider-api";

/**
 * A fresh `[]` on every render with no data (a disabled, in-flight or errored
 * query) hands each render a new array reference, and any consumer that lists
 * `providers` in a memo's dependencies then re-fires every render — the
 * render-loop class behind #5380. A module-level constant keeps the empty-list
 * identity stable. `readonly` because every caller shares this one instance: a
 * stray `push`/`sort` on a "local" copy would corrupt the empty list for
 * everyone.
 */
const NO_PROVIDERS: readonly ModelProviderListEntry[] = [];

export function useAllModelProvidersList() {
  const host = useModelProviderHost();
  const { organizationId, projectId } = host.scope();

  // "All you can see" fans out across the whole organization so an
  // `organization:view` admin sees providers a sibling project has configured.
  // Members without that grant (project-only members) 403 on that endpoint and
  // must fall back to the per-project list, which they always may read.
  const canViewOrg = host.hasPermission("organization:view");

  const orgQuery = modelProviderApi.modelProvider.listAllForOrganizationForFrontend.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: !!organizationId && canViewOrg,
      retry: false,
      // A focus refetch mid-edit would re-seed whichever form is reading this
      // list and wipe the user's in-progress typing — the same failure shape
      // #5357 fixed for the model picker.
      refetchOnWindowFocus: false,
    },
  );
  const projectQuery = modelProviderApi.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: !!projectId && !canViewOrg,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const activeQuery = canViewOrg ? orgQuery : projectQuery;

  return {
    providers: activeQuery.data ?? NO_PROVIDERS,
    /**
     * react-query's own flag, forwarded unchanged. It stays true for a DISABLED
     * query — v4 leaves a never-fetched query at `status: "loading"` — which is
     * what the table wants: show the skeleton until the scope hydrates rather
     * than render "No model providers" over a list nobody has asked for. It
     * flips false the moment the query ERRORS (a 403 under `retry: false`), so
     * a permission failure shows the empty surface instead of spinning forever.
     */
    isLoading: activeQuery.isLoading,
    /**
     * Whether the list has actually ARRIVED, which is not the negation of
     * `isLoading`.
     *
     * The editor drawer gates its form on this rather than on `!isLoading`: a
     * disabled query is not loading and has no data either, and mounting the
     * form off an empty list is what would silently drop a stored row's values
     * on save.
     */
    isReady: activeQuery.isSuccess,
    refetch: activeQuery.refetch,
  } as const;
}

/**
 * Whether `modelProviderId` names an actual stored row.
 *
 * Neither absent nor the Add-flow sentinel `"new"`. Shared so every caller that
 * branches on "is there a specific row to resolve" uses the same rule.
 */
export function isResolvableProviderId(modelProviderId: string | undefined): boolean {
  return !!modelProviderId && modelProviderId !== "new";
}

/**
 * Resolves a single row by id out of the flat list above.
 *
 * Shared by the editor form's edit-target memo and the drawer's title lookup so
 * the two can never resolve different rows for the same id — #5380 was exactly
 * two separate resolvers drifting.
 *
 * Generic over the row rather than pinned to one shape: it resolves out of
 * whatever list the caller holds, and naming a concrete type would hand every
 * caller back something narrower than what it passed in.
 */
export function findModelProviderById<T extends { id: string }>({
  providers,
  modelProviderId,
}: {
  providers: readonly T[];
  modelProviderId: string | undefined;
}): T | undefined {
  if (!isResolvableProviderId(modelProviderId)) return undefined;
  return providers.find((candidate) => candidate.id === modelProviderId);
}
