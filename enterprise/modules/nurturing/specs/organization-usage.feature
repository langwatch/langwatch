Feature: An organization's usage reaches Customer.io once a day

  Each day after 05:00 UTC nurturing reads every organization active in the
  last 30 days from its owners (prompt, evaluator, scenario, trace) and sends
  Customer.io one group call per organization, through its admin. The call
  carries counts and times only: never a name, trace content or an error
  message, and none of the traits other signals set. A project's active day
  also reaches Customer.io as an event, so campaigns can use LLMOps activity.
  See https://github.com/langwatch/langwatch/issues/9378.

  @unit
  Scenario: An active organization's usage reaches Customer.io as one group call
    Given an organization with 2 prompts, 1 active evaluator, no scenarios and 3 traces, 1 failed
    When the daily sync runs after 05:00 UTC
    Then Customer.io gets one group call for it through its admin
    And it carries the counts and the failed trace's time in Unix seconds

  @unit
  Scenario: An organization with nothing gets zeros
    Given an active organization with no prompts, evaluators, scenarios or traces
    When the daily sync runs
    Then every count and the total cost are 0
    And no failed trace time is sent

  @unit
  Scenario: The group call carries only the usage traits
    When the daily sync sends an organization's group call
    Then its trait keys are exactly the usage counts, the failed trace time and usage_synced_at

  @integration
  Scenario: A trace stored in two versions counts once with its newest cost
    Given a trace stored in two versions with different costs
    When the organization's traces are summed
    Then the trace counts once, with its newest version's cost and error state

  @unit @integration
  Scenario: Traces are summed over every project of the organization, over the last 30 days
    Given traces in two projects of one organization, and one older than 30 days
    When the organization's traces are summed
    Then the counts and the cost cover both projects and leave the old trace out

  @unit @integration
  Scenario: Archived projects are not counted
    Given an organization with a live project and an archived one
    When the daily sync runs
    Then only the live project's evaluators, scenarios and traces are counted

  @integration
  Scenario: Archived evaluators are not counted
    Given two active evaluators and one archived
    Then the organization's evaluator count is 2

  @unit
  Scenario: The sync waits for 05:00 UTC
    Given the last sync went yesterday
    Then nothing is sent at 04:59 UTC
    And the sync runs at 05:00 UTC

  @unit
  Scenario: A sync that already ran today sends nothing more
    Given the sync already ran today
    When it wakes again or its intent is redelivered
    Then no second group call goes out for any organization

  @unit
  Scenario: A failed read for one organization does not stop the others
    Given the trace read fails for one organization
    When the daily sync runs
    Then the other organizations still get their call
    And that organization's claim is given back and the error is logged with its id

  @unit
  Scenario: A refused batch gives its claims back so the retry sends them
    Given Customer.io refuses a page's batch
    When the sync is retried
    Then the page's organizations are sent

  @unit
  Scenario: Only organizations active in the last 30 days and with an admin are read
    Given organizations with old and recent traces, new and old rows, and one with no admin
    When the daily sync runs
    Then only those with an admin and a trace in the last 30 days, or no trace and a row written in them, are read and sent

  @unit
  Scenario: The sync never keeps an organization active on its own
    Given an organization with no traces whose only activity is the daily sync
    Then it drops out once its row is older than 30 days

  @unit
  Scenario: Every qualifying organization gets exactly one group call
    Given 250 qualifying organizations
    When the daily sync runs
    Then each gets exactly one group call, sent in pages of 100

  @unit
  Scenario: A project's active day is tracked to the organization admin in Customer.io once
    Given a project's active day signal
    When nurturing delivers it
    Then Customer.io gets one project_active_day track to the admin with the source, the project and the signup age
    And PostHog still gets its event
    And a redelivery sends nothing to either

  @unit
  Scenario: A created scenario records the organization's scenario count across its projects
    Given 2 scenarios in project A and 1 in project B of one organization
    When a scenario is created in project B
    Then the recorded scenario count is 4

  @unit
  Scenario: A created scenario whose organization cannot be resolved records the project's count
    Given a project whose organization cannot be resolved
    When a scenario is created in it
    Then the recorded scenario count is the project's own
