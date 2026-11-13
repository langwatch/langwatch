Feature: Judge trace wait settings
  As a user whose agent reports its spans to LangWatch
  I want the judge to wait long enough for every span of a turn to arrive
  So that a criterion about a tool call is never judged on a half-arrived trace

  Background:
    The OpenTelemetry BatchSpanProcessor flushes every five seconds in the
    JavaScript, Python, Go and Java SDKs, the LangWatch SDKs included, and
    ingestion plus network adds about two seconds. A trace whose spans hang
    straight off the scenario span has every parent resolved after the first
    flush, so only the quiet period keeps the judge from reading it before the
    next flush lands. The quiet period therefore defaults to seven seconds.

    Two settings decide the verdict-time wait: the quiet period (how long the
    span set must hold still) and the trace wait (the first wait budget; the
    judge may still ask once for the thirty second extension). Each resolves
    in this order: the run plan's setting, the scenario's setting, then the
    project's recommendation. Bounds: the quiet period is 0 to 60 seconds
    (0 turns the quiet check off, above a minute the verdict stalls longer
    than any exporter's flush); the trace wait is 1 to 300 seconds (five
    minutes keeps a run well inside the scenario run cap).

  @unit
  Scenario: The quiet period defaults to seven seconds
    Given a project with no span arrival history
    When the project's trace settle settings are resolved
    Then the quiet period is seven seconds
    And the trace wait is thirty seconds and the extension thirty seconds

  @unit
  Scenario: A project whose spans arrive closer together keeps the default quiet period
    Given a project whose p95 gap between span arrivals within a trace is four seconds
    When the project's trace settle settings are resolved
    Then the quiet period is seven seconds

  @unit
  Scenario: A project whose spans arrive further apart gets a longer quiet period
    Given a project whose p95 gap between span arrivals within a trace is twelve seconds
    When the project's trace settle settings are resolved
    Then the quiet period is twelve seconds

  @unit
  Scenario: The measured span arrival gap stays within its floor and ceiling
    Given a project whose measured span arrival gap is very small or very large
    When the project's trace settle settings are resolved
    Then the measured gap counts as no less than three seconds and no more than thirty seconds
    And the quiet period is never below seven seconds

  @unit
  Scenario: The child process passes the default quiet period when the job names none
    Given a job for an http target carrying no quiet period
    When the child process assembles the SDK run configuration
    Then the trace quiet period is seven seconds

  @unit
  Scenario: The child process passes the job's quiet period and trace wait through
    Given a job for an http target carrying a quiet period and a trace wait
    When the child process assembles the SDK run configuration
    Then they arrive as the SDK's trace quiet period and trace wait timeout
    And the wait extension stays the thirty second cap

  @unit
  Scenario: A run plan's trace wait settings win over the scenario's
    Given a scenario with a quiet period of ten seconds
    And a run plan with a quiet period of twenty seconds
    When a run of the plan is prefetched
    Then the job carries a quiet period of twenty seconds

  @unit
  Scenario: A scenario's trace wait settings win over the project's recommendation
    Given a scenario with a trace wait of ninety seconds
    And a project whose recommended trace wait is thirty seconds
    When a run of the scenario is prefetched
    Then the job carries a trace wait of ninety seconds

  @unit
  Scenario: Unset trace wait settings fall back to the project's recommendation
    Given a scenario and run plan with no trace wait settings
    When a run against an http target is prefetched
    Then the job carries the project's recommended quiet period and trace wait

  @unit
  Scenario: Trace wait settings outside their bounds are refused
    When a scenario or run plan is saved with a quiet period above sixty seconds
    And a trace wait below one second or above three hundred seconds
    Then the save is refused as a validation error

  @integration
  Scenario: Trace wait settings are persisted on the scenario and the run plan
    Given a scenario and a run plan saved with a quiet period and a trace wait
    When they are read back
    Then both settings read back as saved
    And clearing a setting reads back as unset

  @unit
  Scenario: A run plan's trace wait settings travel with each run it queues
    Given a run plan with a quiet period and a trace wait
    When the plan queues its runs
    Then every queued run records both settings in its reserved metadata
    And the execution reads them back as the plan's settings

  @integration
  Scenario: The run plans REST API takes and answers the judge trace wait settings
    Given a run plan configuration with a quiet period and a trace wait
    When it is run through the run plans REST API, or a test suite is run with them
    Then every queued run carries both settings
    And reading the plan back answers them, or null when the plan has none

  @integration
  Scenario: The run plans REST API refuses judge trace wait settings outside their bounds
    When a run plan configuration is run with a quiet period above sixty seconds
    And a trace wait below one second
    Then it answers 422 validation_error naming each field
    And nothing is scheduled

  @integration
  Scenario: The run history offers back the judge trace wait settings a plan ran with
    Given a run plan that ran once with a quiet period and a trace wait and once without
    When the previous configurations of its scope are read
    Then they are two configurations
    And the newer one carries both settings, the older one carries neither

  @integration
  Scenario: Choosing a previous configuration restores its judge trace wait settings
    Given the run dialog offers a previous configuration that ran with a quiet period and a trace wait
    When the person chooses it
    Then the dropdown row names both settings
    And the judge settings open with both inputs filled in seconds
    And the run starts with both settings
    And choosing a configuration that set neither clears them

  @unit
  Scenario: The SDK asks the project's recommended settle settings
    Given a project API key with trace read access
    When it calls GET /api/traces/settle-settings
    Then the answer carries waitTimeoutMs, waitExtensionMs and quietPeriodMs
    And a project with no history answers 30000, 30000 and 7000

  @unit
  Scenario: The settle settings route refuses a request without a valid key
    When GET /api/traces/settle-settings is called without a valid API key
    Then it answers 401

  @integration
  Scenario: The judge settings show the trace wait inputs in seconds
    Given the scenario editor and the run plan form
    When the advanced judge settings are opened
    Then a quiet period and a max trace wait input show, in seconds
    And an empty input shows the default as its placeholder
