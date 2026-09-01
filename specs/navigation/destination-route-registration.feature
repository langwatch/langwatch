# Routing in the app is a hand-maintained table in @langwatch/ui
# (apps/ui/src/model/ui-route-table.ts), not filesystem-based. Adding a page and linking to it are two edits; the third
# — registering the route — is the one nothing complains about.
#
# Sibling spec: project-scoped-destinations.feature covers whether a destination
# is *available* (dimmed when there is no project yet). This one covers whether
# it is *registered* — a destination can be perfectly available and still open
# nothing.

Feature: Navigation destinations resolve to registered routes
  As someone clicking an item in the menu
  I want it to open the page it names
  So that a shipped feature is not invisible behind a dead link

  Context: the Ops -> Migrations page shipped in #7079 with its page module and
  its sidebar entry, but no entry in the route table. The link was rendered,
  enabled and correctly labelled, and clicking it landed on the 404 page. The
  page module typechecked, the href was a plain string, and no test rendered the
  menu and followed it, so nothing in CI had an opinion. The feature was
  unreachable for as long as nobody clicked it.

  Destinations are named two ways, and both are covered. The ops menu writes
  absolute links directly. Everything project-scoped is declared as data in
  projectRoutes, which the menu turns into a link — the first version of this
  guard read only the written links and reported success over the declared ones
  it never looked at (#7113 review).

  Resolution has to mean what the router means by it. The table ends in a
  catch-all that renders the 404, so every path matches something; asking only
  whether a link matches some entry is a question that cannot fail.

  # ── Links written directly in the menu ────────────────────────────────

  @unit
  Scenario: Every sidebar link opens a page
    Given the menu writes a set of absolute links
    When each link is resolved the way the router would resolve it
    Then no link falls through to the catch-all route

  @unit
  Scenario: A sidebar link opens the page it names
    Given the menu writes a set of absolute links
    When each link is resolved the way the router would resolve it
    Then each one resolves to a route registered for that exact path
    And no link is served by a wildcard route belonging to another surface

  # ── Destinations declared as data ─────────────────────────────────────

  @unit
  Scenario: Every declared navigation destination opens a page
    Given the application declares its project-scoped destinations
    When each destination is resolved the way the router would resolve it
    Then no destination falls through to the catch-all route

  @unit
  Scenario: A declared destination opens the page it names
    Given the application declares its project-scoped destinations
    When each destination is resolved the way the router would resolve it
    Then each one resolves to the route registered for its own path
    But a destination inside a subtree a sub-router owns may be served by that
    sub-router, because the route table hands the whole subtree over and stops
    being able to answer for what is inside it
