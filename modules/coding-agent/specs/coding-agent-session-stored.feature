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
  Scenario: A project stamped with main history is never first
    Given a project whose last coding-agent session time is set and whose history holds a main session
    When its session is reported
    Then the fact says firstForProject is false

  @unit
  Scenario: A project stamped with no history left is never first
    Given a project whose last coding-agent session time is set and whose history is empty
    When its session is reported
    Then the fact says firstForProject is false

  @unit
  Scenario: A project stamped only by helper threads still flags its main session first
    Given a project whose last coding-agent session time is set and whose only other sessions are helper threads
    When its main session is reported
    Then the fact says firstForProject is true

  @unit
  Scenario: A deleted project is never first
    Given a session whose project no longer exists
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
  Scenario: Two new sessions of a fresh project in one batch flag exactly the earliest
    Given a project with no earlier session
    When two new main sessions of it are stored in one batch
    Then only the earlier session is flagged as the project's first

  @unit
  Scenario: A batch of a project with older history flags none
    Given a project with an older session
    When two new main sessions of it are stored in one batch
    Then neither session is flagged as the project's first

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

  @unit
  Scenario: A session time more than a day ahead is recorded as one day ahead
    Given a stored session dated a year ahead
    When the stored sessions are reported
    Then the fact carries a time one day after the report

  @unit
  Scenario: A session reported again inside the hold records no second fact
    Given a session already recorded
    When it is reported again inside the hold
    Then no second fact is recorded

  @unit
  Scenario: A session reported again after the hold records again
    Given a session already recorded
    When it is reported again after the hold
    Then a second fact is recorded

  @unit
  Scenario: A session reported on two UTC days records on both
    Given a session reported at 23:59 UTC
    When it is reported again at 00:01 UTC
    Then both reports record a fact

  @unit
  Scenario: A failed recording releases the hold
    Given the recorder rejects once
    When the same session is reported again
    Then the second report records the fact

  @unit
  Scenario: Expired holds are swept when the hold map is full
    Given the hold map has reached its sweep threshold
    When the holds expire and a session is reported
    Then a session whose hold expired records again
