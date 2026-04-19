Feature: Gateway trace payload capture
  As a LangWatch customer whose traffic flows through the AI Gateway
  I want the option to capture LLM message content onto gateway spans
  So that my existing observability, evals, and dataset workflows work
  on gateway-routed traffic the same way they work on SDK-instrumented
  traffic — while respecting PII, compliance, and audit needs.

  Design: dev/docs/adr/017-gateway-trace-payload-capture.md
  Driven by: rchaves iter 107 dogfood ("no input, no output — I want
  to capture it all!!!") + ariana #73
  Scope: v1 (escalated from v1.1)

  Background:
    Given the LangWatch AI Gateway is routing /v1/chat/completions
    And the control plane provides PII redaction rules at the project level
    And an org-admin has set Org → Settings → gateway.payload_capture_enabled = true

  # ─────────────────────────────────────────────────────────────────────────
  # §1. capture_payload = none — default; current behavior
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: No VK config change — legacy VKs behave exactly as before
    Given a VK created before this feature shipped (no capture_payload field)
    When a consumer posts to /v1/chat/completions through the VK
    Then the resulting span carries langwatch.origin="gateway"
    And the span carries token/cost metadata (see feature #74)
    But the span does NOT carry langwatch.input or langwatch.output attributes

  Scenario: Explicit none is identical to absent
    Given a VK with capture_payload="none"
    When a request is sent
    Then the span does NOT carry langwatch.input or langwatch.output attributes
    And langwatch.payload_capture="none" is stamped for observability

  # ─────────────────────────────────────────────────────────────────────────
  # §2. capture_payload = metadata_only
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Metadata-only records shapes without content
    Given a VK with capture_payload="metadata_only"
    And a request body { "messages": [{ "role": "user", "content": "Hello, my SSN is 123-45-6789" }] }
    When the request completes
    Then the span carries langwatch.input = '[{"role":"user","content_length":30}]'
    And the span carries langwatch.output = '{"role":"assistant","content_length":42}'
    And the content itself is NOT present on the span
    And langwatch.payload_capture="metadata_only" is stamped

  # ─────────────────────────────────────────────────────────────────────────
  # §3. capture_payload = redacted (recommended production default)
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Redacted captures full content with PII removed at gateway
    Given a VK with capture_payload="redacted"
    And the project's PII rules include PERSON_NAME, PHONE_NUMBER, SSN
    And a request body { "messages": [{ "role": "user", "content": "Hi, I'm Alice, SSN 123-45-6789, phone 555-0100" }] }
    When the request completes and the assistant responds "Thanks Alice, I'll call 555-0100"
    Then the span's langwatch.input replaces the name, SSN, and phone with redaction markers
    And the span's langwatch.output replaces the name and phone with redaction markers
    And langwatch.input_redacted = true
    And langwatch.output_redacted = true
    And langwatch.payload_capture = "redacted"

  Scenario: Redaction happens in the gateway pod, not downstream
    Given a VK with capture_payload="redacted"
    When the request is mid-flight at the gateway
    And the redaction library is applied to the captured payload BEFORE the span is exported
    Then an SRE grabbing a gateway pod core-dump sees only redacted content
    # Defense-in-depth: trace pipeline also redacts, but gateway is the authoritative boundary

  Scenario: Redaction failure fails closed — span carries metadata_only
    Given a VK with capture_payload="redacted"
    When the redaction library errors mid-request (rules malformed, library panic)
    Then the span falls back to metadata_only for that request
    And langwatch.payload_capture_fallback = "redaction_error" is stamped
    And the request itself still succeeds — redaction failure MUST NOT fail user requests

  # ─────────────────────────────────────────────────────────────────────────
  # §4. capture_payload = raw — gated
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Raw capture requires explicit permission + acknowledgement
    Given an org admin without the "virtualKeys:capturePayload:raw" permission
    When they attempt to set capture_payload="raw" on a VK via UI or API
    Then the request returns 403 permission_denied
    And the VK remains on its previous capture level

  Scenario: Raw capture records full unredacted content when permission is granted
    Given an org admin with "virtualKeys:capturePayload:raw" permission
    And they have toggled the capture to "raw" with the confirmation checkbox checked
    When a request body contains PII
    Then the span's langwatch.input and langwatch.output contain the full unredacted content
    And langwatch.input_redacted = false
    And langwatch.output_redacted = false
    And an AUDIT_LOG entry (kind=VIRTUAL_KEY_UPDATED, field=capture_payload, after="raw") is emitted

  # ─────────────────────────────────────────────────────────────────────────
  # §5. Org kill switch overrides everything
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: gateway.payload_capture_enabled=false globally disables capture
    Given 10 VKs in "acme" org with capture_payload in ("metadata_only", "redacted", "raw")
    And an org admin flips Org → Settings → gateway.payload_capture_enabled to false
    When any request on any of those 10 VKs completes
    Then no span carries langwatch.input or langwatch.output for the next bundle refresh cycle (< 30 s)
    And langwatch.payload_capture = "disabled_by_org" is stamped
    And flipping the org setting back on restores per-VK capture behaviour

  # ─────────────────────────────────────────────────────────────────────────
  # §6. Streaming
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Streaming captures the reassembled final message
    Given a VK with capture_payload="redacted"
    When a streaming request produces 47 deltas that reassemble into "Hello! I'd love to help."
    Then the span carries one langwatch.output attribute = the full reassembled string (redacted)
    And individual stream chunks are NOT traced

  # ─────────────────────────────────────────────────────────────────────────
  # §7. Size cap
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Payload > 32 KB is truncated with a marker
    Given a VK with capture_payload="redacted"
    And a 64 KB input prompt
    When the request completes
    Then langwatch.input is truncated to 32 KB
    And langwatch.input_truncated = true is stamped
    And the UNtruncated payload still reaches the upstream provider (truncation is span-only)

  # ─────────────────────────────────────────────────────────────────────────
  # §8. Integration with LangWatch Evaluations
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Capture=redacted makes gateway traffic eligible for online evaluators
    Given a VK with capture_payload="redacted"
    And an online evaluator "answer-correctness" attached to the project
    When a /v1/chat/completions request completes with captured input + output
    Then the eval engine picks up the trace via langwatch.input + langwatch.output attrs
    And the evaluator runs and writes a score back to the trace — same path as SDK-instrumented traces

  Scenario: Capture=none blocks evaluator eligibility
    Given a VK with capture_payload="none"
    And an online evaluator attached to the project
    When a gateway request completes
    Then the eval engine skips the trace (no input/output to score) and records skip_reason="no_payload"

  # ─────────────────────────────────────────────────────────────────────────
  # §9. Default on new VK create
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: New VKs default to "none" — explicit opt-in principle
    When an org admin creates a new VK via Settings → Virtual Keys → New
    Then the capture_payload radio defaults to "none"
    And the "redacted" option carries an inline tooltip "Recommended — captures content after PII redaction, required for online evaluators"
    And the "raw" option is disabled unless the user has virtualKeys:capturePayload:raw
    # Rationale: opt-in respects least-surprise. Customers who want eval
    # integration actively choose redacted; customers who don't care keep
    # legacy behaviour.

  # ─────────────────────────────────────────────────────────────────────────
  # §10. Hot-path budget
  # ─────────────────────────────────────────────────────────────────────────

  # Hot-path overhead budget (per ADR-017):
  #   capture=none          — no added cost (no code branch reached)
  #   capture=metadata_only — ~50 µs (JSON string-length scan)
  #   capture=redacted      — 200 µs to 2 ms depending on content size
  #                           and active PII rules; dominates when enabled
  #   capture=raw           — ~100 µs (JSON stringify)
  # Acceptance test: p50 added latency on capture=redacted with a 4 KB
  # message and 6 default PII rules is under 1 ms on the same hardware
  # the sub-millisecond budget was measured on.

  # ─────────────────────────────────────────────────────────────────────────
  # §11. Out of scope for v1
  # ─────────────────────────────────────────────────────────────────────────

  # - Per-message-role capture levels (e.g. "capture user messages only")
  # - Inline regex redaction rules — reuse the project PII pipeline only
  # - Multi-modal payloads (image bytes); only text content is captured in v1
  # - Tool-call argument capture is covered (tool_calls[].function.arguments
  #   is treated like message content), but tool RESULT capture — when the
  #   tool runs client-side and returns via the next request — follows the
  #   same path: it's part of the subsequent request's messages[] array, so
  #   the same capture rules apply.
