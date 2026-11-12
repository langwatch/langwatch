Feature: langwatch.setup() can disable sending traces
  As a developer running the Python SDK in tests or local development
  I want to pass disable_sending to langwatch.setup()
  So that no traces are sent to LangWatch without configuring Client directly

  @unit
  Scenario: setup() with disable_sending=True disables sending on the client
    Given no LangWatch client has been set up
    When I call langwatch.setup with an API key and disable_sending=True
    Then the resulting client has sending disabled

  @unit
  Scenario: setup() without disable_sending keeps sending enabled
    Given no LangWatch client has been set up
    When I call langwatch.setup with only an API key
    Then the resulting client has sending enabled
