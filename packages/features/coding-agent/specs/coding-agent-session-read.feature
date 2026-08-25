Feature: Coding-agent session read service

  Rule: One service exposes the complete session capability

    Scenario: another feature reads recent session branch facts
      Given a project with recent coding-agent sessions
      When GitHub requests the recent sessions through Coding Agent
      Then it receives the existing session rows including repository and branch facts
      And it does not receive a GitHub-specific coding-agent service

    Scenario: metric-only sessions retain their usage totals
      Given a session whose folded token or cost total is zero
      When Coding Agent reads the session
      Then it overlays the converged metric-series total for only that zero field
      And a nonzero folded total is not counted twice

    Scenario: a trace with no coding-agent mapping is optional discovery
      Given a trace that has no coding-agent session mapping
      When Coding Agent resolves its session
      Then it returns no session

  Rule: Session reads remain bounded

    Scenario: an event page is larger than the service permits
      When Coding Agent reads the session events
      Then the repository receives at most 1000 events

    Scenario: a session event read has no explicit time window
      Given the session aggregate is available
      When Coding Agent reads the session events
      Then it bounds the first read around the session start time

  Rule: Browser presentation belongs to Coding Agent

    Scenario: the application renders a coding-agent session list
      When the application supplies session rows to Coding Agent presentation
      Then Coding Agent shapes, sorts and formats the rows
      And application routing and query composition remain outside the feature
