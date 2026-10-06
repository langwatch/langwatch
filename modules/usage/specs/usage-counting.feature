Feature: Usage owns all counting
  As the owner of every organization's monthly count
  I want counting, enforcement and the approaching-limit decision to live in one module
  So that limits are enforced in production and entitlement answers plans and features only

  See dev/docs/ARCHITECTURE.md §3 (usage owns all counting) and §11 (usage decides, billing only sends).
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

  @unit @usage @unimplemented
  Scenario: The limit check refuses a tenant that resolves to no organization
    Given a team that belongs to no organization
    When a caller checks the usage limit for that team's organization
    Then the check fails with organization_not_found_for_team

  @unit @usage @unimplemented
  Scenario: Usage counts billable events from every pipeline itself
    Given spans, evaluations, experiment results and simulation messages recorded for a project this month
    When the month's count is read for the project's organization
    Then the count comes from usage's own meter
    And no trace or billing Api is asked to count

  @unit @usage @unimplemented
  Scenario: Usage records a crossed warning threshold as its own event
    Given an organization at 90% of its monthly allowance
    When usage checks the organization's usage against the warning thresholds
    Then a usage warning event is recorded with the 90% threshold and each project's count this month
    And the month is counted once

  @unit @usage @unimplemented
  Scenario: A reading below every warning threshold records nothing and counts nothing
    Given an organization at 10% of its monthly allowance
    When usage checks the organization's usage against the warning thresholds
    Then no usage warning event is recorded and no project is counted

  @unit @usage @unimplemented
  Scenario: A warning whose per-project counts are unknown is not recorded
    Given an organization above a warning threshold whose per-project counts cannot be read
    When usage checks the organization's usage against the warning thresholds
    Then no usage warning event is recorded and the check reports nothing sent

  @unit @usage @unimplemented
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
  Scenario: Entitlement answers plans and features only
    Given the installed modules
    When entitlement's Api is read
    Then it offers no usage, spend or warning operation
    And no module asks entitlement to count

  @unit @usage @unimplemented
  Scenario: Usage closes no peer cycle
    Given the installed process apps
    When the peer-cycles policy reads them
    Then no edge to or from usage is reported
