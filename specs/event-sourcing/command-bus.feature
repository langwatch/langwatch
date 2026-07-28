Feature: Cross-pipeline command dispatch keyed on identity

  Pipelines dispatch into each other's commands. Every cross-pipeline coupling
  in the system is that and nothing else — no pipeline needs another
  pipeline's handler, only its write surface.

  Until now that coupling was expressed three different ways: a Deferred that
  a composition root resolved after registration, a hand-rolled `let x = null`
  thunk, and an untyped `getPipeline(name).commands.x.send(...)` lookup. All
  three share one defect — the dispatching handler is built outside the
  pipeline that owns it, at a moment when the target pipeline may not exist —
  and the first two make pipeline registration order load-bearing with nothing
  guarding it.

  The command bus keeps the late lookup and drops everything else. The key is
  the imported command class itself, so resolution is object identity: no
  string, no module augmentation, no central registry to keep in sync. The
  import is also the type, so the payload is checked against the command it is
  being sent to.

  Resolution happens when a command is sent, not when a port is bound. That is
  what makes registration order meaningless — and because deferring existence
  to first dispatch would trade a boot error for a production one, the
  composition root asserts after registration that every port bound during it
  resolves.

  # Design: ADR-077 §5 (pipelines own their composition).
  # Supersedes the Deferred / thunk / getPipeline mechanisms for the
  # cross-pipeline case.

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
