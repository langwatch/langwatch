Feature: PII Guardrail tolerates typed-object inputs and null-payload event spans
  As a project owner relying on the Real-time PII Detection Guardrail
  I want the evaluator to handle SDK-typed-object inputs and feedback (track_event) spans without crashing
  So that PII detection keeps running on every trace shape instead of silently failing as a false negative

  Background:
    Given I am logged in
    And I have access to a project
    And the Real-time PII Detection Guardrail (presidio/pii_detection) is configured ON_MESSAGE for the project

  # ============================================================================
  # Bug 1 — typed-object inputs are unwrapped before reaching the evaluator
  # ============================================================================

  @integration @regression @unimplemented
  Scenario: Typed-object string input is unwrapped before being sent to langevals
    Given a trace whose latest span has input value `{ "type": "text", "value": "stockout" }` (the OTel value_types wrapper produced by the LangWatch SDK)
    And a trace whose latest span has output value `{ "type": "text", "value": "shipped" }`
    When the pipeline executes the presidio/pii_detection monitor for that trace
    Then the langevals evaluator receives `input` equal to the bare string "stockout"
    And the langevals evaluator receives `output` equal to the bare string "shipped"
    And the langevals evaluator does NOT receive a JSON-stringified wrapper such as `{"type":"text","value":"stockout"}`
    And the evaluation completes without an `Cannot convert undefined or null to object` error
    And the emitted EvaluationReportedEvent has status "processed"

  @unit @regression @unimplemented
  Scenario: tryAndConvertTo unwraps `{type, value}` objects when coercing to "string"
    Given a value `{ "type": "text", "value": "stockout" }`
    When tryAndConvertTo is called with target type "string"
    Then it returns the bare string "stockout"
    And it does NOT return a JSON-stringified representation of the wrapper

  @unit @unimplemented
  Scenario: tryAndConvertTo unwraps `{type, value}` objects regardless of the `type` discriminator
    Given a value `{ "type": "<any-string>", "value": "<primitive>" }` for any string discriminator
    When tryAndConvertTo is called with target type "string"
    Then it returns the bare value coerced to a string
    And the unwrap behaviour is shape-driven (own keys: `type` string, `value` any) rather than enumerated by `type`

  @unit @unimplemented
  Scenario: tryAndConvertTo unwraps each element when coercing typed-object arrays to "string[]"
    Given a value `[ { "type": "text", "value": "a" }, { "type": "text", "value": "b" } ]`
    When tryAndConvertTo is called with target type "string[]"
    Then it returns `["a", "b"]`

  @unit @unimplemented
  Scenario: tryAndConvertTo leaves non-wrapper objects stringified as before
    Given a value `{ "foo": "bar" }` that does NOT match the typed-object wrapper shape
    When tryAndConvertTo is called with target type "string"
    Then it returns the JSON-stringified form `{"foo":"bar"}`

  @unit @unimplemented
  Scenario: tryAndConvertTo leaves bare strings untouched
    Given a value "stockout" that is already a bare string
    When tryAndConvertTo is called with target type "string"
    Then it returns "stockout" unchanged

  # ============================================================================
  # Bug 1 sweep — every evaluator boundary that goes through tryAndConvertTo
  # benefits from the unwrap, not just presidio/pii_detection
  # ============================================================================

  @integration @unimplemented
  Scenario Outline: Every evaluator boundary using tryAndConvertTo unwraps typed-object inputs
    Given a trace whose latest span has input value `{ "type": "text", "value": "stockout" }`
    And a monitor configured for evaluator <evaluator>
    When the pipeline executes that monitor for the trace
    Then the langevals evaluator receives `input` equal to the bare string "stockout"
    And the call is not corrupted by a JSON-stringified wrapper

    Examples:
      | evaluator                 |
      | presidio/pii_detection    |
      | ragas/faithfulness        |
      | langevals/basic           |

  # ============================================================================
  # Bug 2 — feedback / event spans no longer trigger evaluator runs
  # ============================================================================

  @integration @regression @unimplemented
  Scenario: Appending a track_event (thumbs up/down) span does NOT re-fire the evaluator
    Given an existing trace that has already been evaluated by the presidio/pii_detection monitor
    When the user submits thumbs-up feedback that produces a `langwatch.track_event` synthetic span on that trace
    Then the evaluationTrigger reactor short-circuits before reading the project's enabled monitors
    And no executeEvaluation command is enqueued for the synthetic event span
    And no second failed-evaluation entry is recorded for that trace

  @unit @regression @unimplemented
  Scenario: evaluationTrigger reactor filters synthetic span events
    Given an inbound SpanReceivedEvent whose span name is in the SYNTHETIC_SPAN_NAMES set (e.g. "langwatch.track_event")
    When the evaluationTrigger reactor runs against that event
    Then the reactor returns without invoking the monitor service
    And no executeEvaluation command is dispatched

  @unit @unimplemented
  Scenario: evaluationTrigger reactor still runs for normal (non-synthetic) span events
    Given an inbound SpanReceivedEvent whose span name is NOT in SYNTHETIC_SPAN_NAMES
    When the evaluationTrigger reactor runs against that event
    Then the reactor proceeds to read enabled ON_MESSAGE monitors
    And dispatches an executeEvaluation command for each matching monitor

  @unit @unimplemented
  Scenario: alertTrigger reactor is unaffected by the synthetic-span filter
    Given the same `langwatch.track_event` SpanReceivedEvent
    When the alertTrigger reactor runs against that event
    Then the alertTrigger reactor still evaluates alert rules normally
    And the synthetic-span filter is scoped to the evaluation reactor only

  # ============================================================================
  # End-to-end: the affected user can re-enable the monitor without regressions
  # ============================================================================

  @integration @unimplemented
  Scenario: Re-enabling the PII Guardrail no longer produces failed evaluations on typed-object traces
    Given the Real-time PII Guardrail monitor was previously disabled for the affected project as a workaround
    And the project receives traces from the LangWatch Python SDK using `langwatch.span(input=..., output=...)` with plain string values (which the SDK auto-wraps as `{type:"text", value: "..."}`)
    When the operator re-enables the Real-time PII Guardrail monitor
    And new traces are processed
    Then no evaluation reports an error matching "Cannot convert undefined or null to object"
    And subsequent thumbs-up/thumbs-down feedback events do NOT produce additional failed-evaluation entries
    And the PII Guardrail produces normal "processed" results on those traces

# --- AC Coverage Map ---
# AC 1: "presidio/pii_detection unwraps OTel `value_types` objects to bare strings before passing to Presidio"
#   → Scenario: Typed-object string input is unwrapped before being sent to langevals
#   → Scenario: tryAndConvertTo unwraps `{type, value}` objects when coercing to "string"
#   → Scenario: tryAndConvertTo unwraps `{type, value}` objects regardless of the `type` discriminator
#   → Scenario: tryAndConvertTo unwraps each element when coercing typed-object arrays to "string[]"
#   → Scenario: tryAndConvertTo leaves non-wrapper objects stringified as before
#   → Scenario: tryAndConvertTo leaves bare strings untouched
#
# AC 2: "presidio/pii_detection short-circuits / no-ops on event spans with null input/output"
#   → Scenario: Appending a track_event (thumbs up/down) span does NOT re-fire the evaluator
#   → Scenario: evaluationTrigger reactor filters synthetic span events
#   → Scenario: evaluationTrigger reactor still runs for normal (non-synthetic) span events
#   → Scenario: alertTrigger reactor is unaffected by the synthetic-span filter
#
# AC 3: "Regression test covers the typed-object input path"
#   → Scenario: Typed-object string input is unwrapped before being sent to langevals (@regression)
#   → Scenario: tryAndConvertTo unwraps `{type, value}` objects when coercing to "string" (@regression)
#
# AC 4: "Regression test covers the null-input event-span path"
#   → Scenario: Appending a track_event (thumbs up/down) span does NOT re-fire the evaluator (@regression)
#   → Scenario: evaluationTrigger reactor filters synthetic span events (@regression)
#
# AC 5: "Sweep: any other evaluator with the same string-input shape that would fail under typed-object inputs"
#   → Scenario Outline: Every evaluator boundary using tryAndConvertTo unwraps typed-object inputs
#
# AC 6: "Real-time PII Guardrail monitor can be re-enabled for the affected user without further failed evaluations on the same trace shape"
#   → Scenario: Re-enabling the PII Guardrail no longer produces failed evaluations on typed-object traces
