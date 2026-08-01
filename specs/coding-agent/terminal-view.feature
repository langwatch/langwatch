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

  Scenario: The bottom bar stays put while the transcript scrolls
    Given a session long enough to scroll
    When the reader scrolls through the transcript
    Then the bottom bar stays fixed and keeps showing the session name and running stats
