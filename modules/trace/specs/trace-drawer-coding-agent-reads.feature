@trace @coding-agent
Feature: The trace drawer's coding-agent reads
  As someone opening a coding-agent trace in the trace drawer
  I want its session and its transcript read at the names the drawer has always called
  So that the terminal and session tabs show what the agent did

  @unit
  Scenario: The drawer reads the coding-agent session a trace belongs to
    Given a trace that belongs to a coding-agent session
    When traces.codingAgentSession is called for that trace
    Then the session coding-agent answers for the trace is returned unchanged

  @unit
  Scenario: A trace outside any coding-agent session reads no session
    Given a trace coding-agent knows no session for
    When traces.codingAgentSession is called for that trace
    Then the answer is null rather than an error

  @unit
  Scenario: The drawer's transcript is read for the signed-in viewer
    Given a signed-in viewer opening a coding-agent trace with a partition hint
    When traces.codingAgentTranscript is called
    Then the transcript is read for that viewer, that trace and that hint
    And the transcript is returned unchanged

  @unit
  Scenario: The transcript is redacted by the viewer's own protections
    Given a viewer whose protections carry a plan visibility window
    When the viewer's coding-agent transcript is read
    Then the viewer's protections are resolved for the project
    And the spans are read inside that visibility window

  @unit
  Scenario: The coding-agent reads need permission to view traces
    When the traces namespace is declared
    Then codingAgentSession and codingAgentTranscript each ask for traces:view
