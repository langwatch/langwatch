Feature: AI Gateway Governance — `?org=` organization switch on org-scoped pages

  Org-scoped pages (`/me`, `/settings/*`, `/governance`, the gateway pages)
  resolve the active organization from the `selectedOrganizationId` localStorage
  key, never from the URL. For a user in a single organization that is fine, but
  a multi-org user has no way to express "show me THIS org's page" in a link, and
  the workspace switcher's per-org "My Workspace" entries need a target that
  selects the right org before landing.

  The `?org=<slug>` query parameter fixes this uniformly: any org-scoped page,
  when loaded with `?org=<slug>` for an organization the user belongs to, selects
  that organization (writes `selectedOrganizationId`) and then strips the
  parameter from the URL so the address bar returns to the clean, memorable path
  (`/me`, `/settings/...`). The selection persists in localStorage, so the page
  and every later visit remember the last org. This keeps the short URLs while
  making per-org navigation expressible and shareable as a one-shot link.

  Background:
    Given a signed-in user who belongs to more than one organization

  @bdd @ui @governance @org-query-param @integration
  Scenario: Visiting an org-scoped page with `?org=<slug>` selects that org
    Given the user is currently on organization "alpha"
    When the user opens "/me?org=beta" where "beta" is an organization they belong to
    Then the selected organization becomes "beta"
    And the "?org" parameter is stripped so the URL reads "/me"

  @bdd @ui @governance @org-query-param @integration
  Scenario: The `?org=` switch works on any org-scoped page, preserving the path
    Given the user is currently on organization "alpha"
    When the user opens "/settings/gateway/virtual-keys?org=beta"
    Then the selected organization becomes "beta"
    And the URL is rewritten to "/settings/gateway/virtual-keys" without the "?org" parameter

  @bdd @ui @governance @org-query-param @integration
  Scenario: An `?org=<slug>` the user does not belong to is ignored
    Given the user is currently on organization "alpha"
    When the user opens "/me?org=not-a-member"
    Then the selected organization stays "alpha"
    And the "?org" parameter is stripped from the URL

  @bdd @ui @governance @org-query-param @integration
  Scenario: Other query parameters are preserved when `?org` is stripped
    When the user opens "/settings?org=beta&tab=billing"
    Then the selected organization becomes "beta"
    And the URL keeps "tab=billing" while only "org" is removed

  @bdd @ui @governance @org-query-param @integration
  Scenario: A page without `?org` leaves the remembered organization untouched
    Given the user last selected organization "beta"
    When the user opens "/me" with no "?org" parameter
    Then the page shows organization "beta" from the remembered selection
