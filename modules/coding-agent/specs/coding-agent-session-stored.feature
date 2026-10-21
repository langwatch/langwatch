Feature: Coding-agent records a session-stored fact

  When a coding-agent session row is stored, coding-agent records one fact for
  peers to react to: ids, the product agent, the session's own time and whether
  it is the project's first. It never names a consumer and carries no personal
  field.

  @unit
  Scenario: The session-stored fact carries ids, the agent and the first-session flag only
    Given the session-stored fact schema
    Then its keys are tenantId, projectId, sessionId, agentType, firstForProject and occurredAt
    And a seventh key is rejected

  @unit
  Scenario: A stored session records one session-stored fact
    Given a stored coding-agent session of a stamped project
    When the stored sessions are reported
    Then one fact is recorded with the product agent and the session's own time

  @unit
  Scenario: A session stored twice in one batch records one fact
    Given a batch naming the same session twice
    When the stored sessions are reported
    Then one fact is recorded

  @unit
  Scenario: A helper-thread session records no fact
    Given a stored session marked auxiliary
    When the stored sessions are reported
    Then no fact is recorded

  @unit
  Scenario: A stored session with no named coding agent records no fact
    Given a stored session whose agent is null
    When the stored sessions are reported
    Then no fact is recorded

  @unit
  Scenario: A helper-thread session is reported as auxiliary
    Given the store commits a session whose state is auxiliary
    Then the sessions-stored hook receives it marked auxiliary

  @unit
  Scenario: The first session of a project is flagged
    Given a project with no stamp and no other stored session
    When its session is reported
    Then the fact says firstForProject is true

  @unit
  Scenario: A project already stamped is never first
    Given a project whose last coding-agent session time is set
    When its session is reported
    Then the fact says firstForProject is false

  @unit
  Scenario: A project with an older session is never first
    Given an unstamped project whose own history holds another session
    When its session is reported
    Then the fact says firstForProject is false

  @unit
  Scenario: A helper-thread session in the history never blocks the first
    Given an unstamped project whose only other session is a helper thread
    When its main session is reported
    Then the fact says firstForProject is true

  @unit
  Scenario: A failing history check fails closed
    Given an unstamped project whose history check throws
    When its session is reported
    Then the fact says firstForProject is false

  @unit
  Scenario: A failing session-stored recorder never fails the stored row
    Given the recorder rejects
    When a session is stored
    Then the store call resolves

  @unit
  Scenario: A redelivered session-stored fact is one event
    Given the same session-stored fact recorded twice
    Then both carry one idempotency key
