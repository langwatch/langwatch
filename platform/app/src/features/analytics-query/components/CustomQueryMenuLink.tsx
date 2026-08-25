/**
 * The analytics menu's entry for the Custom query page.
 *
 * Offered only where the backend says the LangWatchQL query path is provisioned.
 * The gate is a server answer, never a client flag: nothing a browser can be
 * told puts this link on a deployment that could not run the query behind it.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { MenuLink } from "~/components/MenuLink";
import { api } from "~/utils/api";

export interface CustomQueryMenuLinkProps {
  projectId: string;
  projectSlug: string;
}

export function CustomQueryMenuLink({
  projectId,
  projectSlug,
}: CustomQueryMenuLinkProps) {
  const availability = api.analytics.lwql.availability.useQuery(
    { projectId },
    {
      enabled: projectId.length > 0,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      // Provisioning does not change under a member mid-session.
      staleTime: Number.POSITIVE_INFINITY,
    },
  );

  // The hook runs on every render; only the markup is conditional.
  if (!availability.data?.available) return null;

  return <MenuLink href={`/${projectSlug}/analytics/query`}>Custom query</MenuLink>;
}
