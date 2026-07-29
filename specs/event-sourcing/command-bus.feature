Feature: Cross-pipeline command dispatch keyed on identity

  Pipelines dispatch into each other's commands. Every cross-pipeline coupling
  in the system is that and nothing else — no pipeline needs another
  pipeline's handler, only its write surface.

  The bus makes three promises about that coupling. A pipeline can dispatch
  into work another pipeline owns without the two being brought up in a
  particular order, so no arrangement of the system is quietly the wrong one.
  What it sends is checked against what the receiver accepts, so a mismatched
  request is a build failure rather than something that surfaces in
  production. And if a dispatch could never reach an owner at all, the system
  refuses to start and says which one is missing, instead of accepting the
  work and failing when it is used.

  # Design: ADR-082 §5 (pipelines own their composition), which also records
  # the mechanisms this replaces.

  @unit @command-bus
  Scenario: A port bound before its pipeline registers still dispatches
    Given a pipeline binds a port for a command another pipeline owns
    And the owning pipeline has not registered yet
    When the owning pipeline registers
    And the port is called
    Then the command is enqueued on the owning pipeline's dispatcher

  @unit @command-bus
  Scenario: A pipeline dispatching into its own command needs no late binding
    Given a pipeline binds a port for a command it registers itself
    And the port is bound while the pipeline is still being constructed
    When the pipeline finishes registering
    And the port is called
    Then the command is enqueued on that same pipeline's dispatcher
    And no resolve step was needed after registration

  @unit @command-bus
  Scenario: Each command class resolves to the pipeline that registered it
    Given two pipelines each register a different command class
    When a command is sent through the bus
    Then only the pipeline that registered that class receives it

  @unit @command-bus
  Scenario: Sending a command no pipeline registered names the command
    Given a command class that no registered pipeline owns
    When the command is sent through the bus
    Then the failure names the command and lists what is registered

  @unit @command-bus
  Scenario: Registration completing with an unresolvable port fails at boot
    Given a port was bound for a command class
    And registration finished without any pipeline registering that class
    When the composition root asserts its ports resolve
    Then boot fails naming every port that resolves to nothing

  @unit @command-bus
  Scenario: A disabled runtime drops a bus-dispatched command
    Given event sourcing is disabled
    When a command is sent through the bus
    Then the command is dropped and logged like any other disabled dispatch
    And the send does not fail as unresolvable

  @unit @command-bus
  Scenario: A payload that does not match the command class is a compile error
    Given a command class imported directly into the dispatching file
    When a payload carrying a member the command does not declare is sent
    Then the code does not compile

  @unit @command-bus
  Scenario: A command taking constructor dependencies is dispatchable
    Given a command class registered by instance because it takes constructor dependencies
    When a port is bound for it through the bus
    Then it binds, because the bus constrains on the static surface only
