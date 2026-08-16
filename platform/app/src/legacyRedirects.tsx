import type { RouteObject } from "react-router";
import { LegacyPrefixRedirect } from "~/components/LegacyPrefixRedirect";

/**
 * Prefixes that moved to a new top-level home. Old links, bookmarks, emails
 * and stored pins keep landing: the whole prefix forwards with sub-path,
 * query and hash intact, and the history entry is replaced. Shared as data
 * so the redirect tests exercise the same wiring routes.tsx mounts.
 *
 * Spec: specs/navigation/gateway-url-move.feature
 */
export const legacyRedirectRoutes: RouteObject[] = [
  {
    path: "/settings/gateway/*",
    element: <LegacyPrefixRedirect from="/settings/gateway" to="/gateway" />,
  },
  {
    path: "/settings/gateway",
    element: <LegacyPrefixRedirect from="/settings/gateway" to="/gateway" />,
  },
];
