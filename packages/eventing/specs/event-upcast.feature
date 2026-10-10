# WHY THIS EXISTS
#
# Ruled 2026-10-06 (Alex, "night, fourth", .claude/coordinator/rulings-2026-10-05.md):
# a renamed or reshaped event type is read through a framework upcaster, so
# `lw.usage.*` reads as `lw.entitlement.*` without rewriting stored rows. The
# owning pipeline declares the upcast beside its events; every read of a stored
# event applies it, queue jobs under a former pipeline's keys drain into the new
# lanes for a rolling deploy, the migrations ledger lists each upcast as a step,
# ops reads how many stored events each still covers, and an optional rewrite
# step makes the upcast unnecessary so it can be retired.

@event-sourcing
Feature: Event upcasting
  As a module that renames or reshapes one of its stored event types
  I want the framework to read the stored type as the current one everywhere
  So that my consumers see only the current type and no stored row must change first

  Background:
    Given a fixture pipeline "entitlement" on aggregate "entitlement_organization"
    And it declares "lw.entitlement.month_counted" with `.withEvents`
    And it declares with `.withUpcasts` that "lw.usage.month_counted" on aggregate "usage_organization" reads as "lw.entitlement.month_counted"

  @unit
  Scenario: A queued job carrying the stored type is dispatched as the current type
    Given a queued job carries a "lw.usage.month_counted" event
    When the worker dispatches it
    Then the subscriber declared for "lw.entitlement.month_counted" receives it
    And the event it receives has type "lw.entitlement.month_counted" on aggregate "entitlement_organization"

  @unit
  Scenario: An event-store read of the aggregate answers the current type
    Given the event log holds "lw.usage.month_counted" events of aggregate "usage_organization"
    And it holds "lw.entitlement.month_counted" events of the same aggregate id
    When the pipeline reads the aggregate's history, as a projection rebuild does
    Then every event is answered as "lw.entitlement.month_counted", in log order
    And an event stored under both types is answered once

  @unit
  Scenario: A projection replay discovers and reads stored events as the current type
    Given the replay source holds "lw.usage.month_counted" events
    When a replay of a projection over "lw.entitlement.month_counted" discovers and streams its aggregates
    Then discovery finds the aggregates holding the stored type
    And every streamed event has type "lw.entitlement.month_counted"

  @unit
  Scenario: A projection replay of a renamed aggregate finds its cutoffs under the current aggregate type
    Given the replay source holds "lw.usage.month_counted" events of aggregate "usage_organization"
    And it holds "lw.entitlement.month_counted" events of aggregate "entitlement_organization"
    When a replay asks for the cutoffs of aggregate "entitlement_organization"
    Then an aggregate holding only stored events has a cutoff under "entitlement_organization"
    And an aggregate holding both keeps the later of its two cutoffs

  @unit
  Scenario: A payload transform reshapes the stored data before the current schema parses it
    Given the upcast declares a pure transform of the stored payload
    When a stored event is read
    Then the current schema parses the transformed payload

  @unit
  Scenario: A transform that throws refuses the event by name and is not retried
    Given the upcast's transform throws for a stored event
    When a queued job carries that event
    Then the job is refused as an invalid queued payload naming the upcast

  @unit
  Scenario: An upcast to an undeclared type is refused when the pipeline is built
    When a pipeline declares an upcast to a type its `.withEvents` does not declare
    Then building the pipeline refuses, naming the type

  @unit
  Scenario: An upcast from a type the pipeline still declares is refused when the pipeline is built
    When a pipeline declares an upcast from one of its current types
    Then building the pipeline refuses, naming the type

  @unit
  Scenario: A stored type no upcast names is retried as undeclared
    Given a queued job carries an event type neither declared nor upcast
    When the worker dispatches it
    Then the job fails retryably, naming the type, so a worker that declares it can take it

  @unit
  Scenario: Jobs queued under the former pipeline's keys drain into the current lanes
    Given the upcast declaration drains from the former pipeline "usage"
    And a job was queued by the previous release under "usage:subscriber:<name>"
    When a worker of the new release dequeues it
    Then the current lane of the same name processes it as the current type
    And no job is rejected as unroutable

  @unit
  Scenario: Ops reads each active upcast and the stored events it covers
    Given the event log holds 3 "lw.usage.month_counted" events
    When ops reads the active upcasts
    Then it reads one upcast from "lw.usage.month_counted" to "lw.entitlement.month_counted" on pipeline "entitlement"
    And it covers 3 stored events

  @unit
  Scenario: Each declared upcast is a step in the migrations ledger
    When the active upcasts are recorded in the ledger
    Then the ledger holds a step "upcast:entitlement:lw.usage.month_counted" of kind "event-upcast", mode "background"
    And the step is "pending" while it covers stored events, "done" once it covers none

  @unimplemented
  Scenario: The rewrite step rewrites stored rows so the upcast can be retired
    Given the event log holds "lw.usage.month_counted" events
    When the rewrite step runs
    Then every stored row is written as "lw.entitlement.month_counted"
    And the upcast covers no stored events

  @unimplemented
  Scenario: The rewrite step resumes from its checkpoint and is idempotent
    Given the rewrite step stopped after its first batch
    When it runs again
    Then it continues after the checkpointed position
    And a second full run rewrites nothing

  @unimplemented
  Scenario: The rewrite step runs automatically on cloud and by version floor on self-hosted
    Given the upcast was declared in a release above the installation's LTS floor
    When the worker considers the rewrite step on a self-hosted installation
    Then the step is "gated" until the floor reaches that release
    And on cloud it runs once the release has rolled out
