/**
 * useUrlScopeFilter — syncs a `PageScopeFilter` with the `?scope=TYPE:id`
 * URL query parameter.
 *
 * Shared between the model-providers and api-keys settings pages so neither
 * contains a duplicate `useEffect` + `handleScopeFilterChange` pair.
 *
 * ## URL contract
 *   - `?scope=ORGANIZATION:<id>` → specific org filter
 *   - `?scope=TEAM:<id>`         → specific team filter
 *   - `?scope=PROJECT:<id>`      → specific project filter
 *   - absent / malformed         → `{ kind: "all" }`
 *
 * Stale URLs (deleted team/project) fall back to `{ kind: "all" }` so the
 * filter label never renders "Team: undefined".
 *
 * ## Setter behaviour
 *   - `all`             → strips `scope` from query
 *   - `team-current`    → writes `?scope=TEAM:<teamId>` (noop when no teamId)
 *   - `project-current` → writes `?scope=PROJECT:<projectId>` (noop when no projectId)
 *   - `specific`        → writes `?scope=<scopeType>:<scopeId>`
 */

import { useEffect, useState } from "react";
import type { ScopeFilter as PageScopeFilter } from "~/components/settings/ScopeFilter";
import type { AvailableScopes } from "~/hooks/useAvailableScopes";
import { useRouter } from "~/utils/compat/next-router";

export function useUrlScopeFilter({
  filterAvailable,
  teamId,
  projectId,
}: {
  filterAvailable: AvailableScopes;
  teamId: string | undefined;
  projectId: string | undefined;
}): [PageScopeFilter, (next: PageScopeFilter) => void] {
  const router = useRouter();
  const [scopeFilter, setScopeFilter] = useState<PageScopeFilter>({
    kind: "all",
  });

  // Hydrate scope filter from ?scope=TYPE:id URL param.
  // Re-runs when filterAvailable populates so the chip can resolve the
  // human-readable name from the org graph instead of an opaque id.
  useEffect(() => {
    const raw = router.query.scope;
    if (typeof raw !== "string") {
      setScopeFilter({ kind: "all" });
      return;
    }
    const sepIdx = raw.indexOf(":");
    if (sepIdx <= 0 || sepIdx === raw.length - 1) {
      setScopeFilter({ kind: "all" });
      return;
    }
    const scopeType = raw.slice(0, sepIdx);
    const scopeId = raw.slice(sepIdx + 1);
    if (
      scopeType !== "ORGANIZATION" &&
      scopeType !== "TEAM" &&
      scopeType !== "PROJECT"
    ) {
      setScopeFilter({ kind: "all" });
      return;
    }
    let name: string | undefined;
    if (scopeType === "ORGANIZATION") {
      name =
        filterAvailable.organization?.id === scopeId
          ? filterAvailable.organization.name
          : undefined;
    } else if (scopeType === "TEAM") {
      name = filterAvailable.teams.find((t) => t.id === scopeId)?.name;
    } else {
      name = filterAvailable.projects.find((p) => p.id === scopeId)?.name;
    }
    if (name !== undefined) {
      setScopeFilter({
        kind: "specific",
        scopeType,
        scopeId,
        name,
      } as PageScopeFilter);
    } else {
      // Scope no longer exists in the org graph (deleted team/project from
      // a stale URL) — fall back to "all" so the filter label doesn't render
      // "Team: undefined" or similar.
      setScopeFilter({ kind: "all" });
    }
  }, [router.query.scope, filterAvailable]);

  // Persist scope filter changes to URL.
  const handleScopeFilterChange = (next: PageScopeFilter): void => {
    setScopeFilter(next);
    if (next.kind === "all") {
      const { scope: _scope, ...rest } = router.query as Record<string, string>;
      void router.replace({ query: rest });
    } else if (next.kind === "team-current" && teamId) {
      void router.replace({
        query: { ...router.query, scope: `TEAM:${teamId}` },
      });
    } else if (next.kind === "project-current" && projectId) {
      void router.replace({
        query: { ...router.query, scope: `PROJECT:${projectId}` },
      });
    } else if (next.kind === "specific") {
      void router.replace({
        query: { ...router.query, scope: `${next.scopeType}:${next.scopeId}` },
      });
    }
  };

  return [scopeFilter, handleScopeFilterChange];
}
