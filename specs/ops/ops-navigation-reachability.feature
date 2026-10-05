# Routing in the app is a hand-maintained table in platform/app/src/routes.tsx,
# not filesystem-based. Adding a page and linking to it are two edits; the third
# — registering the route — is the one nothing complains about.

Feature: Ops navigation reachability
  As an operator opening a page from the ops sidebar
  I want every link in the menu to open the page it names
  So that a shipped feature is not invisible behind a dead link

  Context: the Ops -> Migrations page shipped in #7079 with its page module and
  its sidebar entry, but no entry in the route table. The link was rendered,
  enabled and correctly labelled, and clicking it landed on the 404 page. The
  page module typechecked, the href was a plain string, and no test rendered the
  menu and followed it, so nothing in CI had an opinion. The feature was
  unreachable in production for as long as nobody clicked it.

  @unit
  Scenario: Every sidebar link opens a page
    Given the ops sidebar renders a set of links
    When each link is resolved against the application's route table
    Then no link falls through to the catch-all route

  @unit
  Scenario: A sidebar link opens the page it names
    Given the ops sidebar renders a set of links
    When each link is resolved against the application's route table
    Then each one resolves to a route registered for that exact path
    And no link is served by a wildcard route belonging to another surface
