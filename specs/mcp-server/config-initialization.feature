Feature: The in-app MCP server initializes its config without an error line
  The app mounts the MCP server and initializes its config on boot when no
  config exists yet. Asking whether a config exists must not log or throw, so
  a normal boot prints nothing about the MCP config.

  @unit
  Scenario: Checking for a config before it exists logs nothing
    Given the MCP config has not been initialized
    When the app checks whether a config exists
    Then the answer is no
    And nothing is written to the error log

  @unit
  Scenario: A config counts as present once initialized or scoped
    Given the MCP config was initialized, or a request runs with its own config
    When the app checks whether a config exists
    Then the answer is yes
