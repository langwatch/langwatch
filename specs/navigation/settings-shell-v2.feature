Feature: Settings shell in the new navigation modes
  As a user on a new navigation mode
  I want Settings to read as a detour with a clear way back
  So that configuration never feels like another product

  In the new modes the settings pages render inside the navigation-v2
  shell. The top bar shows a static "Settings" title in place of the
  product dropdown (the icon rail marks its Settings tile instead), and
  the organization control stays. The sidebar opens with a back entry
  that returns to the product the user came from, then Quick Search,
  then the settings menu regrouped with icons: ORGANIZATION, ACCESS,
  AI INFRASTRUCTURE, DATA CONTROLS, PROJECT, and the internal OPS and
  BACKOFFICE groups with their current gates. Enterprise-plan entries
  carry a quiet grey pill, since it marks a plan rather than asking to
  be read first. Every settings page keeps its address, and every
  visibility gate keeps its current condition.

  Devices on the legacy mode keep the current settings chrome
  unchanged.

  @integration
  Scenario: The Settings sidebar opens with the way back
    Given I entered Settings from a Gateway page in a new navigation mode
    Then the first sidebar entry goes back to that Gateway page
    And Quick Search comes right after it

  @integration
  Scenario: The settings menu is grouped with its gates kept
    Given I open Settings in a new navigation mode
    Then the sidebar shows the ORGANIZATION and ACCESS groups
    And General and Members keep their current addresses

  @integration
  Scenario: Enterprise entries carry a quiet grey pill
    Given my plan shows the enterprise settings entries
    When the settings sidebar renders in a new navigation mode
    Then the enterprise entries carry an "ENT" pill
    And the pill is grey with a hairline border, not a coloured one

  @integration
  Scenario: A rule separates the way back from the pages below it
    Given I open Settings in a new navigation mode
    Then a rule runs under the way back entry

  @integration
  Scenario: A lite member sees no restricted settings entries
    Given I am a lite member
    When the settings sidebar renders in a new navigation mode
    Then there is no API Keys entry and no Secrets entry

  @integration
  Scenario: The top bar shows a static Settings title
    Given I open Settings in the product-switcher mode
    Then the top bar shows "Settings" with no product dropdown
    And the organization control stays in the top bar

  @integration
  Scenario: Legacy mode keeps the current settings chrome
    Given my device is on the legacy mode
    When I open Settings
    Then the current settings navigation renders unchanged
