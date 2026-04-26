Feature: AI Gateway Governance — My Settings (personal API keys + budget readonly)
  As an enterprise developer using LangWatch-governed AI tools
  I want a personal settings page at "/me/settings" where I can see my profile,
  manage my own personal API keys (one per device), tweak notifications, and
  see — but not change — my budget that the admin set
  So that I can clean up old keys, add new ones for new laptops, and understand
  what is centrally managed vs. what I control myself

  Per gateway.md "screen 7": the page has sections
    - Profile (read-only — name, email "managed by Miro IT", join date)
    - Personal API Keys (list with last-used + revoke; can issue new device key)
    - Notifications (budget threshold alerts, weekly summary, per-request thresholds)
    - Budget (readonly — "set by your Miro admin · cannot edit")

  The principle: anything the admin governs is read-only and clearly marked
  "managed by your company". Anything the user owns is editable.

  Background:
    Given user "jane@miro.com" is signed in to organization "miro"
    And jane has a personal team "Jane's Workspace" and personal project "personal-default"
    And jane has 2 personal VKs: "jane-laptop" (last used 2 min ago) and "jane-desktop" (last used 4d ago)
    And admin "carol@miro.com" set jane's user-scope budget to USD 500/month

  # ---------------------------------------------------------------------------
  # Profile section
  # ---------------------------------------------------------------------------

  @bdd @ui @settings @profile
  Scenario: Profile section is read-only with explicit IT-managed labels
    When I navigate to "/me/settings"
    Then I see a "Profile" section showing:
      | field   | value                                  | editable |
      | Name    | "Jane Doe"                             | no       |
      | Email   | "jane@miro.com (managed by Miro IT)"   | no       |
      | Joined  | "Apr 24, 2026"                         | no       |
    And no field is editable
    And the email field carries an inline tooltip "Your email is provisioned by your company SSO and can only be changed by an admin."

  # ---------------------------------------------------------------------------
  # Personal API Keys
  # ---------------------------------------------------------------------------

  @bdd @ui @settings @personal-keys @list
  Scenario: Personal API Keys list shows my own keys with metadata and revoke action
    When I navigate to "/me/settings"
    Then I see a "Personal API Keys" section
    And the section shows 2 rows: "jane-laptop" and "jane-desktop"
    And each row contains: an icon (laptop/desktop/server), the label, the OS hint, last-used relative time, created date, and a [Revoke] button
    And the secret value is NEVER displayed — only the prefix in the row tooltip if needed

  @bdd @ui @settings @personal-keys @issue
  Scenario: User can issue a new personal API key from the settings page
    When I click "Add a new key"
    Then a small drawer opens asking for a label and an optional provider selector (defaults to "All providers")
    And I enter "jane-new-mac" and click "Create key"
    And a one-time secret is shown in a copy-to-clipboard field with a clear "this is the only time you'll see this" warning
    When I dismiss the drawer
    Then the new key appears in the list with last-used "Never"

  @bdd @ui @settings @personal-keys @revoke
  Scenario: User revokes a personal API key
    When I click "Revoke" on the "jane-desktop" row
    Then a confirmation dialog asks me to confirm — explicitly stating that any tool currently using this key will start failing immediately
    And on confirm, the row disappears from the list within 1 second
    And the gateway's auth-cache entry for that VK is invalidated within 30 seconds (verified in gateway-side spec)

  # ---------------------------------------------------------------------------
  # Notifications
  # ---------------------------------------------------------------------------

  @bdd @ui @settings @notifications
  Scenario: Notifications section exposes 3 toggles
    When I navigate to "/me/settings"
    Then I see a "Notifications" section with three checkboxes:
      | label                                      | default |
      | Alert me when I hit 80% of monthly budget  | on      |
      | Weekly usage summary                       | on      |
      | Each request over $1.00                    | off     |
    And toggling a checkbox persists immediately via the user-preferences tRPC

  # ---------------------------------------------------------------------------
  # Budget (readonly)
  # ---------------------------------------------------------------------------

  @bdd @ui @settings @budget @readonly
  Scenario: Budget section shows the admin-set cap with a clear "managed by company" label
    Given admin "carol@miro.com" set jane's user-scope budget to USD 500/month
    When I navigate to "/me/settings"
    Then I see a "Budget" section showing:
      | field            | value                                          |
      | Monthly limit    | "$500 / month"                                 |
      | Managed by       | "Your Miro admin · cannot edit"                |
      | Current spend    | from the same source as /me's "Spent this mo." |
    And there is no edit affordance

  @bdd @ui @settings @budget @no-budget
  Scenario: Budget section renders an empty state when no admin budget is configured
    Given jane has no user-scope budget
    When I navigate to "/me/settings"
    Then the Budget section shows "No personal budget set by your admin."
    And a quiet hint mentions "If you'd like one, ask your admin."
    And there is no edit affordance

  # ---------------------------------------------------------------------------
  # Authorization
  # ---------------------------------------------------------------------------

  @bdd @ui @settings @authz
  Scenario: /me/settings is only accessible to a signed-in user, scoped to their own data
    Given jane is signed in
    When she navigates to "/me/settings"
    Then she sees her own settings (no URL param leaks another user's data)
    And one user cannot revoke another user's personal VK from this page
