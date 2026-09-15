Feature: Everything about a coding-agent session is queryable

  As a coding agent (or any API client) calling the LangWatchQL query door
  I want the sessions, events, and tool output of coding-agent runs — and the
  organization-level facts around them — available as queryable views
  So that I can answer questions about my own runs and about the fleet without
  reaching for a bespoke endpoint per question

  Issue: #8085.

  Rule: List sessions

    @e2e
    Scenario: List sessions
      Given a user with an API key with access to a project with coding-agent sessions
      When they ask for the sessions of a day
      Then they get one row per session with when it ran, its branch, repository and cost

  Rule: Read every event of a session

    @e2e
    Scenario: Read every event of a session
      Given a user with an API key with access to a project with coding-agent sessions
      When they ask for the events of one session
      Then they get every model call, tool call and sub-agent call in order

  Rule: Read what a tool call printed

    # coding_tool_results joins the tool call to the next turn's request body,
    # so this reads as one query. Bound by the integration test in
    # catalog/__tests__/codingToolResults.integration.test.ts.
    @e2e
    Scenario: Read what a tool call printed
      Given a user with an API key with access to a project with coding-agent sessions
      When they ask for the output of a tool call
      Then they get what the tool printed, not only whether it failed

  Rule: Ask about organization-level facts

    # Needs an organization-level capability, not a project-scoped view —
    # every LangWatchQL key is tenant-scoped to one project's row policy today.
    @e2e @unimplemented
    Scenario: Ask about organization-level facts
      Given a user with an API key with access to an organization
      When they ask about spend and governance for the whole organization
      Then they get an answer that is not limited to one project
