Feature: Codex Path B recovers turn input/output from the rollout transcript

  Codex's native OTLP spans (scope codex_cli_rs) carry tokens, model, and
  timing but NO content: the prompt and the assistant reply never reach the
  wire. Codex DOES persist the full transcript to disk at
  ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionid>.jsonl, and each turn's
  `task_started` event records the very OTLP trace_id codex used for that
  turn's spans. After a wrapped `langwatch codex` session exits, the wrapper
  reads the rollout, pairs each turn's user prompt with the assistant's final
  message, and emits one OTLP span per turn carrying langwatch.input /
  langwatch.output on codex's own trace_id. The span joins the existing
  token-spans on the same trace, so the trace summary's computed input/output
  populate with zero receiver changes.

  Background:
    Given a wrapped `langwatch codex` session running in Path B (direct OTLP)

  @unit
  Scenario: A single-turn rollout yields one input/output pair on the turn's trace
    Given a rollout whose task_started records trace_id "abc123" and turn_id "t1"
    And the user message is "list the files" and the assistant reply is "a.txt b.txt"
    When the rollout is parsed
    Then one turn is produced with traceId "abc123", input "list the files", and output "a.txt b.txt"

  @unit
  Scenario: The synthetic environment_context user message is not treated as input
    Given a rollout turn whose first user response_item is an "<environment_context>" block
    And whose second user response_item is "fix the bug"
    When the rollout is parsed
    Then the turn input is "fix the bug" and excludes the environment_context block

  @unit
  Scenario: A multi-turn rollout produces one turn per task_started trace_id
    Given a rollout with two task_started events for trace_ids "t-one" and "t-two"
    When the rollout is parsed
    Then two turns are produced, one per trace_id, each with its own input and output

  @unit
  Scenario: The assistant final answer is taken from the agent_message when present
    Given a rollout turn with an agent_message of phase "final_answer" and message "done"
    When the rollout is parsed
    Then the turn output is "done"

  @unit
  Scenario: A turn with no assistant reply is dropped rather than emitting an empty span
    Given a rollout turn that has a user message but no assistant message or agent_message
    When the rollout is parsed
    Then no turn is produced for that trace_id

  @unit
  Scenario: Parsed turns become OTLP spans carrying langwatch input/output on the codex trace_id
    Given a parsed turn with traceId "abc123", input "hi", output "hello"
    When the I/O spans are built for OTLP export
    Then the export contains a span with that trace_id, langwatch.input "hi", langwatch.output "hello", and langwatch.span.type "llm"
