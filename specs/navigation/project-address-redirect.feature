Feature: Addresses that name the wrong project
  As a member following a link from a mail, a doc or an old bookmark
  I want an address that names no project of mine to open the same page in my project
  So that a link written without my project, or with somebody else's, still lands

  Main redirected these from `useOrganizationTeamProject`, which every page
  mounted. The branch moved the resolution into organization's scope and left
  the redirect behind, so `/@project/traces` drew my traces under an address
  naming no project, and `/{slug}/not-found` threw for want of the navigation
  host. Alex ruled the redirect lives in the navigation shell.

  @unit
  Scenario: An address that names nothing draws the 404 inside the chrome
    Given the route table the shell builds its router from
    When the 404 and the @project forward are located in it
    Then both sit under the chrome layout, which mounts the navigation host

  @unit
  Scenario: An address naming a project I do not have opens the same page in mine
    Given my workspace resolved to the project "mine"
    When I open "/bad-slug/traces/abc?view=table"
    Then I am sent to "/mine/traces/abc?view=table"

  @unit
  Scenario: An @project address opens the same page in my project
    Given my workspace resolved to the project "mine"
    When I open "/@project/traces"
    Then I am sent to "/mine/traces"

  @unit
  Scenario: A page name in the project's place opens that page in my project
    Given my workspace resolved to the project "mine"
    When I open "/analytics"
    Then I am sent to "/mine/analytics"

  @unit
  Scenario: An address naming my project stays where it is
    Given my workspace resolved to the project "mine"
    When I open "/mine/traces"
    Then I am not sent anywhere

  @unit
  Scenario: Nothing is redirected while the workspace is still resolving
    Given my session or my organization graph has not settled
    When I open "/bad-slug/traces"
    Then I am not sent anywhere until it has

  @unit
  Scenario: An organization that declared its intent is not sent to a project
    Given my organization declared what it is for
    When I open "/bad-slug/traces"
    Then I am not sent anywhere, as main's onboarded-organization rule decides

  @unit
  Scenario: The demo project address stays where it is
    Given the deployment shares a demo project "demo"
    When I open "/demo/traces"
    Then I am not sent anywhere

  @integration
  Scenario: The shell sends a wrong project address to the reader's project
    Given the navigation shell draws "/@project/traces?view=table"
    And my workspace resolved to the project "demo"
    When the chrome renders
    Then the address is replaced once with "/demo/traces?view=table"
