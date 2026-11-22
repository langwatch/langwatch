import { useEffect, useRef } from "react";

import { useNavigationHost } from "../model/navigation-host.ts";
import { projectAddressRedirect } from "../model/project-address-redirect.ts";

/**
 * Sends an address that names a reserved word or a project this reader does not
 * have to the project the workspace resolved, keeping the rest of the address.
 */
export function useProjectAddressRedirect(): void {
  const host = useNavigationHost();
  const destination = projectAddressRedirect({
    projectParam: host.projectParam(),
    projectSlugFromAddress: host.projectSlugFromAddress(),
    project: host.project(),
    organization: host.organization(),
    organizations: host.organizations(),
    isLoading: host.isLoading(),
    demoProjectSlug: host.deployment().demoProjectSlug,
    pathname: host.pathname(),
    search: host.search(),
  });
  const replaced = useRef<string | null>(null);

  useEffect(() => {
    if (destination === null || replaced.current === destination) return;
    replaced.current = destination;
    host.replace(destination);
  }, [host, destination]);
}
