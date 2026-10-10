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

  @unit
  Scenario: Identity appends to its own aggregates through each pipeline's own event store
    Given the process builds identity's pipelines over their own event stores
    When a join-request command states a fact
    Then the fact is appended through the join-request pipeline's store in the organization's tenant
    And a pipeline built only to be listed hands its store to nobody

  @unit
  Scenario: A ledger whose pipeline this process never built refuses by name
    Given this process never built identity's join-request pipeline
    When a join-request command commits
    Then it is refused naming the pipeline, and no command is staged

  @unit
  Scenario: A person's identity history is readable from a process that only sends commands
    Given a process whose event store refuses every read, as the API's does
    And a person whose identity log holds an attached identifier and an MFA enrollment
    When that person's identity history and link proposals are read
    Then they are answered through the event read seat, in the person's own tenant, MFA facts included
    And the same read through the identity pipeline's own event store is refused by name

  @unit
  Scenario: An SSO connection command commits on a process that only produces commands
    Given the api process, which sends commands and holds no event log
    When an SSO connection command states a fact, such as registering a connection
    Then the command is staged for the worker, which appends and folds it
    And the caller gets the command's facts without the api appending anything
