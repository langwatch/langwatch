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
  Scenario: Two process installations share no state
    Given two api processes booted over memory stores
    When one of them records a prompt tag
    Then the other lists no tags for that organization

  @integration
  Scenario: Every installed module boots in the tasks role over memory stores
    Given the tasks process's installed modules, config owners and composed members
    When the tasks process boots over memory stores and a synthetic environment
    Then it lists every task the installed modules declared
