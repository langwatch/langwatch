# WHY THIS EXISTS
#
# A module whose service appends its own facts (identity's SSO connection and
# join-request ledgers) or reads its own aggregate's history (identity's
# connection history, scim's sync activity) held the whole EventSourcing
# runtime as a member to do it: `getEventStore()` answers a store over every
# aggregate in the process, and `getPipeline(name)` reaches any pipeline.
#
# Ruled 2026-10-05 (Alex, "Own event store"): eventing hands each module its own
# append-only event store for its own streams, so no module needs the shared
# runtime as a member. The store is handed to the pipeline's eventing
# declaration beside `priorEvents`, bound to the aggregate its definition
# declares, and it can append to or read that aggregate and nothing else.

@event-sourcing
Feature: A pipeline's own event store
  As a module whose pipeline appends to and reads its own aggregate's streams
  I want eventing to hand me a store for those streams alone
  So that I never hold the shared event-sourcing runtime, and cannot append to
  an aggregate I do not own

  Rule: A pipeline appends to and reads only its own aggregate

    @unit
    Scenario: A pipeline appends events to its own aggregate and reads them back
      Given a pipeline's own event store, bound to the aggregate its definition declares
      When it appends two events for one of its aggregates
      Then reading that aggregate answers both events, oldest first

    @unit
    Scenario: A read answers only the events the reader accepts
      Given a pipeline's own aggregate holding events of two types
      When it reads that aggregate accepting one type
      Then only the events of that type are answered

    @unit
    Scenario: A read never answers another aggregate type's stream
      Given another aggregate type holds events under the same tenant and aggregate id
      When the pipeline reads its own aggregate
      Then none of the other aggregate type's events are answered

    @unit
    Scenario: An append of another aggregate type's event is refused
      Given a pipeline's own event store
      When it appends an event of an aggregate type its definition does not declare
      Then the append is refused, naming the pipeline and the refused aggregate type
      And nothing is written to the event log

  Rule: The store refuses by name rather than pretending

    @unit
    Scenario: A store used before its pipeline is built refuses by name
      Given a pipeline's own event store whose definition has not been built
      When it appends or reads
      Then each is refused, naming the pipeline and the operation

    @unit
    Scenario: A store in a process holding no event log refuses by name
      Given a pipeline's own event store in a process whose eventing opened no event log
      When it appends or reads
      Then each is refused, naming the pipeline and the operation

    @unit
    Scenario: A producer-only process keeps the producer's refusal
      Given a pipeline's own event store over a producer-only process's event log
      When it appends or reads
      Then each is refused, naming the process and the operation
      # Unchanged from the shared runtime's store: the api produces and holds no event log.

  Rule: The store reaches the runtime's own log

    @unit
    Scenario: An append lands in the event log its runtime folds from
      Given a runtime with an event store and a pipeline registered on it
      When the pipeline's own event store appends events for one of its aggregates
      Then the runtime's event store holds those events under the pipeline's aggregate type
