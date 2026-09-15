# WHY THIS EXISTS
#
# A process that sends commands and never claims `event-sourcing/jobs` reads
# and writes no event log: the handlers, the appends and the folds all run in
# the process that consumes. The runtime still asks for an event store, and
# refuses to build a real pipeline without one — a registration with no store
# hands back a DisabledPipeline whose commands are silently DROPPED, which is
# the worst available answer for a durable write path.
#
# So a producer has to put something in that seat, and what it puts there is a
# safety decision rather than a formality. A memory store would ACCEPT the
# append, hold the event in one process's heap and lose it. This store refuses
# instead, by name, so the producer-only property is structural: it holds
# because the type in the seat cannot do anything else, not because a
# composition root remembered to keep it true.

@event-sourcing
Feature: A producer-only process has no event log
  As a LangWatch process that only dispatches commands
  I want the seat where a durable event store would go to refuse every
  operation rather than pretend to serve one
  So that a producer that grows a consumer fails on its first append instead
  of writing events nowhere

  Rule: The store refuses every read and every write

    @unit
    Scenario: An append is refused rather than accepted and lost
      Given a producer-only event store composed for a named process
      When something in that process tries to append events
      Then the append is refused
      And the refusal names the process and the operation it refused

    @unit
    Scenario: Every read is refused on the same terms
      Given a producer-only event store composed for a named process
      When something in that process tries to read the event log by any of its
      read operations
      Then each read is refused
      And each refusal names the operation it refused

  Rule: A pipeline registered over it still dispatches

    @unit
    Scenario: Commands still reach the shared queue
      Given a runtime whose event store is the producer-only one
      When a pipeline is registered and one of its commands is sent
      Then the command is enqueued for the process that consumes the queue
      And the event store is never consulted
      # This is the whole point of the seat: registration has to succeed, or
      # the runtime substitutes a pipeline that drops commands silently.

  # WHY THIS RULE EXISTS
  #
  # The seat above is only half the story. A pipeline that declares a process
  # manager also needs a durable ProcessStore, and the runtime refused to
  # register one without it — correctly for a consumer, and catastrophically for
  # a producer, because ONE declaration in a definition made EVERY command on
  # that pipeline unsendable from the tier a customer's action arrives at. The
  # API answered `service_unavailable` for all eight simulation commands and all
  # sixteen Langy turn commands on the strength of a process manager it was
  # never going to run. Producing and running are separate jobs, so they are now
  # separate decisions.

  Rule: A producer registers a process-manager pipeline and declines the manager

    @unit
    Scenario: A pipeline declaring a process manager still registers
      Given a runtime that registers pipelines producer-only
      When a pipeline that declares a process manager is registered without a
      durable process store
      Then the pipeline registers whole, with its command dispatchers
      And the runtime names the process manager it will not run

    @unit
    Scenario: A command on a process-manager pipeline appends and returns
      Given a runtime that registers pipelines producer-only
      When one of that pipeline's commands is dispatched
      Then the command's events are appended and the dispatch returns

    @unit
    Scenario: The process manager is refused rather than half-run
      Given a runtime that registers pipelines producer-only
      When something asks that runtime for its process runtime
      Then the request is refused by name
      And no process instance is persisted for the declared manager, even where
      a process store was supplied

    @unit
    Scenario: The consumer's requirement is unchanged
      Given a runtime that runs the process managers it registers
      When a pipeline that declares a process manager is registered without a
      durable process store
      Then the registration is refused
