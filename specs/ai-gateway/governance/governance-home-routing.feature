Feature: Governance home — route, nav promotion, persona detection
  The governance product surface lives at top-level `/governance` (a
  daily-use org-scoped home), NOT under Settings. The whole family
  lives there: `/governance/inventory*`, `/governance/agents`,
  `/governance/people`, and — behind the
  `release_ui_governance_billed_cost_enabled` flag — `/governance/costs`,
  and the Platform placeholders
  `/governance/insights`, `/governance/analytics` and
  `/governance/signals`. The unfinished `/governance/billed` address
  stays unavailable even with that flag on. Routing policies are gateway behavior and
  live at `/gateway/routing-policies` instead. The legacy
  `/settings/governance*` and `/settings/routing-policies` addresses
  redirect permanently to the new ones
  (specs/navigation/gateway-url-move.feature), and six retired
  governance addresses redirect too: `/governance/catalog*` and
  `/governance/ingestion-sources*` (both meant the sources surface),
  `/governance/tool-catalog` (now the Inventory catalog tab),
  `/governance/anomaly-rules` (which pointed at an Inventory tab that has
  since been removed, so it now degrades to the Catalog pane),
  `/governance/users` (now the People tab of the people page) and
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
  # overview page and asserts the heading and the hero. The bound test
  # renders the page component; the address staying put on a cold load
  # rides on the route registration the alias scenarios below exercise.
  #
  # The overview's panels moved to the pages that own them, so what says the
  # dashboard rendered is the hero and its ways in, not a metrics view.
  @bdd @ui @governance-home @route @integration
  Scenario: Top-level /governance renders the dashboard
    When the admin navigates to "/governance"
    Then the page renders with the heading "AI Governance"
    And the URL stays at "/governance"
    And the hero and its ways in are rendered

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
      (Catalog + Environments + Sources)
    And "/governance/inventory/<id>" is the per-source
      detail page
    And "/governance/agents" is the agents surface, listing the agents
      detected through the organization's connected sources
    # The daily-use dashboard at /governance links into them, and into the
    # routing-policy surface the gateway owns at /gateway/routing-policies.

  @bdd @ui @governance-home @route @alias @integration
  Scenario: The retired anomaly rules address still resolves
    When the admin cold-loads "/governance/anomaly-rules"
    Then they land on "/governance/inventory?tab=anomaly-rules"
    And the old address is not kept in the browser history
    # The redirect still pins the tab it was written for, and that tab is now
    # gone: anomaly rules left the inventory, because a rule is a standing
    # instruction about what to watch for rather than a thing the organization
    # runs. The pinned value therefore degrades to the Catalog pane — see
    # "The retired anomaly-rules tab value lands on the catalog" below, which
    # is what stops it landing on nothing. Repointing this redirect at the
    # rules' eventual home is a routing change and is NOT done here.

  @bdd @ui @governance-home @route @alias @integration
  Scenario: The retired users listing address lands on the People tab
    When the admin cold-loads "/governance/users?range=30d"
    Then they land on "/governance/people?range=30d&tab=people"
    # The existing query travels; only the tab is pinned.

  @bdd @ui @governance-home @route @alias @integration
  Scenario: A user detail deep link keeps its own page
    When the admin cold-loads "/governance/users/<id>"
    Then the per-user detail page renders at that address
    # The redirect is exact-match on the bare listing address, never a
    # prefix: the detail pages have no tab to fold into.

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
    # default tab on /governance/inventory is Catalog, so
    # the redirect must pin ?tab=sources or every stored sources link —
    # quarantine alerts, source chips, post-archive returns — would
    # silently land on the catalog pane.

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
    And their default tab is Catalog
    # Bare, no ?tab=, and the same landing for every recipient of the
    # stored link. The tiles editor the retired address served is no
    # longer on this page at all: the tiles are the CLI's gateway-versus-
    # direct policy map and belong with the settings that own that
    # policy, not on the inventory. Catalog now means the catalog of
    # tools the organization has actually connected, which is the nearest
    # honest answer for someone following an old tool-catalog link.

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
  # (the registered-tools catalog, one card per connected tool),
  # Environments (the environments discovered from those sources), Sources
  # (the ingestion-sources table) and Anomaly rules (the rules editor,
  # formerly /governance/anomaly-rules). A selected non-default tab is part
  # of the address (?tab=); the default stays out of it.
  #
  # The default is Catalog for every reader. It used to be
  # permission-sensitive — Catalog for aiTools:manage holders, Sources for
  # everyone else — because Catalog was then the tool-tiles editor, which
  # only those holders could use. The pane that replaced them still reads
  # the tool registry and is still gated on aiTools:manage, so what changed
  # is not the grant but what a reader without it meets: the pane names the
  # grant instead of silently sending them somewhere else. Routing one bare
  # link to two different panes for two recipients hid the grant behind a
  # redirect, which is the thing that was wrong with it.
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: The inventory default tab stays out of the address
    When the admin opens "/governance/inventory"
    Then the Catalog tab is selected and the registered-tools catalog
      renders inside it
    And the address carries no "tab" parameter

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: The Sources tab is addressable
    When the admin opens "/governance/inventory?tab=sources"
    Then the Sources tab is selected and the sources table renders inside it

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: The bare address opens the same pane for every reader
    Given a delegated viewer holding governance:view and
      ingestionSources:view but NOT aiTools:manage
    When they open "/governance/inventory"
    Then the Catalog tab is selected, the same pane the admin lands on
    And the address carries no "tab" parameter

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: A reader without the registry grant meets the grant, not an empty catalog
    Given a reader holding governance:view but NOT aiTools:manage
    When they open "/governance/inventory"
    Then the Catalog tab is still selected and still listed
    And the pane names aiTools:manage rather than reporting that
      no tools are registered
    # The catalog reads the tool registry, not the ingestion sources, so
    # aiTools:manage is the grant that genuinely gates it. Naming the source
    # grant would name one that would not unblock this reader if granted.
    And the Catalog tab carries no count, because a count of zero would be
      the same wrong answer said in a badge

  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: An unknown tab value falls back to the default
    When the admin opens "/governance/inventory?tab=nonsense"
    Then the Catalog tab is selected and the registered-tools catalog renders
    # Never a blank pane: a stale or mistyped tab value degrades to the
    # default instead of selecting nothing.

  # Anomaly rules left the inventory: a rule is a standing instruction about
  # what to watch for, not a thing the organization runs, so it belongs with
  # alerts and signals. The retired /governance/anomaly-rules address still
  # redirects here with tab=anomaly-rules pinned, so that value has to degrade
  # to a real pane rather than select nothing.
  @bdd @ui @governance-home @inventory-tabs @integration
  Scenario: The retired anomaly-rules tab value lands on the catalog
    Given an admin holding ingestionSources:view
    When the admin opens "/governance/inventory?tab=anomaly-rules"
    Then no Anomaly rules tab is listed
    And the Catalog tab is selected and the registered-tools catalog renders
    # The grant is named because the second Then is an EXISTENCE claim about
    # the catalog. A reader without ingestionSources:view also lands on
    # Catalog, correctly, and reads a grant notice there instead — so without
    # the Given this scenario is false for that reader rather than silent about
    # them. Their landing has its own scenario above.

  # ---------------------------------------------------------------------------
  # `?add=<sourceType>` — the deep link the overview and the docs hand out.
  # It opens the Add source composer on that type once and then leaves the
  # address, so a reload or a shared link never re-opens it. Only a type
  # the Add source menu itself would offer counts: the same plan gate the
  # menu reads decides, so a locked type cannot slip in through the
  # address any more than through a click.
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @inventory-add-param @integration
  Scenario: An add parameter opens the composer on that source type and leaves the address
    Given an admin holding ingestionSources:manage on an Enterprise plan
    When they open "/governance/inventory?tab=sources&add=claude_code"
    Then the Sources tab is selected
    And the Add source composer opens committed to "Claude Code"
    And the address keeps the tab parameter and carries no "add" parameter

  @bdd @ui @governance-home @inventory-add-param @integration
  Scenario: A locked add parameter is ignored and leaves the address
    Given an admin holding ingestionSources:manage on a non-Enterprise plan
    When they open "/governance/inventory?tab=sources&add=claude_code"
    Then no composer opens
    And the address carries no "add" parameter
    # Silently: the menu already says what Enterprise unlocks, and a link
    # someone pasted is no occasion for an error.

  @bdd @ui @governance-home @bypass-project-redirect @unit
  Scenario: The inventory family is exempt from the no-organization onboarding bouncer
    Given a session that belongs to no organization yet
    When it sits on "/governance/inventory", "/governance/inventory/<id>",
      "/governance/people", "/governance/agents", "/governance/costs",
      "/governance/billed", "/governance/insights", "/governance/analytics"
      or "/governance/signals"
    Then the route is recognized as bouncer-exempt, like every sibling
      governance route, instead of bouncing to "/onboarding/welcome"
    # The bounce fires only for zero-ORG sessions (an org with zero
    # projects never bounces — useOrganizationTeamProject returns early).
    # The exemption is an exact-match lookup over noOrgBouncerRoutes
    # against the pattern resolvePathname derives from ROUTE_PATTERNS,
    # which falls back to the raw pathname when no pattern matches — so
    # /governance/catalog/<id> needs BOTH lists or the exemption misses.
    # The retired addresses (ingestion-sources, catalog, tool-catalog,
    # anomaly-rules, users, departments, cost-centers) stay listed too, so
    # each redirect route renders before the bouncer fires (cost-centers
    # precedent). Sibling pages also carry withPermissionGuard's
    # bypassOnboardingRedirect as a third layer; the catalog page keeps it.

  # ---------------------------------------------------------------------------
  # Agents address contract — the agents page is one surface listing the
  # agents detected through the organization's connected sources. It carried
  # an Applications tab beside them until the product owner asked for it
  # gone: the pane behind it read nothing and listed nothing, so it was a tab
  # a reader could press and learn nothing from. With one pane left there was
  # nothing to switch between and the tab strip went too, taking "?tab=" off
  # this page with it.
  #
  # What is in the address instead is how the fleet is drawn. The same
  # contract the tab had: the default (the list) stays out of the address, a
  # non-default choice is written to it as "?view=", and an unknown value
  # degrades to the default rather than to a blank pane. No organization-wide
  # list exists yet, so the page issues no query — the shape ships ahead of
  # the data, as Costs did.
  #
  # Sample mode fills the pane on arrival, because the section rule fills any
  # governance page with nothing measured on it
  # (specs/ai-governance/dashboard/agents-page.feature). The scenarios below
  # that read the pane's own sentence therefore say in their Given that the
  # reader has turned sample data off. The other two do not depend on it: no
  # query is issued either way, and the guard refuses before any of it
  # renders.
  #
  # These scenarios do not quote the pane's sentences. They used to, and it
  # made a routing feature break every time the copy changed — twice now. What
  # a pane SAYS belongs to the page's own feature file; what routing owns is
  # that the right thing arrives and is not blank. The exact words, the two
  # layouts, and the rule that every empty state carries an action live in
  # specs/ai-governance/dashboard/agents-page.feature.
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @agents-tabs @integration
  Scenario: The agents page default layout stays out of the address
    Given the reader has turned sample data off
    When a governance viewer opens "/governance/agents"
    Then the heading "Agents" renders
    And the page renders its own empty state, offering a way to register an
      agent
    And the address carries no "view" parameter

  @bdd @ui @governance-home @agents-tabs @integration
  Scenario: The agents page issues no query while no organization list exists
    When a governance viewer opens "/governance/agents"
    Then no procedure is queried
    # Honest empty state: nothing org-scoped lists agents yet (every agents
    # procedure is project-scoped), so nothing is fetched and no rows are
    # invented.

  @bdd @ui @governance-home @agents-tabs @integration
  Scenario: An unknown agents layout value falls back to the list
    When a governance viewer opens "/governance/agents?view=nonsense"
    Then the agents list renders rather than a blank pane

  @bdd @ui @governance-home @agents-tabs @integration
  Scenario: The agents page is guarded on governance:view
    Given a member holding only "organization:view"
    When they open "/governance/agents"
    Then the page does not render
    # Same guard composition as every governance page: the section flag
    # release_ui_ai_governance_enabled and then governance:view.

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
      | Agents            | /governance/agents                            |
      | People            | /governance/people                            |
    # Tool Tiles is gone from the rail, and off the Inventory page too:
    # the Inventory Catalog tab is the catalog of connected tools, not the
    # tile editor. Anomaly Rules is gone from the rail as well, and does
    # live inside Inventory, as its own tab.
    # Costs and Platform join the rail only when
    # release_ui_governance_billed_cost_enabled is on; Billed stays absent
    # (see the billed-cost flag section below).

  @bdd @ui @governance-home @layout @integration
  Scenario: Anomaly Rules and Billed are no longer rail entries
    When the admin looks at the GOVERNANCE rail with the billed-cost flag
      off, and again with it on
    Then neither "Anomaly Rules" nor "Billed" is listed either time
    # Anomaly rules still exist, as an Inventory tab. The unfinished
    # /governance/billed address is unavailable under either flag state
    # (see the billed-cost flag section below).

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
  # Costs release gate; the unfinished Billed destination stays unavailable
  # ---------------------------------------------------------------------------

  @bdd @ui @governance-home @billed-cost-flag @integration
  Scenario: With the billed-cost flag off, Costs does not exist
    Given "release_ui_governance_billed_cost_enabled" is disabled
      for the organization
    When the admin looks at the GOVERNANCE rail
    Then no "Costs" entry is listed
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
  Scenario: With the billed-cost flag on, Costs appears without the unfinished Billed destination
    Given "release_ui_governance_billed_cost_enabled" is enabled
      for the organization
    When the admin looks at the GOVERNANCE rail
    Then "Costs" (/governance/costs) is listed between Overview and Inventory
    And no "Billed" entry is listed
    And "Insights" (/governance/insights), "Analytics"
      (/governance/analytics) and "Signals & Alerts"
      (/governance/signals) are listed after People, in that order
    # The three Platform entries ride the same flag on purpose: they are
    # placeholder screens for the Langy-driven brief, explore and rule
    # registry that ADR-128's cost work leads into, and they are meant
    # to be previewed by the same audience that previews Costs. Their
    # bodies and headings are specified and bound in specs/governance/
    # governance-platform-placeholders.feature; this scenario pins only
    # the rail listing, and its binding renders no page.

  @bdd @ui @governance-home @billed-cost-flag @integration
  Scenario: The unfinished Billed address stays unavailable when Costs is enabled
    Given "release_ui_governance_billed_cost_enabled" is enabled
      for the organization
    When the admin cold-loads "/governance/billed"
    Then the not-found scene is shown instead of an unfinished page
