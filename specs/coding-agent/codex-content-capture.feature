Feature: Codex conversation capture without the LangWatch wrapper

  Codex never puts conversation content on the wire. Its OpenTelemetry export
  carries tokens, model and timing; the prompt, the tool calls and the
  assistant reply are dropped before export, and no codex setting turns them
  on. Codex does write the whole conversation to an append-only rollout
  transcript, and each turn there records the exact trace id codex used for
  that turn's spans.

  Recovering that transcript is already solved for sessions launched as
  `langwatch codex`. This feature covers the sessions that are not: once
  capture is enabled, codex is configured to keep emitting telemetry on its
  own, so a plain `codex` produces traces with token counts and nothing to
  read. Codex runs a program of the user's choosing after every completed
  turn, and that is the hook this feature uses to recover the conversation for
  those sessions.

  # --- What the user gets ---------------------------------------------------

  @unit
  Scenario: A session run without the wrapper still records the assistant reply
    Given a codex session that ran without the LangWatch wrapper
    When the completed turn is harvested
    Then the turn's assistant reply is recorded on the trace

  @unit
  Scenario: The recovered turn carries the prompt and the tool calls, not just the reply
    Given a codex turn that asked a question and ran a tool before answering
    When the completed turn is harvested
    Then the recorded conversation contains the user's prompt, the tool call and its result

  @unit
  Scenario: The recovered conversation lands on the trace codex already reported tokens on
    Given a codex turn whose transcript records the trace id codex used for that turn
    When the completed turn is harvested
    Then the conversation is recorded against that same trace rather than a new one

  @unit
  Scenario: A turn that has not been answered yet records nothing
    Given a codex turn that has started but has no assistant reply yet
    When the completed turn is harvested
    Then nothing is recorded for that turn

  @unit
  Scenario: Harvesting the same turn twice does not duplicate the conversation
    Given a codex turn that has already been harvested
    When the same turn is harvested again
    Then the trace still shows the conversation once

  # --- Reading it back ------------------------------------------------------

  @unit
  Scenario: The terminal view replays a recovered codex session
    Given a codex trace whose conversation was recovered
    When the session transcript is derived
    Then the terminal shows the prompt, the tool call and the reply instead of reporting no content

  @unit
  Scenario: A recovered turn does not inflate the session's model call count
    Given a codex trace whose conversation was recovered
    When the session transcript is derived
    Then the model calls counted are codex's own, not one per recovered turn

  @unit
  Scenario: A multi-turn session shows each prompt once
    Given a codex session of two turns, where each turn re-sends the whole conversation
    When the session transcript is derived
    Then the first prompt and reply appear once, not once per turn

  @unit
  Scenario: Context the agent injected under the user's name is not shown as their prompt
    Given a recovered codex turn whose first user message is the agent's own plugin and environment listing
    When the session transcript is derived
    Then that listing sits in the session context and the user's prompt is the first thing they said

  # --- Finding the right session --------------------------------------------

  @unit
  Scenario: The finished turn identifies its own session
    Given a turn-completion payload naming the session that just finished
    When the harvest resolves which transcript to read
    Then it reads that session's transcript and no other

  @integration
  Scenario: A turn-completion payload that cannot be read falls back to recent sessions
    Given a turn-completion payload that is missing or unreadable
    When the harvest resolves which transcript to read
    Then it falls back to the sessions written recently rather than giving up

  # --- Configuring codex to call us -----------------------------------------

  @unit
  Scenario: Enabling capture asks codex to run the harvest after every turn
    Given a user enabling codex capture
    When the codex configuration is written
    Then codex is configured to run the harvest when a turn completes

  @unit
  Scenario: The harvest hook is still readable when the configuration already has sections
    Given a codex configuration file that already contains other settings
    When the harvest hook is written into it
    Then codex reads the hook as a top-level setting rather than as part of another section

  @unit
  Scenario: Enabling capture twice leaves a single harvest hook
    Given a codex configuration that already has the harvest hook
    When capture is enabled again
    Then the configuration still has exactly one harvest hook

  @unit
  Scenario: A turn-completion program the user already had keeps running
    Given a codex configuration whose turn-completion program belongs to the user
    When the harvest hook is written into it
    Then the user's program still runs after every turn

  @unit
  Scenario: A turn-completion program written with shell quoting is moved aside verbatim
    Given a codex configuration whose turn-completion program is a shell command containing dollar signs
    When the harvest hook is written into it
    Then their command is quoted back character for character and the rest of the configuration is untouched

  @unit
  Scenario: A documented turn-completion example is not mistaken for the live one
    Given a codex configuration whose prose quotes a turn-completion program spelled exactly like the live one
    When the harvest hook is written into it
    Then the live program is the one moved aside and the prose stays prose

  @unit
  Scenario: Enabling capture again keeps the user's own program running
    Given a codex configuration where enabling capture already moved the user's program aside
    When capture is enabled again
    Then the user's program still runs after every turn, chained exactly once

  @unit
  Scenario: Turning capture off removes the harvest hook
    Given a codex configuration carrying the harvest hook
    When the user turns capture off
    Then the harvest hook is gone and the rest of the file is untouched

  # --- Never get in the way -------------------------------------------------

  @integration
  Scenario: A harvest that fails does not disturb the coding session
    Given a harvest that cannot reach LangWatch
    When codex runs it after a completed turn
    Then the harvest reports success to codex and prints nothing to the session

  @integration
  Scenario: Sessions already on disk can be captured after the fact
    Given codex sessions that completed before capture was enabled
    When the user backfills them
    Then their conversations are recorded on the traces codex reported at the time

  # --- Installing it, and saying what it does -------------------------------

  @unit
  Scenario: A device that already persisted its capture settings still gets the turn harvest
    Given a codex configuration whose capture settings were persisted on an earlier run
    When capture is enabled again
    Then the harvest hook is installed without asking the user anything

  @unit
  Scenario: A configuration the harvest cannot be merged into says so
    Given a codex configuration binding a turn-completion program that cannot be moved
    When capture is enabled
    Then the user is told the conversation will not be recorded

  @unit
  Scenario: Enabling capture from the install command needs no terminal
    Given a user running the codex capture install command with no terminal attached
    When the install finishes
    Then codex is configured to run the harvest after every turn, with no question asked

  # --- Saying so when nothing landed ----------------------------------------

  @integration
  Scenario: A conversation LangWatch rejects is not reported as recovered
    Given a backfill whose conversations LangWatch refuses
    When the user backfills them
    Then the failure is reported instead of a count of recovered turns

  @integration
  Scenario: A rejected ingest key reads as an authentication problem
    Given a codex configuration whose ingest key LangWatch no longer accepts
    When the user backfills
    Then the reported failure names the key and how to issue a new one

  @integration
  Scenario: A rejected turn still leaves the coding session alone
    Given a harvest whose conversation LangWatch refuses
    When codex runs it after a completed turn
    Then the harvest reports success to codex and prints nothing to the session

  # --- Reading a recovered session back without paying twice ------------------

  # A codex tool run is described three times over: inside the recovered
  # conversation, on codex's own tool span, and on its tool_result log. All
  # three name the same call, so the transcript owes the reader one entry and
  # one count for it, carrying whatever each of the three knows.

  @unit
  Scenario: A tool run recovered from the transcript and reported as a span is shown once
    Given a codex trace whose recovered conversation and tool spans describe the same tool call
    When the session transcript is derived
    Then that call is shown once and counted once

  @unit
  Scenario: The shown tool call keeps the timing and status only the span measured
    Given a codex trace whose recovered conversation and tool spans describe the same tool call
    When the session transcript is derived
    Then the call shown carries the duration and the failure the span recorded

  @unit
  Scenario: A prompt recovered from the transcript is not shown again as its redacted event
    Given a codex trace whose recovered conversation and prompt event describe the same prompt
    When the session transcript is derived
    Then the prompt is shown once, with its text, and the text-less event stays only where nothing was recovered

  @unit
  Scenario: A redacted prompt with no recovered turn behind it is kept
    Given a codex trace whose rollout recovery reached one of its two prompts
    When the session transcript is derived
    Then the recovered prompt is shown with its text, and the other prompt is
      still shown as its redacted event, because that event is the only record
      the prompt happened
    # The two are told apart by the character count: codex reports the real
    # length on the redacted event, so it matches the turn it belongs to.

  @unit
  Scenario: A prompt full of unclosed tags is read without stalling the server
    Given a recovered codex turn whose prompt pastes tens of thousands of unclosed tags
    When the session transcript is derived
    Then the transcript is derived promptly and the paste is shown as the user's own words
