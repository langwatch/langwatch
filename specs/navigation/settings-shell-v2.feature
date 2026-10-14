Feature: Settings shell
  As a user
  I want Settings to read as a detour with a clear way back
  So that configuration never feels like another product

  The settings pages render inside the navigation-v2 shell. The top bar shows a static "Settings" title in place of the
  product dropdown (the icon rail marks its Settings tile instead), and
  the organization control stays. The sidebar opens with Quick Search,
  then a back entry that returns to the product the user came from,
  then the settings menu regrouped with icons: YOU, ORGANIZATION,
  PEOPLE & ACCESS, AI INFRASTRUCTURE, DATA CONTROLS, PROJECT, and the internal OPS and
  BACKOFFICE groups with their current gates. A plan without Enterprise
  sees its entries with a quiet lock rather than not at all, and the page
  opens on an upsell; a missing permission still hides an entry. The
  search and back entries sit above the scroll region. No divider separates
  them from the groups: the group labels provide that separation.

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

  PEOPLE & ACCESS holds Directory and Roles. Directory consolidates Members,
  Teams & Projects, Groups and Access as tabs, while Roles holds Role Bindings
  as its second tab. Their old addresses forward to the corresponding tabs.
  Directory is offered on every plan and is named for what it holds rather
  than for the provisioning protocol it speaks. Authentication remains in
  ORGANIZATION because it controls how everyone in the organization signs in;
  how the reader themselves signs in is Security, under You.

  @integration
  Scenario: Settings keeps search first and Back immediately below it
    Given I entered Settings from a Gateway page
    Then Quick Search is the first sidebar entry
    And the next entry goes back to that Gateway page

  @integration
  Scenario: The settings menu is grouped with its gates kept
    Given I open Settings
    Then the sidebar shows the ORGANIZATION and PEOPLE & ACCESS groups
    And General and Directory have their consolidated addresses

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
    And it offers Directory and Roles
    And it has no separate Members, Groups, Access or Role Bindings entry
    And Authentication stays in the Organization group
    And the old page addresses forward to the corresponding consolidated tabs

  @integration
  Scenario: A plan with Enterprise sees its entries marked ENT, not locked
    Given my plan includes Enterprise
    When the settings sidebar renders
    Then the Enterprise entries carry a quiet grey "ENT" chip
    And no entry carries a lock

  @integration
  Scenario: A plan without Enterprise sees its entries locked
    Given my organization's plan has answered and lacks Enterprise
    When the settings sidebar renders
    Then Audit log and Roles are offered with a small lock
    And the lock reads "Included in Enterprise"
    And an entry I lack the permission for stays hidden
    And opening a locked entry shows its page title and an Enterprise upsell, never the feature

  @unit @integration
  Scenario: Authentication is offered unlocked on every plan
    Given I may see single sign-on and my plan lacks Enterprise
    When the settings sidebar renders
    Then Authentication is offered without a lock, whether or not the plan has answered

  @integration
  Scenario: Settings groups read in sentence case
    When the settings sidebar renders
    Then each group label is 12px medium sentence case in a token at 4.5:1 in both modes
    And the open entry reads stronger than a hovered one, by weight and ink

  @integration
  Scenario: A detail page keeps its owning entry lit
    Given I open a team's own page under /settings/teams
    Then the Directory entry is marked as the open one

  @unit
  Scenario: A still-loading plan hides the enterprise entries
    Given my organization's plan has not answered yet
    When the settings menu is built
    Then the enterprise entries are hidden
    And they appear once the plan answers, locked where it lacks Enterprise

  @integration
  Scenario: The settings groups fold, and start open
    Given I open Settings
    Then every settings group is open
    When I press a group heading
    Then that group folds away and the other groups stay as they are
    And my choice is kept for the next time I open Settings

  @integration
  Scenario: Quick Search stays above the menu without a divider
    Given I open Settings
    When the settings menu scrolls
    Then Quick Search and the back entry stay in place
    And no divider separates them from the groups

  @integration
  Scenario: API keys sits under General
    Given I open Settings
    Then API keys comes right after General in the Organization group
    And the People & access group does not hold it

  @integration
  Scenario: The menu marks the page that is open
    Given I open the Email Suppressions settings page
    Then the Email Suppressions entry is marked as the open one
    And no other entry is marked

  @integration
  Scenario: A lite member sees no restricted settings entries
    Given I am a lite member
    When the settings sidebar renders
    Then there is no API Keys entry and no Secrets entry

  @integration
  Scenario: The top bar keeps a static Settings label
    Given I open Settings in the product-switcher mode
    Then the top bar shows "Settings" with no product dropdown
    And the organization control stays in the top bar
