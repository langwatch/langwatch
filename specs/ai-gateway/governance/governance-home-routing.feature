Feature: Governance home — route, nav promotion, persona detection
  The governance product surface lives at top-level `/governance` (a
  daily-use org-scoped home), NOT under Settings. The whole family
  lives there: `/governance/inventory*`, `/governance/anomaly-rules`,
  `/governance/people`, and — behind the
  `release_ui_governance_billed_cost_enabled` flag — `/governance/costs`
  and `/governance/billed`. Routing policies are gateway behavior and
  live at `/gateway/routing-policies` instead. The legacy
  `/settings/governance*` and `/settings/routing-policies` addresses
  redirect permanently to the new ones
  (specs/navigation/gateway-url-move.feature), and four retired
  governance addresses redirect too: `/governance/catalog*` and
  `/governance/ingestion-sources*` (both meant the sources surface),
  `/governance/tool-catalog` (now the Inventory catalog tab) and
  `/governance/departments` (renamed People).

  A `Governance` entry surfaces in the MainMenu sidebar ONLY for org
  admins whose org has actual governance state. Vast-majority current
  LLMOps users (no personal VKs / no IngestionSources / no governance
  flag) see no nav change — protecting the "don't lose LLMOps" invariant
  per @rchaves's iter-12 feedback.

  Background:
    Given the feature flag "release_ui_ai_governance_enabled" is enabled
      for the organization
    And the user has the "organization:manage" permission

  # ---------------------------------------------------------------------------
  # Route — top-level + back-compat alias
  # ---------------------------------------------------------------------------

  # Bound to delegatedViewer.integration.test.tsx, which renders the
  # overview page and asserts the heading and every panel. The bound test
  # renders the page component; the address staying put on a cold load
  # rides on the route registration the alias scenarios below exercise.
  @bdd @ui @governance-home @route @integration
  Scenario: Top-level /governance renders the dashboard
    When the admin navigates to "/governance"
    Then the page renders with the heading "AI Governance"
    And the URL stays at "/governance"
    And the setup-checklist OR live-metrics view is rendered

  # Declared gap: specs/navigation/gateway-url-move.feature asserts the
  # DEEP-LINK form (/settings/governance/tool-catalog?... keeps its path
  # and query) and the retargeted cost-centers hop — but no test cold-loads
  # the bare legacy address and asserts where it lands. The prefix redirect
  # in legacyRedirects.tsx should cover it; nothing pins that.
  @bdd @ui @governance-home @route @alias @integration @unimplemented
  Scenario: Legacy /settings/governance keeps working as a redirect
    When the admin navigates to "/settings/governance"
    Then the browser lands on "/governance" with the same dashboard
    And no 404 is shown
    And admins who bookmarked the legacy URL keep landing on the
      dashboard through the permanent redirect

  # Declared gap: /governance/inventory and its tabs are asserted below,
  # but the per-source detail page and /governance/anomaly-rules as the
  # rule-authoring surface are declared nowhere else — the rail scenario
  # at the bottom names anomaly-rules only as a link target, and no test
  # renders either address.
  @bdd @ui @governance-home @route @sub-routes @integration @unimplemented
  Scenario: Admin-authoring sub-routes live under /governance
    Then "/governance/inventory" is the tabbed inventory surface
      (Catalog + Sources)
    And "/governance/inventory/<id>" is the per-source
      detail page
    And "/governance/anomaly-rules" is the rule authoring surface
    # The daily-use dashboard at /governance links into them, and into the
    # routing-policy surface the gateway owns at /gateway/routing-policies.

  @bdd @ui @governance-home @route @alias @integration
  Scenario: The retired ingestion sources address lands on the inventory Sources tab
    When the admin cold-loads "/governance/ingestion-sources"
    Then they land on "/governance/inventory?tab=sources"
    And the old address is not kept in the browser history
    # Direct, not chained through the also-retired /governance/catalog:
    # each retired address maps straight to its final home.

  @bdd @ui @governance-home @route @alias @integration
  Scenario: An old ingestion source deep link lands on the inventory detail page
    When the admin cold-loads "/governance/ingestion-sources/src_123?range=30d"
    Then they land on "/governance/inventory/src_123?range=30d"

  @bdd @ui @governance-home @route @alias @integration
  Scenario: The retired catalog address keeps meaning the sources surface
    When the admin cold-loads "/governance/catalog"
    Then they land on "/governance/inventory?tab=sources"
    # Bare /governance/catalog always meant the sources list. The new
    # default tab on /governance/inventory is Catalog (tool tiles), so
    # the redirect must pin ?tab=sources or every stored sources link —
    # quarantine alerts, source chips, post-archive returns — would
    # silently land on the tool-tiles pane.

  @bdd @ui @governance-home @route @alias @integration
  Scenario: A stale tab value on a retired sources address still lands on Sources
    When the admin cold-loads "/governance/catalog?tab=catalog"
    Then they land on "/governance/inventory?tab=sources"
    # The retired addresses offered exactly one pane, so every ?tab= value
    # they ever carried rendered the sources list — an unknown value fell
    # back to the only tab there was. Carrying such a value forward would
    # hand the reader a different pane than the address used to mean, so
    # the retired sources addresses pin the tab rather than default it.

  @bdd @ui @governance-home @route @alias @integration
  Scenario: An old catalog detail deep link lands on the inventory detail page
    When the admin cold-loads "/governance/catalog/src_123?range=30d"
    Then they land on "/governance/inventory/src_123?range=30d"

  @bdd @ui @governance-home @route @alias @integration
  Scenario: The retired tool-catalog address lands on the inventory page
    When the admin cold-loads "/governance/tool-catalog"
    Then they land on "/governance/inventory"
    And as an aiTools:manage holder their default tab is Catalog —
      the same editor the retired address served
    # Bare, no ?tab=: the bare address means "your default pane". A
    # viewer following the same stored link lands on Sources instead,
    # which is the pane they can actually read.

  @bdd @ui @governance-home @route @alias @integration
  Scenario: The retired departments address lands on People
    When the admin cold-loads "/governance/departments"
    Then they land on "/governance/people"

  @bdd @ui @governance-home @route @alias @integration
  Scenario: The cost-centers redirect is retargeted to People in one hop
    When the admin cold-loads "/governance/cost-centers"
    Then they land on "/governance/people"
    # Retargeted, not chained: the old cost-centers → departments
    # redirect must not become cost-centers → departments → people.

  # ---------------------------------------------------------------------------
  # Inventory tab shell — the inventory page is a tabbed surface: Catalog
  # (the tool-tiles editor, formerly /governance/tool-catalog, carrying its
  # own inner Tool Tiles / Ingestion Templates tabs unchanged) and Sources
  # (the ingestion-sources table). A selected non-default tab is part of
  # the address (?tab=); the default stays out of it. The default is
  # permission-sensitive: Catalog for admins holding aiTools:manage,
  # Sources otherwise — so the BARE address means "your default pane" and
  # can resolve differently for different recipients of the same link.
  # That is accepted deliberately: the ?tab= form is the stable shareable
  # address, and both resolutions are the same page.
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: The inventory default tab stays out of the address
    When the admin opens "/governance/inventory"
    Then the Catalog tab is selected and the tool-tiles editor renders inside it
    And the address carries no "tab" parameter

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: The Sources tab is addressable
    When the admin opens "/governance/inventory?tab=sources"
    Then the Sources tab is selected and the sources table renders inside it

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: A delegated viewer without aiTools:manage defaults to Sources
    Given a delegated viewer holding governance:view and
      ingestionSources:view but NOT aiTools:manage
    When they open "/governance/inventory"
    Then the Sources tab is selected and the sources table renders
    And the Catalog tab is still listed — selecting it shows the
      aiTools:manage permission notice inside the pane (the notice the
      old tool-catalog page showed full-page, now scoped to the tab)

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: An unknown tab value falls back to the default
    When the admin opens "/governance/inventory?tab=nonsense"
    Then the Catalog tab is selected and the tool-tiles editor renders
    # Never a blank pane: a stale or mistyped tab value degrades to the
    # default instead of selecting nothing.

  @bdd @ui @governance-home @bypass-project-redirect @unit
  Scenario: The inventory family is exempt from the no-organization onboarding bouncer
    Given a session that belongs to no organization yet
    When it sits on "/governance/inventory", "/governance/inventory/<id>",
      "/governance/people", "/governance/costs" or "/governance/billed"
    Then the route is recognized as bouncer-exempt, like every sibling
      governance route, instead of bouncing to "/onboarding/welcome"
    # The bounce fires only for zero-ORG sessions (an org with zero
    # projects never bounces — useOrganizationTeamProject returns early).
    # The exemption is an exact-match lookup over noOrgBouncerRoutes
    # against the pattern resolvePathname derives from ROUTE_PATTERNS,
    # which falls back to the raw pathname when no pattern matches — so
    # /governance/catalog/<id> needs BOTH lists or the exemption misses.
    # The retired addresses (ingestion-sources, catalog, tool-catalog,
    # departments, cost-centers) stay listed too, so each redirect
    # route renders before the bouncer fires (cost-centers precedent).
    # Sibling pages also carry withPermissionGuard's
    # bypassOnboardingRedirect as a third layer; the catalog page keeps it.

  # ---------------------------------------------------------------------------
  # Nav promotion — the Governance product entry
  #
  # The four scenarios that used to sit here described the #7597-era UI: a
  # "Govern · Preview" sidebar section header with an Eye icon, gated on
  # flag + org-admin permission + setup state. Two of those gates are gone:
  # the header string no longer exists anywhere in the app, and setup state
  # no longer feeds the nav decision at all — the entry today is a product
  # in features/navigation/products.ts, gated on the flag AND the
  # "governance:view" permission (note the drift: the old scenarios said
  # "organization:manage"). The two scenarios below re-declare the gating
  # that IS live. The generic product-gating machinery has lane-tagged
  # coverage in specs/navigation/*, but nothing asserts governance's own
  # two gates specifically, so both stay declared gaps.
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @nav-promotion @flag @integration @unimplemented
  Scenario: Without the governance flag there is no Governance product entry
    Given "release_ui_ai_governance_enabled" is disabled for the org
    And the user holds "governance:view"
    When the user opens the product navigation
    Then no "Governance" product entry is listed

  @bdd @ui @governance-home @nav-promotion @rbac @integration @unimplemented
  Scenario: The Governance product entry requires governance:view
    Given "release_ui_ai_governance_enabled" is enabled for the org
    But the user does NOT hold "governance:view"
    When the user opens the product navigation
    Then no "Governance" product entry is listed
    But a user holding "governance:view" sees the entry
    And the entry's home is "/governance"

  # ---------------------------------------------------------------------------
  # No auto-redirect (master_orchestrator's invariant)
  # ---------------------------------------------------------------------------

  # Declared gap: no test navigates "/" with governance state present and
  # asserts the absence of a redirect.
  @bdd @ui @governance-home @no-auto-redirect @integration @unimplemented
  Scenario: Hitting "/" never auto-redirects to /governance
    Given the admin has governanceActive=true
    When they navigate to "/"
    Then the existing project-pick / org-default routing applies
    And they are NOT auto-redirected to "/governance"
    # Governance is a nav promotion, not a forced home. Admins can
    # discover it via the sidebar; auto-redirect would be too
    # aggressive and would surprise project-only LLMOps admins.

  # ---------------------------------------------------------------------------
  # api.governance.setupState contract
  # ---------------------------------------------------------------------------

  # Bound: auth-cli-governance.integration.test.ts asserts the REST shape
  # (all five hasFoo flags plus the OR), and governance.rbac /
  # license-gate-governance pin the tRPC procedure's shape and its gate.
  @bdd @api @governance-home @setup-state @integration
  Scenario: setupState returns boolean OR for nav-promotion signal
    When the admin's session resolves and the MainMenu calls
      `api.governance.setupState({organizationId})`
    Then the response shape is:
      | field                | type    | meaning                                   |
      | hasPersonalVKs       | boolean | any non-archived personal VK in org       |
      | hasRoutingPolicies   | boolean | any RoutingPolicy in org                  |
      | hasIngestionSources  | boolean | any non-archived IngestionSource in org   |
      | hasAnomalyRules      | boolean | any non-archived AnomalyRule in org       |
      | hasRecentActivity    | boolean | any gateway_activity_event in last 30d    |
      | governanceActive     | boolean | OR of the five hasFoo flags above         |
    And the procedure is gated on "governance:view" — an org member
      without it is refused (governance.rbac.integration.test.ts pins
      the FORBIDDEN), not the any-member read this scenario once claimed
    And the query is cheap (small index lookups + a single
      gateway_activity_events count); MainMenu reads it on every
      page load with `refetchOnWindowFocus: false`

  # ---------------------------------------------------------------------------
  # Layout — current + future
  # ---------------------------------------------------------------------------

  # Declared gap, narrower than it looks: the rail entries ARE asserted —
  # sectionNavParity.integration.test.tsx renders GovernanceLayout and pins
  # exactly the four entries in the table below (bound to the billed-cost
  # scenario at the bottom). What no test asserts is the header chrome:
  # the org-name chip and the org-scoped indicator.
  @bdd @ui @governance-home @layout @integration @unimplemented
  Scenario: /governance renders with the GovernanceLayout (top-level chrome)
    Given "release_ui_governance_billed_cost_enabled" is disabled
      for the organization
    When the admin loads "/governance"
    Then the page renders inside GovernanceLayout — NOT SettingsLayout
    And the header replaces the per-project ProjectSelector with an
      org-name chip + "Organization-scoped — not tied to a project"
      indicator (governance is org-scoped, not project-scoped)
    And the left rail shows a "GOVERNANCE" section header with these
      sub-routes:
      | label             | href                                          |
      | Overview          | /governance                                   |
      | Inventory         | /governance/inventory                         |
      | Anomaly Rules     | /governance/anomaly-rules                     |
      | People            | /governance/people                            |
    # Tool Tiles is gone from the rail — it lives inside Inventory as
    # the Catalog tab. Costs and Billed join the rail only when
    # release_ui_governance_billed_cost_enabled is on (see the
    # billed-cost flag section below).

  # The former "Admin-authoring sub-routes share the GovernanceLayout chrome"
  # scenario restated the rail listing the scenario above already declares,
  # with no assertion of its own beyond "same chrome"; one behaviour, one
  # scenario.

  # Declared gap: no test loads /governance for a zero-project org and
  # asserts the layout renders instead of the project-onboarding bounce.
  @bdd @ui @governance-home @layout @bypass-project-redirect @integration @unimplemented
  Scenario: /governance bypasses the no-project onboarding redirect
    Given an admin whose org has no projects yet
    When they navigate to "/governance"
    Then the GovernanceLayout renders without bouncing them to
      project-onboarding (DashboardLayout's `orgScope` flag bypasses
      the `redirectToProjectOnboarding` gate, same effect as
      `personalScope` for `/me/*` routes)
    And the org-name chip + indicator render correctly even with
      project=null

  # ---------------------------------------------------------------------------
  # Costs + Billed placeholders — behind release_ui_governance_billed_cost_enabled
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @billed-cost-flag @integration
  Scenario: With the billed-cost flag off, Costs and Billed do not exist
    Given "release_ui_governance_billed_cost_enabled" is disabled
      for the organization
    When the admin looks at the GOVERNANCE rail
    Then no "Costs" and no "Billed" entries are listed
    And cold-loading "/governance/costs" or "/governance/billed"
      shows the not-found scene, the same off-behavior every
      flag-guarded governance page already has
    # Unreachable, not merely unlisted: an empty page behind a hidden
    # nav item is a half-gate. Off-behavior follows the existing
    # withFeatureFlagGuard semantic (NotFoundScene), not a redirect.
    # Composition: both pages sit behind release_ui_ai_governance_enabled
    # AND this flag — the section-wide gate in feature-flag-gating.feature
    # still hides every governance surface on its own.

  @bdd @ui @governance-home @billed-cost-flag @integration
  Scenario: With the billed-cost flag on, Costs and Billed appear as placeholders
    Given "release_ui_governance_billed_cost_enabled" is enabled
      for the organization
    When the admin looks at the GOVERNANCE rail
    Then "Costs" (/governance/costs) and "Billed" (/governance/billed)
      are listed between Overview and Inventory
    And each page renders its heading
    # Costs has since grown its real content — the billed/gateway/seat
    # lanes of specs/governance/governance-cost-screen.feature (ADR-128
    # wave 1). Billed is still the placeholder shell this scenario was
    # written for. The scenario TITLE is left verbatim because it is the
    # parity binding key for sectionNavParity.integration.test.tsx, which
    # asserts the rail listing and not either page's body.
