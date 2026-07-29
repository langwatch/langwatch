Feature: PostHog product milestones
  As a LangWatch operator
  I want signup and first-integration milestones captured in PostHog with a stable identity and a narrow property set
  So that the activation funnel is measurable without leaking anything about the user into an analytics vendor

  Background:
    Given the langwatch app captures server-side product events through trackServerEvent
    And posthog-js identifies a browser person by the user id
    And trackServerEvent uses that same user id as the distinct_id so both sides join

  # ---------------------------------------------------------------------------
  # signed_up — the two user-creation choke points
  #
  # BetterAuth creates users through its adapter, which runs the
  # databaseHooks.user.create.after hook. The tRPC register route (email mode)
  # inserts with Prisma directly and never reaches that adapter, so each path
  # owns the event for the users it creates and neither can double-count.
  #
  # The Customer.io nurturing integration tracks its own separately named
  # signed_up event; these scenarios are about the PostHog one.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: BetterAuth signup tracks the PostHog signed_up milestone
    Given a new user is created through BetterAuth
    When the after-user-create hook runs
    Then exactly one "signed_up" PostHog event is tracked for that user id
    And the event carries no properties

  @unit
  Scenario: PostHog signed_up still fires when the SSO auto-add path runs
    Given a new user whose email domain matches an organization with an ssoDomain
    When the after-user-create hook runs
    Then exactly one "signed_up" PostHog event is tracked for that user id

  @unit
  Scenario: PostHog signed_up still fires when the email has no parsable domain
    Given a new user whose email has no parsable domain
    When the after-user-create hook runs
    Then a "signed_up" PostHog event is tracked for that user id

  @unit
  Scenario: Email-mode registration tracks the PostHog signed_up milestone exactly once
    Given the auth provider is email
    When a registration succeeds through the register route
    Then exactly one "signed_up" PostHog event is tracked for the created user id

  @unit
  Scenario: A rejected registration tracks no PostHog signed_up milestone
    Given the auth provider is email
    And a user already exists with that email
    When the registration is attempted
    Then no "signed_up" PostHog event is tracked

  # ---------------------------------------------------------------------------
  # Coding-agent onboarding screen instrumentation
  #
  # The screen renders install commands and an MCP config that EMBED the
  # project API key, so the privacy property is not incidental: the payloads
  # must stay fixed identifiers and never carry the copied string itself.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Copying a prompt reports the skill it came from
    Given the coding-agent onboarding screen is on the prompt tab
    When the user copies a skill prompt
    Then a "copied" analytics event is emitted for object "prompt"
    And its properties are exactly the skill id

  @unit
  Scenario: Copying a slash command reports the skill it came from
    Given the coding-agent onboarding screen is on the skill tab
    When the user copies a skill slash command
    Then a "copied" analytics event is emitted for object "slash_command"
    And its properties are exactly the skill id

  @unit
  Scenario: Copying a skill install command reports the skill it came from
    Given the coding-agent onboarding screen is on the skill tab
    When the user copies a skill install command
    Then a "copied" analytics event is emitted for object "install_command"
    And its properties are exactly the skill id

  @unit
  Scenario: Copying an agent quick command reports the agent it configures
    Given the coding-agent onboarding screen is on the MCP tab
    When the user copies the quick command for an agent
    Then a "copied" analytics event is emitted for object "install_command"
    And its properties are exactly that agent's stable id

  @unit
  Scenario: Copying the MCP config reports no further detail
    Given the coding-agent onboarding screen is on the MCP tab
    When the user copies the MCP config
    Then a "copied" analytics event is emitted for object "mcp_config"
    And the event carries no properties

  @unit
  Scenario: Copying an editor config path reports the editor
    Given the coding-agent onboarding screen is on the MCP tab
    When the user copies an editor's config path
    Then a "copied" analytics event is emitted for object "config_path"
    And its properties are exactly that editor's name

  @unit
  Scenario: Switching tabs reports the tab selected
    Given the coding-agent onboarding screen is rendered
    When the user switches to another tab
    Then a "selected" analytics event is emitted for object "tab"
    And its properties are exactly the tab key

  @unit
  Scenario: A failed copy emits no analytics event
    Given the coding-agent onboarding screen is rendered
    And the clipboard write fails
    When the user attempts to copy
    Then no analytics event is emitted

  @unit
  Scenario: No onboarding analytics payload carries the project API key
    Given the coding-agent onboarding screen is rendered with a project API key
    And the install commands and MCP config embed that API key
    When the user copies every copyable element on every tab
    Then no emitted analytics payload contains the API key
    And no emitted analytics payload contains the copied text
