Feature: Remote-trace judging for http targets
  As a user pointing a scenario at my agent over HTTP
  I want the judge to read the traces my agent reported to the platform
  So that criteria about tool calls, writes and retrievals are verified
  against evidence instead of against claims in the response text.

  Background: the platform configures a capability the SDK owns.
    The scenario SDK owns remote-trace fetching: with it enabled, its judge
    collects the trace ids stamped on the conversation's messages, fetches
    them from the trace API, waits at verdict time until the trace is
    complete (every fetched agent span's parent resolved), and degrades to a
    synthetic error span plus an inconclusive-judging rule when spans stay
    missing at the deadline. The platform's part is configuration only:
    enable the capability for http targets, hand the SDK the run's own
    endpoint and API key, and size the verdict-time wait from the project's
    own ingest lag, measured on the span store the trace API reads: per
    trace, the p95 of how long after its last span ends its span set
    finishes arriving, over the last week.

  @unit
  Scenario: An http target runs with remote trace fetching enabled
    Given a scenario run against an http target
    When the child process assembles the SDK run configuration
    Then remote trace fetching is enabled
    And the trace API endpoint and key of the run's own project travel with the configuration

  @unit
  Scenario: The judge for an http target is the SDK judge with remote fetching enabled
    Given the child process entry point
    When it constructs the agents for a run
    Then every target type gets the standard SDK judge
    And an http target's judge fetches remote traces through the run configuration alone

  @unit
  Scenario: The child process passes the wait budget through
    Given a job carrying a trace wait budget
    When the child process assembles the SDK run configuration
    Then the budget arrives as the SDK's trace wait timeout
    And a job without one leaves the SDK's own default in place

  @unit
  Scenario: Only http targets run with remote fetching
    Given a scenario run against a prompt, code or workflow target
    When the child process assembles the SDK run configuration
    Then remote trace fetching is not enabled

  @integration
  Scenario: The vendored SDK can act on the remote-trace configuration
    Given the pre-compiled child process bundle with the scenario SDK inlined
    When the bundle is inspected for the capability the platform configures
    Then the judge's remote-trace tooling is present in the bundle

  @unit
  Scenario: The prefetcher computes the wait budget only for http targets
    Given a run being prefetched
    When the target is an http agent
    Then the job data carries the project's trace wait budget
    And a prompt, code or workflow target's job data carries none

  @unit
  Scenario: The wait budget grows with the project's measured ingest lag
    Given a project whose recent traces arrive within a measured p95 lag
    When the wait budget is resolved
    Then it is a quarter more than the p95 plus five seconds

  @unit
  Scenario: The wait budget stays within its floor and ceiling
    Given a project whose measured ingest lag is very small or very large
    When the wait budget is resolved
    Then it is never below ten seconds and never above thirty seconds

  @unit
  Scenario: The wait budget rounds up, never down
    Given a project whose measured ingest lag p95 is fractional
    When the wait budget is resolved
    Then it rounds up to whole milliseconds

  @unit
  Scenario: The judge's extra wait uses the platform cap
    Given a scenario run against an http target
    When the child process assembles the SDK run configuration
    Then the wait extension is the thirty second cap, whatever the measured budget
    And the judge can spend it once through its wait_for_traces tool

  @unit
  Scenario: A project with few recent traces gets the default wait budget
    Given a project with fewer than twenty traces in the last week
    When the wait budget is resolved
    Then the default of thirty seconds is used

  @unit
  Scenario: A failed ingest lag measurement never fails the run
    Given the ingest lag measurement errors
    When the wait budget is resolved
    Then the default of thirty seconds is used and a warning is logged

  @unit
  Scenario: A measured wait budget is reused for an hour
    Given a project whose wait budget was just measured
    When another run resolves the budget within the hour
    Then the cached value is returned without a new measurement
    And after the hour the budget is measured again
