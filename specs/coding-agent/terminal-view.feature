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
    Given a codex session that ran tools
    When the Terminal tab renders the session
    Then each tool call shows its name, the arguments it ran with, and what it returned

  @unit
  Scenario: A tool the agent ran once is shown once
    Given a codex session whose tool run was reported twice by the agent
    When the Terminal tab renders the session
    Then the tool call appears once

  @unit
  Scenario: Every model call in a codex exec session is shown with its token counts
    Given a codex exec session that made several model calls
    When the Terminal tab renders the session
    Then each model call appears once with the tokens it used

  @unit
  Scenario: Codex events are rendered whichever way the agent named them
    Given a codex session whose events name themselves the way the OTel Event API does
    When the Terminal tab renders the session
    Then those events are read and rendered like any other

  # The system prompt is the context the user pays for on every call - CLAUDE.md,
  # MCP tool definitions, skills. It rides the first request body of the session.

  @unit
  Scenario: The session's system context is shown once at the top
    Given a claude code session that carried a system prompt
    When the Terminal tab renders the session
    Then a collapsed system context entry appears before the first prompt
    And it is not repeated for later model calls
    And expanding it with the keyboard shows the context

  Scenario: The bottom bar stays put while the transcript scrolls
    Given a session long enough to scroll
    When the reader scrolls through the transcript
    Then the bottom bar stays fixed and keeps showing the session name and running stats

  # A coding-agent session is many traces: one per turn. The Terminal tab opens
  # on ONE of them, so the session's earlier turns are simply not on screen, and
  # a reader who scrolls up hits the top of a turn rather than the top of the
  # session. The turns of the session are already ordered by
  # `tracesV2.conversationContext`, so the view walks backwards through them and
  # prepends each earlier turn above the one already loaded.
  #
  # The view opens pinned to the session's latest line, the way a terminal sits
  # at its prompt, and keeps a buffer of earlier turns loaded above the reader:
  # on open the buffer fills the screen with the turns that came before, and
  # while reading back it stays ahead of the scroll so a short turn never loads
  # in front of the reader's eyes. The buffer is a couple of viewports deep, so
  # walking a long session back still happens turn by turn as the reader asks
  # for it, not all at once.

Rule: The terminal reads back the whole session

  @integration
  Scenario: Opening a session lands at its latest line
    Given the terminal opened on the last turn of a session
    When the transcript first renders
    Then the screen is scrolled to the transcript's end
    And the turns before it start loading above without any gesture

  @integration
  Scenario: Earlier turns preload before the reader reaches the top
    Given the terminal opened on a later turn of a session
    When the reader scrolls to within a couple of viewports of the top
    Then the previous turn is asked for before the top is on screen

  @integration
  Scenario: Scrolling up past the top loads the previous turn
    Given the terminal opened on a later turn of a session
    When the reader scrolls upward into the top of the transcript
    Then the previous turn's entries appear above a turn divider
    And the row the reader was looking at stays where it was

  @integration
  Scenario: A prepend never yanks the reader to the bottom
    Given a turn short enough that the reader is at the bottom of it
    When an earlier turn is prepended above it
    Then the screen stays where the reader left it instead of following the tail

  # A context note says the context crossed into a bigger size band, which is a
  # comparison against the call BEFORE the crossing. While earlier turns are
  # still unloaded that call is unknown, and a note drawn from a guess gets
  # redrawn when the truth arrives: the note the reader was looking at vanishes
  # and the transcript under it shifts. A note is only drawn once the call
  # before it is on screen, so loading history can only ever add lines above
  # the reader, never remove one below them.

  @integration
  Scenario: A context note below the reader survives earlier turns loading
    Given the loaded transcript starts mid-session with its context already grown
    When an earlier turn is loaded above it
    Then no context note below the loaded turn appears or disappears

  @integration
  Scenario: A context note waits for the call before it
    Given the loaded transcript starts mid-session with its context already grown
    When the notes are derived before the previous turn is loaded
    Then no note claims the crossing happened at the first loaded call

  @integration
  Scenario: Reaching the first turn shows the session start
    Given the terminal has walked back to the session's first turn
    When the reader reaches the top of the transcript
    Then the session start is marked and no further turns are offered

  @integration
  Scenario: A trace outside any conversation shows no scrollback
    Given a trace that belongs to no coding agent session
    When the Terminal tab renders it
    Then the session banner is at the top and no earlier turns are offered

  @integration
  Scenario: A failed earlier-turn load offers a retry
    Given the previous turn's transcript could not be read
    When the reader reaches the top of the transcript
    Then the failure is stated on one line and clicking it tries again

  @integration
  Scenario: The cumulative footer counts every loaded turn
    Given an earlier turn was loaded above the opened turn
    When the reader reads the bottom bar
    Then the step count covers the earlier turn's beats as well

  # The bottom bar reports what the session had cost by the beat the reader is
  # on. That accumulation starts at turn one of the SESSION, not at the oldest
  # turn that happens to be loaded: the turns above the loaded window carry
  # their totals in the session's turn list, so the bar can count them without
  # loading their transcripts, and loading one moves nothing.

  @integration
  Scenario: The footer counts the whole session up to the reader's position
    Given the terminal opened on the last turn of a long session
    When the reader reads the bottom bar
    Then the cost and tokens cover every earlier turn of the session
    And the elapsed time is measured from the session's first turn

  @integration
  Scenario: Loading an earlier turn does not change the footer's totals
    Given the bottom bar reports the totals at the reader's position
    When an earlier turn is loaded above the reader
    Then the cost, tokens, and elapsed time at that position stay the same

  @unit
  Scenario: The turn list carries each turn's cost and tokens
    Given a session whose turns are listed by the conversation read
    When a turn of the session is listed
    Then it carries the turn's total tokens and total cost

  # Agents inject blocks into the user's message that the human never typed: a
  # monitor firing, a hook's system reminder, a queued task notification. Printed
  # verbatim behind the prompt caret they read as the reader's own words, which
  # is both wrong and unreadable. They are notes about the session, so they are
  # drawn like the session's other notes, collapsed to one line.

Rule: An injected notification reads as a note, not as the user's words

  @integration
  Scenario: A task notification collapses to one gray line naming its summary
    Given a user message that is a task notification block with a summary
    When the Terminal tab renders that message
    Then the notification is one collapsed note naming its summary
    And no prompt caret claims it as something the user typed
    And expanding the note shows the block as it arrived

  @integration
  Scenario: A mixed message keeps the human words as the prompt
    Given a user message with an injected block above the words the human typed
    When the Terminal tab renders that message
    Then the injected block is a collapsed note
    And the human words are shown as the prompt

  @unit
  Scenario: A plain system notification marker is drawn back too
    Given a user message that opens with the system notification marker
    When the message is classified
    Then the whole message is one notice and nothing is left as the prompt
