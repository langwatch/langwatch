# Companion to process-manager-visibility: the lightweight event subscribers
# (TriggerSpec handlers riding GroupQueue) get the registry-times-live-health
# treatment on the same /ops/processes page.

Feature: Event-subscriber visibility in ops
  As an operator during an incident
  I want every registered event subscriber listed with its live queue health
  So that a silently-backlogged or paused subscriber is seen, not inferred

  Context: subscribers appear in the queues page's pipeline tree only while
  they have live jobs, and the tree seeds from a 24-hour registry — a
  subscriber that stopped receiving events simply vanishes, which looks
  identical to healthy. The pipeline registry knows every subscriber that
  exists; joining it to the live tree makes absence visible.

  Background:
    Given an operator is viewing the processes page

  @unit
  Scenario: Every registered subscriber is listed, idle or not
    Given a registered subscriber with no live queue activity
    When the subscriber health is joined
    Then the subscriber still appears with zero counts
    And it is marked as having no live queue presence

  @unit
  Scenario: A subscriber's live backlog joins its registry row
    Given a subscriber with pending and blocked groups in the live tree
    When the subscriber health is joined
    Then its row carries those pending, active, and blocked counts

  @unit
  Scenario: A paused subscriber says so
    Given a subscriber paused directly, and another paused via its pipeline
    When the subscriber health is joined
    Then both rows read as paused

  @unit
  Scenario: Pausing a subscriber targets its queue path
    Given a subscriber row
    When its pause key is derived
    Then it follows the queue's pipeline/subscriber/name path grammar
