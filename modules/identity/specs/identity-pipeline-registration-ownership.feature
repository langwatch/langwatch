Feature: Identity's four pipelines are declared, and connected by the process

  Identity publishes four pipelines - identity, join-requests, sso-connections
  and scim-sync - each declared once with `.withEventing(...)` (ARCHITECTURE.md
  §9). The process builds, registers and connects them: the api the producer
  definitions, the worker the full graph with its folds and reactions. Identity
  itself registers nothing; its commands reach the senders the process hands
  over as it connects each pipeline.

  @unit
  Scenario: A command asked for before its pipeline is connected is not commandable
    Given no identity pipeline has been connected yet
    When a caller asks for one of identity's verbs
    Then the answer is that the command is not commandable on this process

  @unit
  Scenario: A connected pipeline missing one of identity's verbs fails the install by name
    Given the process connects the join-requests pipeline without its requestJoin sender
    When identity takes the connection
    Then the install is refused naming the pipeline and the missing verb

  @unit
  Scenario: Identity's commands reach the pipeline the process connected
    Given the process connected the identity pipeline
    When a caller stages one of identity's verbs
    Then the command is sent through that pipeline's own sender

  @unit
  Scenario: A verb the module does not publish stays uncommandable
    Given the process connected the identity pipeline
    When a caller asks for a command outside identity's verb lists
    Then the answer is that the command is not commandable on this process
