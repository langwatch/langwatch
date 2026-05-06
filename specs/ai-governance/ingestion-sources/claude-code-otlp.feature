Feature: Claude Code OTLP ingestion source — extract usage + spend from
  Anthropic's OAuth-billed Claude Code traffic so anomaly rules and budgets
  can govern external (non-virtual-key) usage.

  As an admin who pays for Claude Code via an Anthropic OAuth seat
  (e.g. a 20x sub) and not via a LangWatch-issued virtual key, I still
  want spend + per-user attribution + anomaly alerts for that traffic,
  by pointing Claude Code's native OTLP exporter at a LangWatch
  ingestion source.

  Reference: https://code.claude.com/docs/en/monitoring-usage
  Pairs with: specs/ai-governance/puller-framework/http-polling.feature
  (the JSONPath eventMapping pattern for pull adapters; this spec is
  push-mode, no admin mapping authoring required for v0 because
  Claude Code's emission shape is well-defined and stable enough to
  bake in.)

  Background:
    Given an organization "ACME" with an enterprise license
    And admin Alex with `ingestionSources:manage` permission
    And the hidden Governance Project for ACME exists

  # -------------------------------------------------------------------
  # What Claude Code actually emits (locked to Ariana's payload capture
  # against Claude Code 2.1.129 OAuth-billed seat, 2026-05-06)
  # -------------------------------------------------------------------
  # Two OTLP/HTTP endpoint paths, both with JSON content-type (NOT
  # protobuf):
  #   POST /v1/logs    — events (claude_code.api_request, .user_prompt,
  #                      .mcp_server_connection, .hook_execution_*,
  #                      .internal_error)
  #   POST /v1/metrics — counters (claude_code.cost.usage,
  #                      claude_code.token.usage)
  #
  # Scopes inside the OTLP envelope: `com.anthropic.claude_code`
  # (metrics) + `com.anthropic.claude_code.events` (logs).
  #
  # Cost-bearing event — `claude_code.api_request` LogRecord:
  #   body.stringValue = "claude_code.api_request"
  #   timeUnixNano     = string nanoseconds
  #   attributes:
  #     event.name             = "api_request"
  #     event.sequence         = intValue (monotonic per session.id)
  #     event.timestamp        = ISO 8601 string
  #     model                  = "claude-opus-4-7" (NOT gen_ai.request.model)
  #     cost_usd               = doubleValue (e.g. 0.12528625)
  #     input_tokens           = intValue (NOT gen_ai.usage.input_tokens)
  #     output_tokens          = intValue
  #     cache_read_tokens      = intValue
  #     cache_creation_tokens  = intValue
  #     duration_ms            = intValue
  #     request_id             = "req_011CakjXP5x6Z…" (Anthropic API id)
  #     prompt.id              = uuid (Claude Code session-scoped)
  #     speed                  = "normal" | "fast" | …
  #     query_source           = "sdk" | "interactive" | …
  #     effort                 = "xhigh" | "high" | …
  #     user.email             = "rogerio@langwatch.ai"
  #     user.id                = anonymous device hash
  #     user.account_uuid      = uuid
  #     user.account_id        = "user_01RPBSwk…" (Anthropic-tagged)
  #     organization.id        = Anthropic org UUID (from OAuth)
  #     session.id             = Claude Code session uuid
  #     terminal.type          = "tmux" | "iterm" | …
  #
  # Cumulative cost metric — `claude_code.cost.usage`:
  #   Sum, monotonic, USD unit, aggregationTemporality=1 (DELTA — so
  #   each data point is an increment, not a running total)
  #   dataPoint.asDouble = USD delta
  #   dataPoint.attributes: model, query_source, speed, effort,
  #                          user.email, organization.id, …
  #   NOTE: model name is `claude-opus-4-7[1m]` here (1M-context
  #   suffix) vs the bare `claude-opus-4-7` on the event. Extractor
  #   should preserve both verbatim, NOT normalise — admins queries
  #   may want to slice by 1m vs base context.
  #
  # Resource attributes (set on every batch — applies to ALL signals
  # in the batch via OTLP's resource→scope→signal nesting):
  #   service.name      = "claude-code"
  #   service.version   = "2.1.129"
  #   host.arch         = "arm64"
  #   os.type           = "darwin"
  #   os.version        = "25.2.0"
  #   PLUS admin-layered OTEL_RESOURCE_ATTRIBUTES splits:
  #     team.id         = "ariana-zone-co"     (admin custom)
  #     cost_center     = "eng-dogfood"        (admin custom)
  #
  # Critical extractor invariant: principal + team attribution lives
  # at the RESOURCE level, not on the individual LogRecord/metric.
  # The receiver MUST walk resource→scope→signal and merge resource
  # attrs onto each downstream summary row. Naive "read attributes
  # off the LogRecord" won't surface user.email or team.id.

  # -------------------------------------------------------------------
  # Source creation + endpoint discovery
  # -------------------------------------------------------------------
  Scenario: Admin creates a Claude Code OTLP source and gets the wire info
    When Alex visits "/settings/governance/ingestion-sources" and clicks
      "Add ingestion source"
    Then the create drawer offers "Claude Code (OTLP)" as a push-mode
      source type
    And selecting it auto-detects Claude Code's emission shape — no
      mapping editor is shown for the happy path
    When Alex saves the source with name "claude-code-personal"
    Then the save response includes:
      | field            | shape                                                  |
      | endpoint         | https://app.langwatch.ai/api/ingest/otel/{sourceId}    |
      | ingestSecret     | lw_is_…                                                |
      | exporterEnvBlock | shell-ready copy-paste                                 |
    And the exporterEnvBlock contains exactly these env vars (matching
      the OTLP/HTTP endpoint convention — Claude Code suffixes
      `/v1/logs` and `/v1/metrics` itself):
      | CLAUDE_CODE_ENABLE_TELEMETRY    | 1                                          |
      | OTEL_METRICS_EXPORTER           | otlp                                       |
      | OTEL_LOGS_EXPORTER              | otlp                                       |
      | OTEL_EXPORTER_OTLP_PROTOCOL     | http/json                                  |
      | OTEL_EXPORTER_OTLP_ENDPOINT     | the endpoint above (no `/v1/*` suffix)     |
      | OTEL_EXPORTER_OTLP_HEADERS      | Authorization=Bearer lw_is_…               |
    And the drawer offers an OPTIONAL `OTEL_RESOURCE_ATTRIBUTES`
      builder that admins can use to layer team / cost_center tags
      onto every signal without typing the env-var syntax by hand

  # -------------------------------------------------------------------
  # Receive-time mapping — auto-detected, no admin authoring
  # -------------------------------------------------------------------
  Scenario: Cost extraction via the claude_code.cost.usage metric
    Given the source above is configured
    And Claude Code emits a metrics batch carrying
      `claude_code.cost.usage{model=claude-sonnet-4-5, query_source=interactive}`
      with delta value 0.042 USD
    When the receiver processes the metrics body
    Then the resulting summary row credits 0.042 USD against the source
    And the spend rolls up into /governance "Spend (30d)" with no
      catalog-lookup involved
    And `langwatch.cost.basis = "claude_code.cost.usage"` is stamped on
      the synthetic event so the trace viewer can show the derivation
      chain when admins debug a number

  Scenario: Token extraction via the claude_code.token.usage metric
    Given Claude Code emits
      `claude_code.token.usage{type=input, model=…}` value 1,234
      and `claude_code.token.usage{type=output, model=…}` value 567
    When the receiver processes the batch
    Then the trace summary fields `tokensInput` and `tokensOutput`
      hold 1234 and 567 respectively
    And cacheRead / cacheCreation token counts surface as their own
      `tokensCacheRead` / `tokensCacheCreation` fields (NOT folded into
      the input/output total — admins want to see cache-hit rates
      separately for cost optimisation)

  Scenario: Per-request audit via the claude_code.api_request event
    Given Claude Code emits a `claude_code.api_request` log/event with
      `cost_usd=0.042 model=claude-sonnet-4-5 input_tokens=1234
       output_tokens=567 request_id=req_abc duration_ms=2410`
    When the receiver processes the log batch
    Then a per-request row lands in trace_summaries
    And the trace viewer drill-down shows `request_id=req_abc` so admins
      can correlate with Anthropic's own dashboards
    And the event passes through OtlpSpanPiiRedactionService as today

  # -------------------------------------------------------------------
  # Attribution — user / org / team carries through
  # -------------------------------------------------------------------
  Scenario: User attribution from Claude Code's OAuth context
    Given Bob's Claude Code is authenticated against Anthropic OAuth as
      bob@acme.test
    And Claude Code emits any of the signals above with attribute
      `user.email=bob@acme.test`
    When the receiver processes the batch
    Then the resulting summary row carries `langwatch.user_id=bob@acme.test`
    And /governance "spendByUser" attributes the spend to Bob without
      any custom mapping configuration

  Scenario: Team attribution via OTEL_RESOURCE_ATTRIBUTES
    Given Alex set `OTEL_RESOURCE_ATTRIBUTES=team.id=platform,
      cost_center=eng-123` in the env block
    When Bob runs Claude Code with that env
    Then every emitted signal carries the `team.id` and `cost_center`
      resource attributes
    And /governance "spendByTeam" attributes the spend to "platform"
    And custom dimensions are queryable via the trace viewer's filter UI

  # -------------------------------------------------------------------
  # End-to-end with the user's actual Claude Code workflow
  # -------------------------------------------------------------------
  Scenario: User runs Claude Code with the env block — usage shows up
    Given Alex has copied the exporterEnvBlock into the Claude Code shell
    And user Bob runs `claude` with those env vars set (no langwatch CLI
      wrapper — Bob's Claude Code is OAuth-authed against his personal
      Anthropic seat, NOT against a LangWatch-issued virtual key)
    And Bob completes a 3-message conversation
    Within 60 seconds:
    Then /governance dashboard's "Spend (30d)" reflects the
      claude_code.cost.usage delta for that traffic
    And /governance dashboard's "active users" counts Bob
    And /governance "Recent activity" lists the per-request rows
      with model name "claude-sonnet-4-5" and request_id
    And the source row's "events received" counter increments

  # -------------------------------------------------------------------
  # Anomaly rules + budgets work against ingestion-source spend
  # -------------------------------------------------------------------
  Scenario: spend_spike anomaly fires on Claude Code OTLP traffic
    Given Alex has saved a spend_spike rule scoped to the Claude Code source
    And there is a 7-day baseline with a $5/day median
    When Bob's daily usage spikes to $50 (10× over baseline)
    Then the anomaly detector evaluates the rule against the
      ingestion-source-origin spend (NOT just gateway-origin spend)
    And an anomaly_alert row is created
    And the anomaly is visible on the governance dashboard's
      "Recent anomalies" panel
    And the alert payload references the contributing spans / metrics

  Scenario: GatewayBudget honors ingestion-source spend
    Given Alex has saved a $50/month organization-scope budget
    And gateway traffic this month totals $20
    And Claude Code OTLP traffic this month totals $40
    When the budget snapshot recomputes
    Then the budget shows $60/$50 spent (over)
    And the budget-exceeded UI shows which sources contributed (so
      admins can decide whether to throttle the gateway VK or revoke
      the OTLP source's ingestSecret)

  # -------------------------------------------------------------------
  # Cross-cutting concerns
  # -------------------------------------------------------------------
  Scenario: Source disable kills further OTLP ingest immediately
    Given the Claude Code source has `disabledAt` set
    When Bob's Claude Code instance posts a fresh OTLP batch
    Then the receiver returns 401 unauthorized (treats the bearer as
      revoked)
    And no trace_summaries row is written
    And the source row's "events rejected" counter increments

  Scenario: PII in chat content is redacted per the source's retention class
    Given the source's retention class is "thirty_days"
    And Bob's prompt includes a credit-card number
    When the OTLP body lands
    Then the existing OtlpSpanPiiRedactionService runs against the trace
      (same as gateway path — origin doesn't change PII handling)
    And the redacted content shows in /governance's trace viewer with
      the redaction banner already documented at
      "/ai-governance/pii-redaction"

  Scenario: Unknown OTel attribute keys pass through without rejection
    Given Claude Code ships a new attribute (e.g. `claude_code.future_flag`)
      in a future release that the v0 mapper doesn't know about
    When the receiver processes the batch
    Then the unknown attribute is preserved on the trace_summaries row
      under the generic Attributes map
    And the receiver does NOT fail the whole batch on it
    And the trace viewer shows the unknown attribute alongside known
      ones so admins can iterate without a code change

  # -------------------------------------------------------------------
  # Decisions locked from Ariana's 2026-05-06 capture
  # -------------------------------------------------------------------
  # 1. Body shape: standard OTLP/HTTP JSON envelope —
  #    `{ resourceLogs: […], resourceMetrics: […] }`. Sergey's receiver
  #    extends `parseOtlpRequest` to walk all three of resourceSpans,
  #    resourceLogs, resourceMetrics from the same envelope.
  # 2. Claude Code uses the BASE `OTEL_EXPORTER_OTLP_ENDPOINT` and
  #    suffixes `/v1/logs` and `/v1/metrics` itself. No per-signal
  #    `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` override needed in the
  #    happy path. Receiver routes by sub-path.
  # 3. `claude_code.api_request` is an OTel LogRecord (handoff via
  #    `getApp().traces.logCollection.handleOtlpLogRequest`). Span
  #    pipeline only fires for the trace beta variant.
  #
  # Open: behaviour when admin has BOTH the gateway VK path AND the
  # ingestion source path active for the same Anthropic seat (double-
  # counting risk). Probably out of scope for v0 — admins pick one or
  # the other; Lane-S adds a dedup invariant in a follow-up if it
  # becomes a real customer issue.
