Feature: Entitlement owns all counting
  As the owner of every organization's plan and monthly count
  I want counting, enforcement and the approaching-limit decision to live in one module
  So that limits are enforced in production and one Api, entitlement's, answers plans and usage

  See dev/docs/ARCHITECTURE.md §3 (entitlement owns all counting) and §11 (entitlement decides,
  billing only sends).
  Behaviour is main's: the same allowance, thresholds, counts and warning cadence.

  @unit @usage
  Scenario: Ingest past the monthly allowance is refused with the plan limit
    Given an organization whose month's count has reached its plan's allowance
    When a trace arrives at OTLP ingest for one of its projects
    Then the ingest is refused with ERR_PLAN_LIMIT and status 402
    And the refusal carries the count, the allowance and the plan name

  @unit @usage
  Scenario: A scenario event past the monthly allowance is refused with the plan limit
    Given an organization whose month's count has reached its plan's allowance
    When a scenario event is posted for one of its projects
    Then the event is refused with ERR_PLAN_LIMIT and status 402

  @unit @usage
  Scenario: Work within the monthly allowance is let through
    Given an organization whose month's count is below its plan's allowance
    When a caller checks the organization's usage limit
    Then the check resolves without refusing

  @unit @usage @unimplemented
  Scenario: A count the store cannot answer lets traffic through, loudly
    Given an organization whose month's count cannot be read
    When a caller checks the organization's usage limit
    Then the check resolves without refusing
    And a warning is logged naming the organization and its plan

  @unit @usage
  Scenario: Entitlement counts billable events from every pipeline itself
    Given spans, evaluations, experiment results and simulation messages recorded for a project this month
    When the month's count is read for the project's organization
    Then the count comes from entitlement's own meter
    And no trace or billing Api is asked to count

  @unit @usage
  Scenario: Each OTel log record is one billable event
    Given a project sent two log records
    When the meter projection maps each log record event
    Then each record is billed under its producer's own key
    And a redelivered record keeps the same key, so it counts once

  @unit @usage
  Scenario: A metric series is billed once per UTC clock hour however many points it sends
    Given a metric series sent several points within one UTC hour
    When the meter projection maps each data point event
    Then every point carries the key of the project, the series and that hour
    And the month counts the series once for that hour

  @unit @usage
  Scenario: The same metric series sending in two hours is billed twice
    Given a metric series sent one point at 14:59 UTC and one at 15:00 UTC
    When the meter projection maps both events
    Then the two points carry different keys

  @unit @usage
  Scenario: Two metric series in the same hour are billed separately
    Given two metric series of one project each sent a point in the same UTC hour
    When the meter projection maps both events
    Then the two points carry different keys

  @unit @usage
  Scenario: A metric event without a series id falls back to the event's own key
    Given a metric data point event whose data carries no valid series id
    When the meter projection maps it
    Then the mapping does not throw
    And the event is billed under its producer's key, as any other event

  @unit @usage
  Scenario: The trace-side log contribution is not billed
    Given the trace pipeline records a log record against its trace
    When the meter's subscribed event types are read
    Then neither the trace log record event nor the log contribution event is among them
    And only the log pipeline's own record event bills a log

  @unit @usage
  Scenario: Entitlement records a crossed warning threshold as its own event
    Given an organization at 90% of its monthly allowance
    When entitlement checks the organization's usage against the warning thresholds
    Then a usage warning event is recorded with the 90% threshold and each project's count this month
    And the month is counted once

  @unit @usage
  Scenario: A reading below every warning threshold records nothing and counts nothing
    Given an organization at 10% of its monthly allowance
    When entitlement checks the organization's usage against the warning thresholds
    Then no usage warning event is recorded and no project is counted

  @unit @usage
  Scenario: A warning whose per-project counts are unknown is not recorded
    Given an organization above a warning threshold whose per-project counts cannot be read
    When entitlement checks the organization's usage against the warning thresholds
    Then no usage warning event is recorded and the check reports nothing sent

  @unit @usage
  Scenario: Billing sends each recorded warning once per threshold a month
    Given a usage warning event for an organization at the 90% threshold
    When billing's subscriber handles the event twice
    Then the organization's admins are mailed once, naming each project and its count
    And the warning is recorded against the month so a later 90% reading sends nothing

  @unit @usage
  Scenario: Billing reports the month's total to Stripe from usage's month_counted event
    Given a month_counted event for an organization with billable events counted this month
    When billing's subscriber handles the event
    Then the quantity reported to Stripe comes from the event and billing asks no usage Api

  @unit @usage @unimplemented
  Scenario: Counting has one Api, entitlement's
    Given the installed modules
    When their contracts are read
    Then no module offers a usage Api beside EntitlementApi
    And no module asks entitlement to count; peers learn the month's count from its facts

  @unit @usage @unimplemented
  Scenario: Metering adds no peer edge of its own
    Given the installed process apps
    When the peer-cycles policy reads them
    Then the metering pipeline asks only entitlement's own billing and project peers
