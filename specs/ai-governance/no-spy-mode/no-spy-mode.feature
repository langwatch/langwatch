Feature: Gateway no-spy mode (governanceLogContentMode)
  As an org admin operating under a "no employee chat surveillance" policy
  I want a setting that completely drops gateway-emitted prompt + completion
  + system-message payloads from spans BEFORE they hit ClickHouse
  So that "we cannot read employee conversational content" is enforced by the
  pipeline, not by trust + later cleanup

  Three modes per `Organization.governanceLogContentMode`:
    - "full"        (default) — all content stored in CH (current behavior)
    - "strip_io"    — drop prompt + completion + system messages BEFORE CH write
    - "strip_all"   — strip_io + tool-call args + tool-result payloads

  Defense-in-depth: source-of-truth event_log keeps the raw event for the
  gateway-internal pipeline (the org explicitly trusts the pipeline; the
  no-spy guarantee is "no human-readable content in the searchable trace
  store"). The CH-stored span attributes are what employees can be searched
  against.

  Spec maps to Phase 9 backend (Sergey: P9-schema, P9-strip-service,
  P9-pipeline-wire, P9-int-test) + UI (Alexis: P9-ui) + docs (Andre: P9-docs).

  Background:
    Given organization "acme" exists with `governanceLogContentMode = "full"` (default)
    And alice is an org ADMIN of "acme"

  Scenario: Default mode (full) preserves all content
    When a gateway request through "acme" emits a span with `gen_ai.prompt.0.content = "summarize Q3 numbers"` and `gen_ai.completion.0.content = "Revenue grew 12%..."`
    Then the recorded_spans row in CH carries both fields verbatim
    And `SELECT SpanAttributes FROM recorded_spans WHERE TenantId = 'acme'` shows the strings

  Scenario: strip_io drops prompt + completion + system messages
    Given alice updates `Organization.governanceLogContentMode = "strip_io"`
    When a gateway request through "acme" emits a span with `gen_ai.prompt.0.content = "summarize Q3 numbers"` + `gen_ai.completion.0.content = "Revenue grew 12%..."` + `gen_ai.system_message.content = "You are a helpful assistant"`
    Then the recorded_spans row in CH has those 3 fields stripped (empty string OR field absent)
    And `SELECT SpanAttributes FROM recorded_spans WHERE TenantId = 'acme'` does NOT contain "summarize Q3 numbers" anywhere
    And the span still carries all OTHER attributes (model name, token counts, latency, cost, etc.) so debugging + cost attribution + governance still work

  Scenario: strip_all also strips tool-call payloads
    Given alice updates `Organization.governanceLogContentMode = "strip_all"`
    When a gateway request through "acme" emits a span with `gen_ai.tool_call.0.arguments = '{"query": "weather in Tokyo"}'` + `gen_ai.tool_result.0.content = "27°C, sunny"`
    Then the recorded_spans row in CH has tool_call.arguments + tool_result.content stripped
    And `SELECT SpanAttributes FROM recorded_spans WHERE TenantId = 'acme'` contains neither "weather in Tokyo" nor "27°C, sunny"

  Scenario: Cross-org isolation
    Given organization "acme" has mode `strip_io`
    And organization "globex" has mode `full`
    When two concurrent gateway requests fire — one through acme, one through globex
    Then acme's span has the content stripped in CH
    And globex's span retains the content in CH
    And the strip filter does not leak across tenants

  Scenario: Non-gateway-origin spans untouched
    Given organization "acme" has mode `strip_io`
    When a customer's own application sends a trace via `/api/otel/v1/traces` with `gen_ai.prompt.0.content = "hello world"`
    Then the recorded_spans row keeps the content (we don't strip user-app traces, only gateway-emitted ones — origin discriminator is `langwatch.origin.kind`)

  Scenario: Mode flip applies on next request, no historical rewrite
    Given "acme" has mode `full` and 100 historical spans with content stored
    When alice flips mode to `strip_io`
    Then the 100 historical spans remain unchanged (no retroactive scrubbing in this slice)
    And the very next gateway request emits a stripped span
    And docs explicitly note: "Mode change is forward-looking only; historical content remains stored. To purge, see retention policies."

  Scenario: Permission gate
    When bob (org MEMBER) calls `api.organization.update({ governanceLogContentMode: "strip_io" })`
    Then the call returns FORBIDDEN — only org ADMIN can change the privacy mode
