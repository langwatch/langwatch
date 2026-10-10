import { useEffect, useRef } from "react";

import { belongsToNoOrganization } from "../model/belongs-to-no-organization.ts";
import { useNavigationHost } from "../model/navigation-host.ts";
import { isResolverAddress } from "../model/resolve-shell-route.ts";

/**
 * A reader with no organization (a disabled member's list is empty, specs/licensing/
 * seat-reconciliation.feature) never waits on an address that needs one: they go to
 * the front door, which sends them to onboarding.
 */
export function useOrglessAddressRedirect({ personalScope }: { personalScope: boolean }): void {
  const host = useNavigationHost();
  const isOrgless =
    host.currentUser() !== undefined &&
    belongsToNoOrganization({
      isWorkspaceResolving: host.isLoading(),
      organization: host.organization(),
      organizations: host.organizations(),
    });
  const shouldLeave = isOrgless && !personalScope && !isResolverAddress(host.pathname());
  const replaced = useRef(false);

  useEffect(() => {
    if (!shouldLeave || replaced.current) return;
    replaced.current = true;
    host.replace("/");
  }, [host, shouldLeave]);
}
