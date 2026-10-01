Feature: The team settings page reads as main's does
  One team's settings open inside the settings shell, with the settings sidebar,
  and the way to the organization's members is a link, as it is on main.

  @unit
  Scenario: The team settings page is declared inside the settings shell
    Given a browser that installs organization
    When the team settings screen is looked up
    Then it sits at "/settings/teams/:team" within "settings"

  @integration
  Scenario: The team settings page offers the organization's members as a link
    Given a team the reader may edit
    When the team settings page opens
    Then "Manage organization members" is a link to "/settings/members"
