import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * Flat (uncollapsed) list of every stored ModelProvider row the caller can
 * see — one entry per row, never deduped by provider type.
 *
 * `useModelProvidersSettings` returns a `Record<providerKey, row>` collapsed
 * to a single winner per provider type (narrowest scope wins), which is
 * correct for surfaces that render "the effective config for provider X"
 * but wrong for anything that resolves a SPECIFIC row by id: a
 * multi-instance setup (two "openai" rows at different scopes) drops the
 * non-winning row from that Record entirely, so an id lookup against it
 * silently misses and falls back to a blank draft (#5380). Any caller that
 * looks up a row by id — not by provider key — must read from this flat
 * list instead.
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

  return {
    providers: (activeQuery.data?.providers ??
      []) as MaybeStoredModelProvider[],
    isLoading: activeQuery.isLoading,
    refetch: activeQuery.refetch,
  } as const;
}
