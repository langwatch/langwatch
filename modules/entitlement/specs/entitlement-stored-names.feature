# WHY THIS EXISTS
#
# Ruled 2026-10-06 (Alex, "night" Q1 and "night, fourth"): usage merged into
# entitlement, so its stored names become entitlement's. The pipeline declares
# each former name with `.withUpcasts`, so stored rows and jobs a previous
# release queued still read, without rewriting a row. Projection tables and the
# frozen meter lane names keep theirs.

@event-sourcing
Feature: Entitlement's stored names for the usage facts
  As the module that now owns usage counting
  I want usage's facts, pipeline and aggregate recorded under entitlement's names
  So that the stored names say who owns them while every stored fact still reads

  @unit @usage
  Scenario: Usage's facts are recorded under entitlement's stored names
    When the metering pipeline is built
    Then it is named "entitlement" on the aggregate "entitlement_organization"
    And it records "lw.entitlement.month_counted", "lw.entitlement.limit_reached" and "lw.entitlement.limit_cleared"
    And its commands are "lw.entitlement.count_month" and "lw.entitlement.record_limit_decision"

  @unit @usage
  Scenario: Each fact stored under its usage name reads as its entitlement fact
    Given a "lw.usage.month_counted", a "lw.usage.limit_reached" and a "lw.usage.limit_cleared" fact stored on aggregate "usage_organization"
    When the metering pipeline reads each one
    Then each reads as its "lw.entitlement.*" type on aggregate "entitlement_organization" with the same data

  @unit @usage
  Scenario: A count the previous release queued under the usage pipeline is still counted
    Given a countMonth job queued by the previous release under "usage:command:countMonth"
    When a worker of the new release dequeues it
    Then entitlement's countMonth lane counts the month
    And it records "lw.entitlement.month_counted"

  @unit @billing
  Scenario: A peer subscriber on month_counted handles a fact queued under its usage name
    Given a peer subscriber on entitlement's month_counted fact, as billing declares one
    And a job queued by the previous release carrying "lw.usage.month_counted"
    When a worker of the new release dequeues it
    Then the subscriber handles it once, with the counted data

  @unit @usage
  Scenario: Each usage name is listed for ops as an upcast of the entitlement pipeline
    When ops lists the metering pipeline's upcasts
    Then it lists "upcast:entitlement:lw.usage.month_counted", "upcast:entitlement:lw.usage.limit_reached" and "upcast:entitlement:lw.usage.limit_cleared"
    And each drains jobs queued under the former pipeline "usage"
