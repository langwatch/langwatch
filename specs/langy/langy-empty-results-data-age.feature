Feature: Langy tells an idle project from a broken pipeline
  A time-bounded question that finds nothing is ambiguous: the project may be
  quiet, or its data may have stopped arriving. A bare "No traces in last 24h."
  cannot be told from Langy being broken. Langy looks up how old the newest
  matching row is, says so, offers one likely cause, and never claims it cannot
  see data that a successful query just showed to be absent.

  Background:
    Given a project and a working Langy session

  @unit
  Scenario: The prompt no longer answers an empty window with a bare line
    When the prompt asset is checked
    Then it does not tell the agent to reply with only "No X in last 24h."
    And its empty-results rule tells the agent to look up the newest matching row
    And that rule tells the agent to state how old that row is
    And that rule tells the agent to say when the project never received the data

  @unit
  Scenario: The prompt lets Langy name a skill's telemetry env vars
    When the prompt asset is checked
    Then it lets the agent name the telemetry env vars a skill gives
    And it has the agent write the key as a placeholder, never a real key

  @e2e
  Scenario: An empty window is followed by the age of the newest row
    Given the project has traces, the newest of them about 8 hours old
    When I ask how many traces I got in the last hour
    Then Langy says there were none in that hour
    And Langy runs one more query for the newest matching trace in any window
    And Langy states when that trace arrived and how long ago

  @e2e
  Scenario: An empty window names one likely cause
    Given the project has traces, the newest of them about 8 hours old
    When I ask how many traces I got in the last hour
    Then Langy names one likely cause such as export stopped, a wrong project or API key, or the app not being instrumented yet
    And the cause follows the age of the newest trace

  @unit
  Scenario: A filtered question with no matches gets a plain none
    Given the user asks about errors in the last 24h and none exist
    When the prompt asset is checked
    Then its empty-results rule tells the agent to say there were none
    And it does not tell the agent to suggest the pipeline is broken

  @e2e
  Scenario: A project that never received the data says so
    Given the project has never received any matching row
    When I ask about that data in a time window
    Then Langy says the project has never received that data
    And Langy does not invent a time for a newest row
    And Langy names one likely cause

  @e2e
  Scenario: Langy does not claim it cannot see data after a query succeeded
    Given a query succeeded and returned no rows
    When Langy replies
    Then the reply does not say or imply that Langy cannot see or access the data

  @unit
  Scenario: The coding-agent-cost skill checks an empty window before reporting
    Given the rendered skill
    When the session queries return no rows in the window
    Then the skill tells the agent to look up the newest session event in any window
    And it states how old that event is, or that no session event ever arrived

  @unit
  Scenario: The coding-agent-cost skill names the Claude Code telemetry setup
    Given the rendered skill
    When no coding-session data has ever arrived
    Then the skill names the OTLP environment variables Claude Code needs
    And it names the project API key as the credential to send
