Feature: Langy ops functions
  A staff session reads how Langy behaved for the approved organization: turns, their states,
  failure codes, the tools they called and the ids those calls aimed at. No function returns a
  message, a tool argument or a tool result. ADR-202, amendment 2026-11-25.

  Theme analysis of what people ask Langy is not an ops function: it is an org:content session on
  the Langy mirror organization, or on one customer's own organization for a single debug, like any
  other content read.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia holds the platform-operator grant and has a passkey
    And the organization "ACME" exists with a project "acme-support"

  @integration
  Scenario: org.langy answers turns per day, model, state and failure code
    Given ACME's people ran Langy turns over the last days, some of them failed
    And a redeemed "org:metadata" session on ACME naming "org.langy"
    When the agent calls "org.langy" for the last 7 days
    Then each row carries its day, model, turn state, failure code, failed tool calls by tool, turns and people
    And no message, tool argument or error text

  @unit
  Scenario: org.langy marks rows as floors when the turn read stopped at its cap
    Given Langy's turn read for ACME stopped at its turn cap
    When the agent calls "org.langy"
    Then every row says its turn scan is not complete

  @unit
  Scenario: org.langy marks rows complete when the turn read held the whole window
    Given Langy's turn read for ACME held every turn of the window
    When the agent calls "org.langy"
    Then every row says its turn scan is complete

  @integration
  Scenario: org.langy reads only the approved organization
    Given another organization ran Langy turns in the same days
    When the agent calls "org.langy" on ACME
    Then only ACME's projects are read

  @integration
  Scenario: org.langy refuses a range over 31 days
    When the agent calls "org.langy" with a range of 40 days
    Then it is refused 422 with "staff_function_bad_input"

  @integration
  Scenario: org.langy_turn answers one conversation's turns and tool calls without text
    Given a Langy conversation in "acme-support" whose turn ran a CLI call on a dashboard and failed a tool call
    And a redeemed "org:metadata" session on ACME naming "org.langy_turn"
    When the agent calls "org.langy_turn" for that conversation
    Then each turn carries its id, times, state and failure code
    And each tool call carries its tool, status, duration, card kind and the kind and id of its target
    And no message, command, tool argument or tool result

  @integration
  Scenario: org.langy_turn refuses a project outside the organization or an unknown conversation
    When the agent calls "org.langy_turn" for a project outside ACME
    Then it is refused 404 with "staff_function_not_found"
    When the agent calls "org.langy_turn" for a conversation the project does not hold
    Then it is refused 404 with "staff_function_not_found"
