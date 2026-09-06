/**
 * Flat (uncollapsed) list of every stored provider row the caller can see —
 * one entry per row, never deduped by provider type. `useModelProvidersSettings`
 * collapses to one winner per type, which drops non-winning rows from a
 * multi-instance setup and silently misses an id lookup against it (#5380).
 * The providers table reads this instead.
 */

import type { ModelProviderListEntry } from "@langwatch/model-provider-contract";
import type { WireOf } from "@langwatch/platform-api-client/feature-api";

/** A listed provider as the browser holds one: its instants are ISO strings. */
export type ModelProviderListRow = WireOf<ModelProviderListEntry>;
import { useModelProviderHost } from "../model/model-provider-host.ts";
import { modelProviderApi } from "./model-provider-api.ts";

/**
 * A fresh `[]` per render with no data would re-fire any memo depending on
 * `providers` every render (the render-loop class behind #5380). This
 * module-level constant keeps the empty-list identity stable; `readonly`
 * since every caller shares the one instance.
 */
const NO_PROVIDERS: readonly ModelProviderListRow[] = [];

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
     * react-query's own flag, forwarded unchanged: true for a disabled query
     * (shows the skeleton until scope hydrates), false the moment it errors
     * (a 403 under `retry: false`, showing the empty surface instead).
     */
    isLoading: activeQuery.isLoading,
    /**
     * Whether the list has actually arrived — not the negation of
     * `isLoading`. A disabled query is neither loading nor has data, and
     * mounting the form off it would silently drop a stored row on save.
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
 * Resolves a single row by id out of the flat list above. Shared by the
 * editor form's edit-target memo and the drawer's title lookup, so the two
 * can never resolve different rows for the same id (#5380). Generic over
 * the row so callers get back exactly what they passed in.
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
