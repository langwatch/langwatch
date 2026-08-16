Feature: Codex Path B recovers the full request body from the rollout transcript

  Codex's native OTLP spans (scope codex_cli_rs) carry tokens, model, and
  timing but NO content: the system prompt, the prompt, the tool calls, and the
  assistant reply never reach the wire. Codex DOES persist the full transcript
  to disk at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionid>.jsonl, and
  each turn's `task_started` event records the very OTLP trace_id codex used for
  that turn's spans. The wrapper replays the rollout (the running conversation
  state) into an accumulating chat history and, for each turn, emits one OTLP
  span on codex's own trace_id carrying the full request body as a langwatch
  chat_messages envelope (system prompt + every prior message + the current
  prompt + tool calls) plus the assistant's final reply. The span joins the
  existing token-spans on the same trace, so the trace renders the same full
  conversation a claude trace does, with zero receiver changes.

  Because the rollout is append-only, the wrapper does not wait for exit: it
  polls the rollout while the session runs and emits each turn the moment that
  turn completes, with a single final sweep on exit. Content therefore streams
  in per turn instead of arriving as one large upload at the end, and a long
  session never lands a multi-megabyte burst when it closes. The per-turn span
  id is derived from the turn's trace_id, so re-emitting the same turn is
  idempotent (the ingest dedups), which makes the poll-then-final-sweep safe.

  Background:
    Given a wrapped `langwatch codex` session running in Path B (direct OTLP)

  @unit
  Scenario: A single-turn rollout yields the request body as chat messages on the turn's trace
    Given a rollout whose task_started records trace_id "abc123" and turn_id "t1"
    And the user message is "list the files" and the assistant reply is "a.txt b.txt"
    When the rollout is parsed
    Then one turn is produced with traceId "abc123", a user message "list the files", and output "a.txt b.txt"

  @unit
  Scenario: The developer message becomes the system prompt in the request body
    Given a rollout turn whose first response_item is a "developer" role message
    When the rollout is parsed
    Then the developer message is the system message at the head of the request body

  @unit
  Scenario: The environment_context is preserved in the request body but the prompt is the headline
    Given a rollout turn whose first user response_item is an "<environment_context>" block
    And whose second user response_item is "fix the bug"
    When the rollout is parsed
    Then both messages are in the request body and the last user message is "fix the bug"

  @unit
  Scenario: A multi-turn rollout accumulates prior turns into each turn's request body
    Given a rollout with two task_started events for trace_ids "t-one" and "t-two"
    When the rollout is parsed
    Then two turns are produced and the second turn's request body folds in the first turn's exchange

  @unit
  Scenario: Tool calls and their results are captured in the request body
    Given a rollout turn with a function_call "exec_command" and its function_call_output
    When the rollout is parsed
    Then the request body carries an assistant tool_call and a tool message with the output

  @unit
  Scenario: Tool calls are captured whichever way codex spelled them
    Given a rollout turn whose tool call and result use the custom_tool_call spelling
    When the rollout is parsed
    Then the request body carries the tool call and its output just as for a function_call

  @unit
  Scenario: A tool result returned as content blocks reads as its text
    Given a rollout turn whose tool result is a list of content blocks rather than a string
    When the rollout is parsed
    Then the tool message carries the text the command printed, not a serialised blob

  @unit
  Scenario: An id-less tool call and its output share one synthetic id so they still pair
    Given a rollout turn whose function_call and function_call_output both omit the call_id
    When the rollout is parsed
    Then the assistant tool_call and the tool message carry the same synthetic id

  @unit
  Scenario: A synthetic tool-call id does not leak across the turn boundary
    Given a turn with an id-less function_call whose output never arrives, followed by a later turn with its own id-less function_call_output
    When the rollout is parsed
    Then the later turn's tool message does not pair to the previous turn's orphaned tool_call id

  @unit
  Scenario: The assistant final answer is taken from the agent_message when present
    Given a rollout turn with an agent_message of phase "final_answer" and message "done"
    When the rollout is parsed
    Then the turn output is "done" and the raw scaffold assistant message is excluded from the input

  @unit
  Scenario: A turn with no assistant reply is dropped rather than emitting an empty span
    Given a rollout turn that has a user message but no assistant message or agent_message
    When the rollout is parsed
    Then no turn is produced for that trace_id

  @unit
  Scenario: Parsed turns become OTLP spans carrying a chat_messages request body on the codex trace_id
    Given a parsed turn with traceId "abc123" and a system + user request body
    When the I/O spans are built for OTLP export
    Then the export contains a span with that trace_id, a chat_messages langwatch.input, and langwatch.span.type "llm"

  Rule: completed turns stream during the session, not as one upload on exit

    @unit
    Scenario: A completed turn is streamed mid-session and only its content is posted
      Given a streamer watching the session's rollout directory
      And the rollout so far holds one completed turn for trace_id "t-one"
      When the streamer harvests
      Then it posts one span for trace_id "t-one"

    @unit
    Scenario: A turn is not streamed until its assistant reply lands
      Given a streamer watching the session's rollout directory
      And the rollout's only turn has a user message but no assistant reply yet
      When the streamer harvests
      Then it posts nothing
      And when the assistant reply is appended and the streamer harvests again it posts that turn

    @unit
    Scenario: Re-harvesting an already-streamed turn posts nothing
      Given a streamer that has already streamed the turn for trace_id "t-one"
      When a later turn for trace_id "t-two" completes and the streamer harvests
      Then it posts only "t-two", never re-posting "t-one"

  Rule: the harvest reports the repository the session worked on

    Codex records the session's directory, branch and remote once, in the
    rollout's session_meta line, and exports none of them over telemetry. The
    harvest reads them back and posts one session-context record, the same
    record the claude hook sends, so a codex session names its repository and
    branch (which is what links it to its pull request) with no hooks.json
    entry and no per-hook trust grant.

    @unit
    Scenario: The harvest reports the repository the session worked on
      Given a rollout whose session_meta names a remote and a branch
      When the completed turn is harvested
      Then one session-context record posts beside the conversation
      And the codex session gains its repository and branch

    @unit
    Scenario: A notify that fires after every turn posts the repository once
      Given a session whose context was already posted
      When the next turn completes and the harvest runs again
      Then no second session-context record posts while the context is unchanged

    @unit
    Scenario: A state directory that cannot be written still lets the conversation through
      Given a device whose langwatch state directory cannot be written
      When the completed turn is harvested
      Then the conversation and the session-context record both post
      # The stored fingerprint only saves a re-POST on the next turn, so
      # losing it must never cost the conversation.

    @unit
    Scenario: A session outside any repository posts its conversation and no context
      Given a rollout whose session_meta names no remote
      When the completed turn is harvested
      Then the conversation posts and no session-context record does

  Rule: the harvest names the session

    Codex generates no session title and its telemetry withholds prompt text,
    so without the harvest every codex session reads as untitled. The rollout
    records what the user typed as user_message events; the harvest puts the
    first typed prompt on the session-context record and the platform names
    the session from it.

    @unit
    Scenario: The harvest names the session by the first thing the user asked
      Given a rollout whose first user_message is a typed prompt
      When the completed turn is harvested
      Then the session-context record carries the prompt's first line as the session title

    @unit
    Scenario: A machine-injected first prompt does not name the session
      Given a rollout whose first user_message is injected context in a tag
      When the completed turn is harvested
      Then the session-context record carries no title
