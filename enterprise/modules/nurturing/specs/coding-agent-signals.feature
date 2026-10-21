Feature: Coding-agent session signals reach Customer.io

  Coding-agent records one session-stored fact per stored session. Nurturing
  reacts to it from its own side and tells Customer.io about the organization's
  admin: the last session time, the active-day count, the agent types and the
  first session. Nurturing alone keeps this state, on its own organization row.

  Background:
    Given nurturing knows organization org-1 with admin admin-1 and project project-1

  @unit
  Scenario: The first coding-agent session raises one first-session signal
    When coding-agent's session-stored fact says the session is the project's first
    Then one first-session signal names the admin, the project and the agent
    And the active-day count is one

  @unit
  Scenario: A redelivered or second first-session fact raises no second signal
    Given the organization's first session was already recorded
    When another session-stored fact says first, from the same or another project, or at once
    Then no second first-session signal is raised

  @unit
  Scenario: A second agent type extends the list without a first-session signal
    Given the organization's first session used claude_code
    When a later session used codex
    Then the agent types are claude_code and codex
    And no second first-session signal is raised

  @unit
  Scenario: A seeded organization never gets the first-session signal
    Given the organization was learned from project's backfill
    When a session-stored fact says first
    Then no first-session signal is raised
    And the active-day count is one

  @unit
  Scenario: A session that is not the project's first raises no first-session signal
    When a session-stored fact says first is false
    Then no first-session signal is raised
    And the active-day count is one

  @unit
  Scenario: Active days count one per later UTC day
    When sessions occur on days D, D, D+1 and D+3
    Then the counts raised are one, two and three

  @unit
  Scenario: A session just before and just after UTC midnight counts as two days
    When sessions occur at 23:59 and 00:01 UTC
    Then the active-day count is two

  @unit
  Scenario: A late session of an earlier day changes nothing
    Given the organization's last active day is D+3
    When a session of day D+2 arrives
    Then no active-day signal is raised

  @unit
  Scenario: An organization with no admin raises nothing
    Given the organization has no admin
    When a session-stored fact arrives
    Then no signal is raised

  @integration
  Scenario: Concurrent first-session writes change the row once
    Given five first-session writes at once
    Then exactly one reports first

  @unit
  Scenario: A stored session identifies coding_last_session_at on the admin
    When a coding_session_stored signal is delivered
    Then Customer.io identifies the admin with coding_last_session_at

  @unit
  Scenario: Session updates to Customer.io are debounced per project for 300 seconds
    When sessions of one project are delivered inside 300 seconds
    Then Customer.io is identified once
    And after 301 seconds it is identified again with the later time

  @unit
  Scenario: A later UTC day raises coding_active_days
    When a coding_active_days signal is delivered
    Then Customer.io identifies the admin with the count

  @unit
  Scenario: A second agent type extends coding_agent_types without a first-session event
    When a coding_agent_types signal is delivered
    Then Customer.io identifies the full list
    And no event is tracked

  @unit
  Scenario: The first coding-agent session identifies the admin and tracks one event
    When a coding_agent_first_session signal is delivered
    Then Customer.io identifies coding_first_session_at and coding_agent_types
    And tracks one coding_agent_first_session with the agent type

  @unit
  Scenario: The new signals reach Customer.io only
    When any of the six new signals is delivered
    Then PostHog receives nothing
