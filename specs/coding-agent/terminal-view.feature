Feature: Coding agent terminal view
  As someone reviewing a coding agent session
  I want the Terminal tab to replay the WHOLE session, in order
  So that reading it is like scrolling back through the real CLI session,
  not just the last thing the model said

  # The browser used to rebuild the transcript itself by parsing the LAST model
  # call's rolling message history. That works only for the final turn: when
  # that last call is a lone tool request, the whole 458-span, 115-tool session
  # rendered as one line ("step 1/1"). The backend's `codingAgentTranscript`
  # orders every span and log by timestamp instead, so it cannot collapse this
  # way and it works for every agent, not just Claude Code.

  Background:
    Given a coding agent session with prompts, tool calls, and a final reply

  Scenario: The transcript shows every beat, not just the final turn
    Given the session's last model call is a single tool request with no reply text
    When the Terminal tab renders the session
    Then every prompt, message, and tool call from the whole session is shown
    And the session does not collapse to a single step

  Scenario: A tool the user denied is shown even though it left no span
    Given the user denied a tool call partway through the session
    When the Terminal tab renders the session
    Then the denied call is shown as rejected, not silently missing

  Scenario: A tool call shows what actually ran, not just what the model was told
    Given a tool span carries real stdout, a real file's content, or a real structured patch
    When the Terminal tab renders that tool call
    Then the real output is shown in place of the model's capped echo

  Scenario: The top of the session identifies the agent, model, and repo
    Given the session was run by Claude Code version 2.1.207 against a repo
    When the Terminal tab renders the session
    Then the top of the session shows the Claude Code version, the model, and the repo

  # Codex never exports the assistant's reply text over OTel (verified against
  # codex 0.146: no span or log event carries it), so its transcript is the
  # prompt, the tool calls, and the model-call economics. Everything codex DOES
  # export must render.

  @unit
  Scenario: A codex session shows its prompt and its tool calls with real input and output
    Given a codex session whose tool_result log events carry the tool name, arguments, and output
    When the Terminal tab renders the session
    Then each tool call shows its name, its arguments as input, and its captured output

  @unit
  Scenario: Codex tool calls are not doubled when both a span and a log record the same call
    Given a codex tool call recorded both as a tool span and as a tool_result log event sharing a call id
    When the Terminal tab renders the session
    Then the tool call appears once

  @unit
  Scenario: Codex model calls appear once per response span when no turn rollup exists
    Given a codex exec session with usage-bearing response spans and no turn rollup span
    When the Terminal tab renders the session
    Then each response span appears as a model call with its token counts

  @unit
  Scenario: A log record whose event name arrived on the OTLP eventName field still renders
    Given a stored log record whose event name lives in the EventName column and not in its attributes
    When the transcript reads the trace's logs
    Then the event is recognised and rendered the same as an attribute-named event

  # The system prompt is the context the user pays for on every call - CLAUDE.md,
  # MCP tool definitions, skills. It rides the first request body of the session.

  @unit
  Scenario: The session's system context is shown once at the top
    Given a claude code session whose first model call input carries a system message
    When the Terminal tab renders the session
    Then a collapsed system context entry appears before the first prompt
    And it is not repeated for later model calls

  Scenario: The bottom bar stays put while the transcript scrolls
    Given a session long enough to scroll
    When the reader scrolls through the transcript
    Then the bottom bar stays fixed and keeps showing the session name and running stats
