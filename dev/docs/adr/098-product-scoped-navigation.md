# ADR-098: Product-scoped navigation behind one flag

**Date:** 2026-08-16

**Status:** Proposed

## Context

LangWatch now serves four audiences with four different scopes:

- Me: a developer tracks their own coding assistants. Personal scope.
- LLM Ops: a team observes, tests and improves its agents. Project scope.
- Gateway: platform engineers route, meter and bill LLM usage. Organization
  scope.
- Governance: AI leads see every tool, license, agent and dollar.
  Organization scope.

The app shell still has the shape it had when LLM Ops was the whole product.
One sidebar holds project pages, organization products and personal pages.
One project selector sits on top of all of them. This produces wrong states:

- The settings page shows "Organization Settings" under a project selector.
- AI Gateway pages are organization-wide, lived at /settings/gateway, and
  render next to a project menu.
- The landing logic has four sources of truth for the current project (URL
  slug, three localStorage keys, the server-side first project), three
  preference layers (org primaryIntent, user lastHomePath,
  lastVisitedHomeKind) and two redirect engines (pages/index.tsx and a
  global effect in useOrganizationTeamProject). /me is special-cased in at
  least three files.

A greenfield prototype (github.com/langwatch/new-structure) iterated the
navigation with the founder across one long session. It settled a product
model with two candidate presentations. The team has not picked a winner.
Current customers must not see any change until we decide.

## Decision

1. Product model. The platform is five areas: Me, LLM Ops, Gateway,
   Governance and Settings. A typed registry
   (platform/app/src/features/navigation/) declares each product: id, label,
   pitch line, icon, scope kind, home and sidebar contents. Every new
   navigation surface (sidebar, icon rail, product switcher, command bar
   entries) reads this registry. Labels advertise function: Me "Track your
   coding assistants", LLM Ops "Observe, evaluate and test your agents",
   Gateway "Route, meter and bill LLM usage", Governance "Every AI tool,
   license, agent and dollar".

2. Three shells, one flag. A single PRODUCT flag
   `release_ui_navigation_v2_enabled` (default off) unlocks a per-device
   navigation mode with three values: `legacy` (the app exactly as today),
   `product-switcher` (a top-bar dropdown switches products) and `icon-rail`
   (a left rail switches products). The avatar menu gets a Navigation
   submenu to switch modes. Flag off, or mode `legacy`: the current chrome
   renders unchanged, and the mode preference stays on the device.

3. Scope follows the product. The top bar shows the organization as plain
   text, then the product-native scope: LLM Ops shows the project chip, Me
   shows the personal chip, Gateway and Governance show none. The sidebar
   shows only that product's pages, with Quick Search as the first item. The
   new modes drop the sidebar auto-collapse everywhere, settings and prompt
   playground included. Settings drops the product switcher for a static
   "Settings" title and gains a "Back to {product}" item as the first
   sidebar entry.

4. Landing memory is the product. In the new modes, the app remembers the
   last-visited product per organization on the device. `/` opens that
   product's home. Settings never becomes the remembered product. A first
   visit falls back to the org primary intent (ADR-038), then to the persona
   default. An explicit user pin (lastHomePath) still wins. After the first
   product visit, product memory outranks org intent; this is a deliberate
   deviation from ADR-038, which keeps applying unchanged to legacy mode.

5. URLs move now, without the flag. `/settings/gateway/*` becomes
   `/gateway/*`, and the governance family (`/settings/governance/*`,
   `/settings/routing-policies`) becomes `/governance/*`, like `/governance`
   already is at top level. Old URLs redirect permanently through a
   component-level `Navigate replace` that preserves sub-path, query and
   hash; the address bar shows the canonical URL. Redirects are safe in
   every mode, so they do not wait for the flag.

6. The settings menu regroups; pages stay. The settings menu becomes grouped
   and iconed: ORGANIZATION, ACCESS, AI INFRASTRUCTURE, DATA CONTROLS,
   PROJECT, plus the internal OPS and BACKOFFICE groups. Every current page
   keeps its route. The prototype's deeper consolidation (page merges,
   project-settings removal, /me/profile, org-slug URLs, saved dashboards,
   insights inbox) is direction for later ADRs, not this change.

## Rationale / Trade-offs

We ship two new shells because the team is still deciding between them. The
founder's framing: the switcher "makes the ui cleaner, however at the cost
of lower discoverability, on the other hand the ICP for one are will never
want to see the other". A per-device mode behind a flag lets the team run
both against real work and pick with evidence, while customers keep the
current shell.

The registry replaces four hand-written menus (MainMenu, PersonalSidebar,
SettingsLayout, and the item arrays in AiGatewayLayout and GovernanceLayout)
as the source for the new shells. The legacy components stay as they are,
because dozens of tests and feature files pin their exact behavior. The cost
is a period with two shell implementations; removing the flag later deletes
the legacy one.

Landing memory shrinks from three stacked preference layers to one value,
the last product, plus the existing project memory inside LLM Ops. Legacy
behavior stays bit-identical for flag-off customers: the new resolver and
the one suppressed redirect branch only run in the new modes.

## Consequences

- New feature files under specs/navigation/ pin the v2 shells, mode
  switching, product landing memory and the URL redirects. Existing feature
  files keep pinning legacy and get a mode note only.
- The command bar gains gateway, governance and personal entries from the
  registry.
- Every deep link, doc and CLI output that prints `/settings/gateway/*` or
  `/settings/governance/*` switches to the new paths; redirects keep old
  links, bookmarks, emails and DB-stored pins working.
- Project slug minting rejects reserved top-level names (gateway,
  governance, settings, me, ops and friends) as defense-in-depth; today the
  nanoid suffix already makes collisions impossible.
- Two shell implementations exist until the flag is removed.
- Follow-up ADRs own: settings page consolidation, /me/profile, org-slug
  URLs, saved dashboards, the insights inbox.

## References

- Related ADRs: ADR-038 (intent-forked onboarding; carries a forward note to
  this ADR), ADR-005 (feature flags).
- Prototype: github.com/langwatch/new-structure.
- specs/navigation/, specs/ai-gateway/governance/ (legacy pins).
