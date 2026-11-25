@coding-agent
Feature: The trace drawer's coding-agent reads
  As someone opening a coding-agent trace in the trace drawer
  I want its session and its transcript read from coding-agent's own namespace
  So that the terminal and session tabs show what the agent did

  Main served these as traces.codingAgentSession and traces.codingAgentTranscript.
  A tRPC namespace belongs to one module (ARCHITECTURE.md §3), so they moved with their owner.
  The Sessions lens page (main's traces.sessions) moved too, as codingAgents.sessionGroups, so
  trace no longer calls coding-agent to enrich it (Alex, 2026-10-06, T1 D1).

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
    Then session, transcript and sessionGroups each ask for traces:view

  @unit
  Scenario: The Sessions lens page is served from coding-agent's namespace
    When the codingAgents and traces namespaces are declared
    Then codingAgents declares sessionGroups with the input and page traces.sessions had
    And traces declares no sessions procedure

  @unit
  Scenario: The Sessions lens page is read through the signed-in viewer's protections
    Given a signed-in viewer reading the Sessions lens
    When codingAgents.sessionGroups is called
    Then trace is asked for the page under that viewer's protections
    And the page comes back with its coding-agent sessions enriched

  @unit
  Scenario: A failed coding-agent enrichment leaves the Sessions lens page whole
    Given a page whose coding-agent session lookup or pull-request join fails
    When coding-agent enriches the page
    Then every session is still returned, unenriched or unlinked

  @integration
  Scenario: The installed api serves the trace reads from coding-agent's namespace only
    When the api process is installed
    Then codingAgents declares session and transcript
    And traces declares neither codingAgentSession nor codingAgentTranscript
