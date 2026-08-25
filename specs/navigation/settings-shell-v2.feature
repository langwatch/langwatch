Feature: Settings shell in the new navigation modes
  As a user on a new navigation mode
  I want Settings to read as a detour with a clear way back
  So that configuration never feels like another product

  In the new modes the settings pages render inside the navigation-v2
  shell. The top bar shows a static "Settings" title in place of the
  product dropdown (the icon rail marks its Settings tile instead), and
  the organization control stays. The sidebar opens with a back entry
  that returns to the product the user came from, then Quick Search,
  then the settings menu regrouped with icons: YOU, ORGANIZATION,
  PEOPLE & ACCESS, AI INFRASTRUCTURE, DATA CONTROLS, PROJECT, and the internal OPS and
  BACKOFFICE groups with their current gates. Enterprise-plan entries
  carry a quiet grey pill, since it marks a plan rather than asking to
  be read first. Every visibility gate keeps its current condition. The
  back entry and its rule sit above the scroll region, so a long
  settings menu never scrolls the way out of the column, and the
  entries are cut at that rule as they pass under it.

  YOU comes first and holds Profile and Security: the two pages that are
  about the person reading them rather than about the organization they
  are in. Everything below the first group is somebody's colleague's
  business; these two are nobody's but theirs, and a reader hunting for
  their own password should not have to work out which organization
  heading hides it. Neither page asks for an organization permission,
  because a member with no administrative authority at all still has a
  name, a photo and a password.

  API Keys sits in the ORGANIZATION group, under General. In the access
  group it came after four enterprise entries most readers cannot open,
  which put a page they use often at the bottom of a group they have no
  use for.

  PEOPLE & ACCESS holds Members, Teams & Projects, Roles, Single Sign-On,
  Directory, Access and Audit Log. Role Bindings is gone as an entry: it
  is the second tab of Roles, and its address forwards there. Groups is
  gone as an entry too: a group is a thing a directory sends, so group
  management is a tab of Directory rather than a sibling of it. Directory
  is the page an identity provider provisions people through, named for
  what it holds rather than for the protocol it speaks. Access is offered
  on every plan, because the rules it holds apply to every organization
  and the card that is enterprise-only carries its own lock.

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
  Scenario: The You section comes first and is about the reader
    Given I open Settings in a new navigation mode
    Then the first group is called "You"
    And it offers Profile and Security, in that order
    And it sits above the organization group

  @integration
  Scenario: The personal pages ask for no organization permission
    Given I hold no permission over my organization
    When the settings sidebar renders in a new navigation mode
    Then Profile and Security are both still offered

  @integration
  Scenario: The access group is named for people and holds the organization's pages
    Given I open Settings in a new navigation mode
    Then the group is called "People & access"
    And it offers Members, Roles, Directory and Access
    And there is no separate Role Bindings entry, since it is a tab of Roles
    And there is no separate Groups entry, since it is a tab of Directory
    And there is no Authentication entry, since Security is the reader's own
    And Access is offered on every plan

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
