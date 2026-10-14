Feature: A self-hosted install's usage report reaches PostHog through nurturing

  saas records each accepted usage report as a usage_report_received fact on its
  saas_usage_report pipeline and holds no analytics channel (CLAUDE.md rule 7).
  Nurturing reacts as a peer subscriber and sends the report's event to PostHog
  against the install id, as saas once sent it. Customer.io is told nothing of it.

  @unit
  Scenario: A received usage report is tracked against the install id
    Given saas recorded a usage report from an install, with one field it had no name for
    When nurturing handles the fact
    Then PostHog tracks the report's event against the install id
    And it carries the report's known fields and the count of unknown ones
    And Customer.io is told nothing

  @unit
  Scenario: A redelivered usage report fact is tracked once
    Given saas recorded a usage report from an install
    When nurturing handles the same fact twice
    Then PostHog tracks the event once, under one uuid for that fact

  @unit
  Scenario: A usage report where no PostHog target is configured sends nothing
    Given the deployment names no PostHog key
    When nurturing handles a usage report fact
    Then nothing is sent and nothing is claimed
