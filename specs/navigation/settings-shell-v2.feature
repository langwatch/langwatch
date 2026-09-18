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
  visibility gate keeps its current condition. The back entry and its
  rule sit above the scroll region, so a long settings menu never
  scrolls the way out of the column, and the entries are cut at that
  rule as they pass under it.

  API Keys sits in the ORGANIZATION group, under General. In ACCESS it
  came after four enterprise entries most readers cannot open, which put
  a page they use often at the bottom of a group they have no use for.

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
  Scenario: The settings groups fold, and start open
    Given I open Settings in a new navigation mode
    Then every settings group is open
    When I press a group heading
    Then that group folds away and the other groups stay as they are
    And my choice is kept for the next time I open Settings

  @integration
  Scenario: A rule separates the way back from the pages below it
    Given I open Settings in a new navigation mode
    Then a rule runs under the way back entry

  @integration
  Scenario: The way back stays in place while the menu scrolls
    Given I open Settings in a new navigation mode
    When the settings menu scrolls
    Then the way back entry stays where it is
    And only the pages under the rule move

  @integration
  Scenario: The pages are cut at the rule as they scroll under the way back
    Given I open Settings in a new navigation mode
    Then the part that scrolls starts at the rule under the way back
    And the space under that rule scrolls with the pages

  @integration
  Scenario: API Keys sits under General
    Given I open Settings in a new navigation mode
    Then API Keys comes right after General in the ORGANIZATION group
    And the ACCESS group does not hold it

  @integration
  Scenario: The menu marks the page that is open
    Given I open the Email Suppressions settings page
    Then the Email Suppressions entry is marked as the open one
    And no other entry is marked

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
