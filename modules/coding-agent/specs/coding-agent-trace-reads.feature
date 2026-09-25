@coding-agent
Feature: The trace drawer's coding-agent reads
  As someone opening a coding-agent trace in the trace drawer
  I want its session and its transcript read from coding-agent's own namespace
  So that the terminal and session tabs show what the agent did

  Main served these as traces.codingAgentSession and traces.codingAgentTranscript.
  A tRPC namespace belongs to one module (ARCHITECTURE.md §3), so they moved with their owner.

  @unit
  Scenario: The drawer reads the coding-agent session a trace belongs to
    Given a trace that belongs to a coding-agent session
    When codingAgents.session is called for that trace
    Then the session coding-agent holds for the trace is returned unchanged

  @unit
  Scenario: A trace outside any coding-agent session reads no session
    Given a trace coding-agent knows no session for
    When codingAgents.session is called for that trace
    Then the answer is null rather than an error

  @unit
  Scenario: The drawer's transcript is read for the signed-in viewer
    Given a signed-in viewer opening a coding-agent trace with a partition hint
    When codingAgents.transcript is called
    Then trace is asked for that viewer's redacted transcript of that trace and hint
    And the transcript is returned unchanged

  @unit
  Scenario: The coding-agent trace reads need permission to view traces
    When the codingAgents namespace is declared
    Then session and transcript each ask for traces:view

  @integration
  Scenario: The installed api serves the trace reads from coding-agent's namespace only
    When the api process is installed
    Then codingAgents declares session and transcript
    And traces declares neither codingAgentSession nor codingAgentTranscript
