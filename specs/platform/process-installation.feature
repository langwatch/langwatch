Feature: Every installed module boots in the process that installs it
  As the team shipping the api and the worker
  I want each process installed exactly as its main installs it, over memory stores
  So that a missing member, a config collision or a module that cannot construct
  refuses by name in a test, not at deploy time

  # The installation runs the seam production boots through (ARCHITECTURE.md §13):
  # the one config parse over a synthetic environment, the secrets preflight,
  # every installed module, and the members each main answers.

  @integration
  Scenario: Every installed module boots in the api role over memory stores
    Given the api's installed modules, config owners and composed members
    When the api process boots over memory stores and a synthetic environment
    Then every module's api resolves through its own token
    And the api produces the trace processing pipeline

  @integration
  Scenario: Every installed module boots in the worker role over memory stores
    Given the worker's installed modules, config owners and composed members
    When the worker process boots over memory stores and a synthetic environment
    Then every module's api resolves through its own token
    And the worker hosts the trace processing pipeline
    And the worker hosts at least one scheduled process

  @integration
  Scenario: The worker hosts identity's four pipelines with their reactions
    Given the worker's installed modules over memory stores
    When the worker process boots
    Then it hosts the identity, join-requests, scim-sync and sso-connections pipelines
    And the connection pipeline reacts to a finished migration by asking scim to move the directory
    And scim's own directory pipeline hosts the move

  @integration
  Scenario: The worker forwards coding-agent spans, logs and metric points to coding-agent
    Given the worker's installed modules over memory stores
    When the worker process boots
    Then the trace pipeline hosts the coding-agent span dispatch
    And the log pipeline hosts the coding-agent log dispatch
    And the metric pipeline hosts the coding-agent metric dispatch

  @integration
  Scenario: The worker routes span recording to the trace pipeline
    Given the worker's installed modules over memory stores and a live event store
    When the worker process boots
    Then the job registry it consumes routes the trace pipeline's recordSpan command

  @integration
  Scenario: The worker hosts the gateway's spend settlement sweeper
    Given the worker's installed modules over memory stores
    When the worker process boots
    Then the gateway spend pipeline hosts the settlement sweeper on its five-minute schedule

  @integration
  Scenario: A SaaS worker registers the billable-events meter
    Given the worker's installed modules over memory stores on a SaaS deployment
    When the worker process boots
    Then the monthly roll-up pipeline declares the billable-events meter as a global projection

  @integration
  Scenario: Two process installations share no state
    Given two api processes booted over memory stores
    When one of them records a prompt tag
    Then the other lists no tags for that organization

  @integration
  Scenario: Every installed module boots in the tasks role over memory stores
    Given the tasks process's installed modules, config owners and composed members
    When the tasks process boots over memory stores and a synthetic environment
    Then it lists every task the installed modules declared
