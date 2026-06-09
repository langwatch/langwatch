Feature: Codex Path B recovers the full request body from the rollout transcript

  Codex's native OTLP spans (scope codex_cli_rs) carry tokens, model, and
  timing but NO content: the system prompt, the prompt, the tool calls, and the
  assistant reply never reach the wire. Codex DOES persist the full transcript
  to disk at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionid>.jsonl, and
  each turn's `task_started` event records the very OTLP trace_id codex used for
  that turn's spans. After a wrapped `langwatch codex` session exits, the
  wrapper replays the rollout (the running conversation state) into an
  accumulating chat history and, for each turn, emits one OTLP span on codex's
  own trace_id carrying the full request body as a langwatch chat_messages
  envelope (system prompt + every prior message + the current prompt + tool
  calls) plus the assistant's final reply. The span joins the existing
  token-spans on the same trace, so the trace renders the same full conversation
  a claude trace does, with zero receiver changes.

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
