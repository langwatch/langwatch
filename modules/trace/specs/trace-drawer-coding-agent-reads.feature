@trace @coding-agent
Feature: The trace drawer's coding-agent reads
  As someone opening a coding-agent trace in the trace drawer
  I want the transcript trace hands coding-agent redacted by the reader's own protections
  So that no content bypasses the data-privacy policy
  The drawer's procedures moved to codingAgents.*: modules/coding-agent/specs/coding-agent-trace-reads.feature

  @unit
  Scenario: The transcript is redacted by the viewer's own protections
    Given a viewer whose protections carry a plan visibility window
    When the viewer's coding-agent transcript is read
    Then the viewer's protections are resolved for the project
    And the spans are read inside that visibility window

  Rule: The REST transcript route reads main's transcript for an API key

    @unit
    Scenario: The REST transcript route answers one trace's transcript for the API key
      Given an API key for a project with a coding-agent trace
      When the key reads GET /api/traces/{traceId}/transcript
      Then the answer is the trace's transcript, read through the key's own protections

    @unit
    Scenario: The REST transcript route answers 404 for an unknown trace
      Given no trace in the project matches the id
      When the key reads its transcript
      Then the answer is 404 with the code trace_not_found

    @unit
    Scenario: The REST transcript route answers 409 for an ambiguous prefix
      Given a prefix that matches two traces in the project
      When the key reads the transcript by that prefix
      Then the answer is 409 with the code trace_id_ambiguous naming both candidate trace ids
