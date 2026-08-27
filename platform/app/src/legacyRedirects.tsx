import type { RouteObject } from "react-router";
import { LegacyPrefixRedirect } from "~/components/LegacyPrefixRedirect";

/**
 * Prefixes that moved to a new top-level home. Old links, bookmarks, emails
 * and stored pins keep landing: the whole prefix forwards with sub-path,
 * query and hash intact, and the history entry is replaced. Shared as data
 * so the redirect tests exercise the same wiring routes.tsx mounts.
 *
 * Spec: specs/navigation/gateway-url-move.feature and
 * specs/ai-gateway/governance/governance-home-routing.feature (the retired
 * ingestion-sources prefix).
 */
export const legacyRedirectRoutes: RouteObject[] = [
  // The sources surface has had three addresses: ingestion-sources →
  // catalog (PR-renamed) → the inventory Sources tab. Every retired
  // address maps STRAIGHT to its final home — no chaining through the
  // also-retired middle name. The bare forms pin ?tab=sources, overriding
  // any tab the old address carried: they served one pane, so every value
  // they ever took rendered the sources list, while the inventory default
  // is Catalog. The deep-link forms go to the detail page, which has no
  // tabs.
  {
    path: "/governance/ingestion-sources/*",
    element: (
      <LegacyPrefixRedirect
        from="/governance/ingestion-sources"
        to="/governance/inventory"
      />
    ),
  },
  {
    path: "/governance/ingestion-sources",
    element: (
      <LegacyPrefixRedirect
        from="/governance/ingestion-sources"
        to="/governance/inventory"
        pinParams={{ tab: "sources" }}
      />
    ),
  },
  {
    path: "/governance/catalog/*",
    element: (
      <LegacyPrefixRedirect
        from="/governance/catalog"
        to="/governance/inventory"
      />
    ),
  },
  {
    path: "/governance/catalog",
    element: (
      <LegacyPrefixRedirect
        from="/governance/catalog"
        to="/governance/inventory"
        pinParams={{ tab: "sources" }}
      />
    ),
  },
  {
    // Bare, no ?tab=: the bare inventory address resolves to the Catalog
    // tab for the aiTools:manage admins this page served, and to Sources
    // for viewers — the pane they can actually read.
    path: "/governance/tool-catalog",
    element: (
      <LegacyPrefixRedirect
        from="/governance/tool-catalog"
        to="/governance/inventory"
      />
    ),
  },
  {
    path: "/governance/departments",
    element: (
      <LegacyPrefixRedirect
        from="/governance/departments"
        to="/governance/people"
      />
    ),
  },
  {
    path: "/settings/gateway/*",
    element: <LegacyPrefixRedirect from="/settings/gateway" to="/gateway" />,
  },
  {
    path: "/settings/gateway",
    element: <LegacyPrefixRedirect from="/settings/gateway" to="/gateway" />,
  },
  {
    path: "/settings/governance/*",
    element: <LegacyPrefixRedirect from="/settings/governance" to="/governance" />,
  },
  {
    path: "/settings/governance",
    element: <LegacyPrefixRedirect from="/settings/governance" to="/governance" />,
  },
  {
    path: "/settings/routing-policies/*",
    element: (
      <LegacyPrefixRedirect
        from="/settings/routing-policies"
        to="/gateway/routing-policies"
      />
    ),
  },
  {
    path: "/settings/routing-policies",
    element: (
      <LegacyPrefixRedirect
        from="/settings/routing-policies"
        to="/gateway/routing-policies"
      />
    ),
  },
];
