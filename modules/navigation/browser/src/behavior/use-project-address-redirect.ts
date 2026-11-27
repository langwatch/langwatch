import { useEffect, useRef } from "react";

import { useNavigationHost } from "../model/navigation-host.ts";
import { isOrganizationLibraryPath } from "../model/products.ts";
import { projectAddressRedirect } from "../model/project-address-redirect.ts";
import { useOrganizationDashboardsArea } from "./use-organization-dashboards-area.ts";

/** The project segment `/dashboards` was read as before the organization's library existed. */
const LIBRARY_SEGMENT_AS_PROJECT = "dashboards";

/**
 * Where an address naming a reserved word or a project this reader does not have goes, or null.
 * With the library's flag off, `/dashboards` still names a project, as it did (ADR-002).
 */
export function useProjectAddressDestination(): string | null {
  const host = useNavigationHost();
  const libraryArea = useOrganizationDashboardsArea();
  const readsAsProject = libraryArea === "legacy" && isOrganizationLibraryPath(host.pathname());
  return projectAddressRedirect({
    projectParam: readsAsProject ? LIBRARY_SEGMENT_AS_PROJECT : host.projectParam(),
    projectSlugFromAddress: readsAsProject
      ? LIBRARY_SEGMENT_AS_PROJECT
      : host.projectSlugFromAddress(),
    project: host.project(),
    organization: host.organization(),
    organizations: host.organizations(),
    isLoading: host.isLoading(),
    demoProjectSlug: host.deployment().demoProjectSlug,
    pathname: host.pathname(),
    search: host.search(),
  });
}

/**
 * Sends an address that names a reserved word or a project this reader does not
 * have to the project the workspace resolved, keeping the rest of the address.
 */
export function useProjectAddressRedirect(): void {
  const host = useNavigationHost();
  const destination = useProjectAddressDestination();
  const replaced = useRef<string | null>(null);

  useEffect(() => {
    if (destination === null || replaced.current === destination) return;
    replaced.current = destination;
    host.replace(destination);
  }, [host, destination]);
}
