/**
 * The one-shot `?org=<slug>` organization switch for org-scoped pages.
 * Spec: specs/ai-gateway/governance/org-query-param-switch.feature
 */

import { trpcQueryKey } from "@langwatch/platform-api-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { UiScopeOrganization } from "../model/ui-scope";
import { UI_ORGANIZATIONS_PROCEDURE } from "./ui-organization-facts";
import { useUiRpc } from "./ui-rpc";
import { uiOrgQueryParamWrites } from "./ui-scope-resolution";
import { UI_ORG_QUERY_PARAM, useUiRouteReading } from "./ui-scope-route";
import { broadcastUiScopeWrite, useUiScopeMemory, writeUiScopeSelection } from "./ui-scope-storage";

/** The organization graph, narrowed to what the membership test reads. */
type UiOrgParamOrganizations = readonly Pick<UiScopeOrganization, "id" | "slug">[];

/**
 * Mounted once above the org-scoped pages — by `UiAppChrome`, which is the
 * route every one of them is served under.
 */
export function useUiOrgQueryParamSelection(): void {
  const { orgParam } = useUiRouteReading();
  const memory = useUiScopeMemory();
  const rpc = useUiRpc();
  const [, setSearchParams] = useSearchParams();

  const input = { isDemo: false };
  // Asked only when the address names an organization: a page without `?org`
  // costs nothing, and one with it shares the shell's own cache entry.
  const organizations = useQuery({
    queryKey: trpcQueryKey(UI_ORGANIZATIONS_PROCEDURE, { input, type: "query" }),
    queryFn: () => rpc.query(UI_ORGANIZATIONS_PROCEDURE, input) as Promise<UiOrgParamOrganizations>,
    enabled: orgParam !== "",
  });

  const graph = organizations.data;
  const writes = useMemo(
    () => uiOrgQueryParamWrites({ orgParam, organizations: graph, selection: memory.selection }),
    [orgParam, graph, memory.selection],
  );

  useEffect(() => {
    // Membership can only be judged once the graph has arrived; the effect
    // re-runs and strips when it does.
    if (!orgParam || graph === void 0) return;

    if (writes.length > 0) {
      writeUiScopeSelection({
        writes,
        storage: window.localStorage,
        broadcast: broadcastUiScopeWrite,
      });
    }

    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(UI_ORG_QUERY_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [orgParam, graph, writes, setSearchParams]);
}
