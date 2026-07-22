Feature: Account menu hub (settings, support, theme in one place)
  As a LangWatch user
  I want everything about me and my session — workspace, keys, settings,
  support, appearance, sign out — behind the avatar in the top-right
  So that the sidebar stays focused on product navigation

  The sidebar's bottom cluster (Settings link, Chat, Support menu, theme
  toggle) moves into the avatar menu. The sidebar keeps only the plan/usage
  indicator at the bottom.

  Background:
    Given a signed-in user

  @bdd @ui @account-menu
  Scenario: The avatar menu identifies the account
    When the user opens the avatar menu
    Then the top of the menu shows the user's name and email

  @bdd @ui @account-menu
  Scenario: Account destinations are grouped first
    When the user opens the avatar menu
    Then it lists "My Workspace" (when personal workspaces are available),
        "API Keys" (hidden for lite members), and "Settings"

  @bdd @ui @account-menu @support
  Scenario: Support lives in the avatar menu
    When the user opens the avatar menu and hovers "Support"
    Then a submenu offers Documentation, GitHub Support, Discord,
        Status Page, Feature Request, and Report a Bug

  @bdd @ui @account-menu @chat
  Scenario: Chat is offered on the hosted product only
    Given the deployment is the hosted SaaS
    When the user opens the avatar menu
    Then a "Chat with us" entry opens the live chat
    But on self-hosted deployments no chat entry renders

  @bdd @ui @account-menu @theme
  Scenario: Theme is switched from the avatar menu
    When the user opens the avatar menu
    Then a theme row offers Light, System, and Dark
    And picking one applies immediately without closing losing the user's place
    And the selected option is visually indicated

  @bdd @ui @account-menu @signout
  Scenario: Log out is the last entry
    When the user opens the avatar menu
    Then "Log out" is the final entry, separated from the rest

  @bdd @ui @sidebar
  Scenario: The sidebar bottom keeps only usage
    When the user looks at the bottom of the sidebar
    Then only the plan/usage indicator renders there
    And Settings, Chat, Support, and the theme toggle are no longer in the sidebar
