# The route table (apps/ui/src/model/ui-route-table.ts) names a page by KEY and
# an installed module declares the loader for it. Sibling spec:
# destination-route-registration.feature covers whether a link resolves to a
# registered route. This one covers the step before that — whether the router
# the shell builds from the table exists at all.

Feature: The shell builds its router from the table it ships
  As someone opening the product
  I want the browser to draw
  So that one unserved address is one dead page, not a dead application

  Context: "the browser boots through the ui kernel" (01d92f9c74) deleted
  apps/ui/src/features whole. Two of the deleted files were LAYOUT routes the
  table still named — the application chrome and the project Langy layout — and
  createUiRouteObjects resolves every descriptor's loader when the router is
  BUILT, not when the address is navigated to. So the first unserved key threw
  before a single component rendered, and every address was dead, not just
  the two.

  The test that should have caught it listed all six unserved keys in an
  exemption array and asserted the undeclared set EQUALLED that array. It read
  green against a browser that could not start. An address nothing serves is a
  gap worth recording; it is not a reason to let the router fail to build.

  # ── The router exists ─────────────────────────────────────────────────

  @unit
  Scenario: The router builds from the table the shell ships
    Given the route table and the modules this build installs
    When the shell builds its router from them
    Then it builds, because every page key the table names has a loader

  @unit
  Scenario: An unserved page key refuses by its own name
    Given a route table naming a page key no loader is registered for
    When the shell builds its router
    Then it refuses naming that key, so the gap reads as a composition fault
      rather than as a failed navigation

  # ── The frame is not a feature ────────────────────────────────────────
  # A page key is an address a MODULE answers for. The chrome is the frame the
  # application draws around all of them, so the shell resolves it from its own
  # source and the table names it as a layout, carrying no key at all.

  @unit
  Scenario: The application chrome carries no page key
    Given the pathless layout drawn around every address behind a session
    When the route table is read for the page keys modules must serve
    Then the chrome is not among them
    And the route it materialises carries no page handle
