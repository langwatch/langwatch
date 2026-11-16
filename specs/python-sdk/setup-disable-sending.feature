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

  @unit
  Scenario: Re-enabling sending through setup() resumes the provider it created
    Given langwatch.setup created its tracer provider with disable_sending=True
    When I call langwatch.setup again with disable_sending=False
    Then the provider samples spans again, including from tracers handed out before
    And the LangWatch exporter is attached to it

  @unit
  Scenario: setup() inside a disable_sending trace keeps sending disabled after the trace
    Given a trace with disable_sending=True is active
    When I call langwatch.setup with disable_sending=True inside it
    Then sending stays disabled after the trace exits

  @unit
  Scenario: setup() inside a disable_sending trace can re-enable sending after the trace
    Given sending was disabled through langwatch.setup
    And a trace with disable_sending=True is active
    When I call langwatch.setup with disable_sending=False inside it
    Then sending stays disabled until the trace exits
    And sending is enabled after the trace exits
