# Design: dev/docs/adr/107-the-pipeline.md, dev/docs/adr/108-the-dispatch-plane.md
@unit
Feature: The registry indexes every pipeline once, and is the whole introspection surface
  A pipeline registers exactly once, and everything the dispatch plane or an
  ops page ever needs to ask — which pipeline owns a command, which folds or
  maps or subscribers or process managers react to an event, whether the
  whole graph actually resolves — is answered from that one index. There is
  no separate router and no separate introspection module (ADR-108 decision
  1): the registry answers those questions or nothing does.

  Two failures are caught the moment a pipeline registers, because they are
  decidable then and corrupt silently later: a command name two pipelines
  both claim would dispatch to whichever registered last, and a persisted
  event type string two pipelines both derive would let one pipeline's fold
  read back another's history. A third is caught only once every pipeline has
  registered, because it cannot be decided any earlier: a command a bound
  port expects to call, that nothing ever claims.

  Background:
    Given a fresh registry

  Rule: A registered pipeline cannot silently collide with another

    Scenario: two pipelines declaring the same command name is refused, naming both
      Given a pipeline that registers, declaring a command named "recordSpan"
      When a second pipeline registers, also declaring a command named "recordSpan"
      Then registration is refused
      And the refusal names both pipelines and the command

    Scenario: two pipelines deriving the same event type string is refused, naming both
      Given a pipeline that registers, declaring a persisted event type
      When a second pipeline registers, independently built with the same name and event key
      Then registration is refused
      And the refusal names both pipelines and the colliding type

  Rule: An unresolvable command port fails the whole boot, not the call that needed it

    Scenario: a command port bound for a name no registered pipeline owns fails at boot, naming it
      Given a port is bound for a command name
      And every pipeline has finished registering without any of them owning that name
      When the registry is asked whether everything it was asked for resolves
      Then it refuses, naming the unresolved command

    Scenario: a command port bound before its owning pipeline registers still resolves once registration completes
      Given a port is bound for a command name before the pipeline that owns it has registered
      When that pipeline registers
      Then the registry reports everything it was asked for resolves

  Rule: The aggregate id map is exhaustive, and only the engine applies it

    Scenario: dispatching an event with no declared id extractor is refused, naming the event type
      Given a built pipeline with no id extractor declared for one of its events
      When that event's aggregate id is resolved
      Then it is refused, naming the event type with no extractor

    Scenario: every declared event resolves its id through the extractor declared for its own key
      Given a built pipeline whose id map declares one extractor per event
      When each declared event's aggregate id is resolved
      Then the extractor declared for that event's own key is the one that ran

  Rule: Consumption is gated; registration and dispatch are not

    Scenario: starting with consumption disabled starts no consumer, and the command surface still dispatches
      Given a service constructed with an injected consumer
      When the service starts with consumption disabled
      Then the injected consumer is never started
      And a command sent through the service still dispatches

    Scenario: starting with consumption enabled starts the injected consumer
      Given a service constructed with an injected consumer
      When the service starts with consumption enabled
      Then the injected consumer is started

    Scenario: stopping a service twice is a no-op
      Given a service that has started with consumption enabled and been stopped once
      When the service is stopped a second time
      Then the injected consumer is not stopped a second time

  Rule: The type-string ratchet is driven from the registry, not from one module per pipeline

    Scenario: a type string the registry no longer produces is reported as missing
      Given a snapshot produced from a registry with a pipeline registered
      When the same comparison runs against a registry that never registered that pipeline
      Then the ratchet reports every one of that pipeline's type strings as missing

    Scenario: a type string newly added to the registry is never reported
      Given a snapshot produced from a registry with a pipeline registered
      When the comparison runs again against a registry where that pipeline additionally declares one further event
      Then the ratchet reports nothing
