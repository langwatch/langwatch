Feature: User-editable default values for connected-agent parameters
  As a user who runs a connected agent
  I want to set default parameter values in the UI and have them persist
  So that I can establish per-agent baselines without restating them on every run

  # A connected agent declares its parameter defaults in code, and those code
  # defaults are replaced wholesale on every SDK reconnect. A user default is a
  # separate layer the owner sets in the drawer: it is stored outside
  # Agent.config, so a re-register cannot clobber it, and it sits between the
  # code default and the scenario default in precedence
  # (code default < user default < scenario default < run value). A stale user
  # default, one whose parameter the code no longer declares, is ignored at
  # runtime and shown as stale in the drawer.
  #
  # @see dev/docs/adr/128-connected-agents.md
  # @see https://github.com/langwatch/langwatch/issues/7948

  Background:
    Given a project with an API key that holds "scenarios:manage"

  @integration
  Scenario: A user sets a default value in the drawer and it applies to new runs
    Given a connected agent is registered with parameters (model: enum, required: false, default: "gpt-4")
    When the user opens the ConnectedAgentDrawer and edits the model default to "gpt-5"
    And saves the change
    Then a new run without an explicit run value gets model="gpt-5" instead of "gpt-4"
    And the drawer shows model="gpt-5" on next open

  @unit
  Scenario: A run value overrides the user default
    Given a user default is set to model="gpt-5"
    When a test dialog or API call supplies run value model="gpt-4"
    Then the run uses model="gpt-4"

  @unit
  Scenario: A scenario default overrides the user default
    Given a user default is set to model="gpt-5"
    And a scenario declares default model="gpt-3.5"
    When a run is executed from that scenario with no run-supplied value
    Then the run uses model="gpt-3.5" (scenario default wins)

  @integration
  Scenario: An SDK reconnect with the same schema preserves user defaults
    Given a user has set model default to "gpt-5"
    When the connected agent process registers again with the same parameter schema
    Then the user default model="gpt-5" is preserved
    And the drawer still shows model="gpt-5"

  @integration
  Scenario: A reconnect with a removed parameter shows the override as stale
    Given a user default is set for a parameter "plan"
    When the connected agent reconnects with a schema that no longer includes "plan"
    Then the drawer marks the "plan" override as stale (visual indicator)
    And runtime ignores the stale value

  @integration
  Scenario: An invalid user-supplied value is rejected at save time
    Given a parameter has options ["free","pro"]
    When a user tries to set default to "invalid"
    Then the drawer rejects the save with a validation error
    And the previous valid value is retained

  @integration
  Scenario: A secret parameter cannot have a user default
    Given a parameter is marked secret: true
    When opening the drawer
    Then the secret parameter has read-only default display (no edit control)

  @integration
  Scenario: An SDK-only agent mutation is still refused
    Given an agent is updated via SDK reconnect
    When an API/SDK client sends a parameter override (payload includes parameterDefaults)
    Then the server returns 422 agent_register_only
    And the override does not land (config updates are SDK-owned)
