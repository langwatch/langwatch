Feature: Coding-agent records a session-stored fact

  When a coding-agent session row is stored, coding-agent records one fact for
  peers to react to: ids, the product agent, the session's own time, whether
  it is the project's first, its terminal type from a closed set and a keyed hash standing for its repo.
  It never names a consumer and carries no personal field and no repo name.

  @unit
  Scenario: The session-stored fact carries ids, the agent, the first-session flag, the terminal type and the repo key only
    Given the session-stored fact schema
    Then its keys are tenantId, projectId, sessionId, agentType, firstForProject, occurredAt, terminalType and repositoryKey
    And any other key is rejected
    And a fact recorded before terminalType and repositoryKey existed still parses

  @unit
  Scenario: A stored session reports its terminal type and a key standing for its repo
    Given the store commits a session with a terminal type, repo host, owner and name
    Then the sessions-stored hook receives the terminal type and a hash of the repo
    And it receives no repo host, owner or name

  @unit
  Scenario: A repo's key ignores case and differs per repo
    Given two spellings of one repo that differ only by case, and a second repo
    Then both spellings have one key and the second repo has another
    And a repo with no owner or no name has no key

  @unit
  Scenario: A repo with no host named is the same repo as on the deployment's host
    Given one repo named with no host and with the deployment's host
    Then both have one key

  @unit
  Scenario: A guessed repo name cannot be tested without the server's secret
    Given a repo's key
    Then a plain hash of the repo's host, owner and name does not match it
    And another secret gives another key

  @unit
  Scenario: A deployment with no secret reports no repo key
    Given a deployment holding no secret to key a repo with
    Then a stored session names no repo key, never an unkeyed hash

  @unit
  Scenario: A client's terminal string reaches peers only as one of a closed set
    Given a session whose terminal.type is any string the client chose
    Then the sessions-stored hook receives its closed name, or other when it is unknown
    And the session-stored fact schema rejects any other value

  @unit
  Scenario: A stored session's fact carries its terminal type and repo key
    Given a stored session with a terminal type and a repo key
    When the stored sessions are reported
    Then the fact carries both

  @unit
  Scenario: A stored session with no terminal type or repo records a fact without them
    Given a stored session with neither
    When the stored sessions are reported
    Then the fact names no terminal type and no repo key

  @unit
  Scenario: A session that learns its terminal type or repo inside the hold records again
    Given a session's fact was recorded before its repo was known
    When the session is reported again inside the hold with its repo
    Then a second fact is recorded with the repo key
    And reporting it again unchanged inside the hold records nothing

  @unit
  Scenario: A session that learns its repo at the same instant is a distinct event
    Given two facts of one session at one instant, the second naming a repo key
    Then their idempotency keys differ

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
    Given a project whose last coding-agent session time predates the session's first store and whose only other sessions are helper threads
    When its main session is reported
    Then the fact says firstForProject is true

  @unit
  Scenario: A first main session folded again is not first a second time
    Given a project stamped after the session was first stored and whose only other sessions are helper threads
    When the same session is reported again
    Then the fact says firstForProject is false

  @unit
  Scenario: A main session re-folded while the stamp still predates it is not first again
    Given a project stamped before the session was first stored and whose only other sessions are helper threads
    When the session is reported after its first fact window has passed
    Then the fact says firstForProject is false

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
