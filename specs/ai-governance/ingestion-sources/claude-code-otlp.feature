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
  # What Claude Code actually emits (locked from Ariana's payload capture)
  # -------------------------------------------------------------------
  # Per docs at code.claude.com/docs/en/monitoring-usage, Claude Code
  # emits OTLP **metrics + logs/events by default**; traces are
  # beta-gated behind CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1. The v0
  # receiver path therefore needs metrics support — not just the
  # existing traces path. Cost is a first-class signal: no list-price
  # equivalent guessing, no per-token catalog lookup needed.
  #
  # Concrete signals:
  #   Metric `claude_code.cost.usage`     (USD counter; attrs: model,
  #                                        query_source, speed, effort)
  #   Metric `claude_code.token.usage`    (token counter; attrs: type =
  #                                        input|output|cacheRead|cacheCreation)
  #   Event  `claude_code.api_request`    (per call: model, cost_usd,
  #                                        duration_ms, input_tokens,
  #                                        output_tokens, cache_read_tokens,
  #                                        cache_creation_tokens, request_id,
  #                                        speed, query_source, effort)
  #
  # Attribution attrs on every signal:
  #   organization.id      Anthropic org UUID (OAuth)
  #   user.account_uuid    Anthropic-tagged form `user_01BWBe…`
  #   user.email           when OAuth-authed → maps directly to LangWatch user
  #   user.id              anonymous device id
  #   session.id, app.version, terminal.type
  #
  # Custom dimensions: admins can layer `OTEL_RESOURCE_ATTRIBUTES=
  # team.id=platform,cost_center=eng-123` on the env block; those land
  # as resource attributes and slot into LangWatch's principal/team
  # scope filters for free.

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
      | metricsEndpoint  | https://app.langwatch.ai/api/ingest/otel-metrics/{sourceId} |
      | ingestSecret     | lw_is_…                                                |
      | exporterEnvBlock | shell-ready copy-paste                                 |
    And the exporterEnvBlock includes every env var Claude Code
      needs per its monitoring-usage doc:
      | CLAUDE_CODE_ENABLE_TELEMETRY    | 1                                          |
      | OTEL_METRICS_EXPORTER           | otlp                                       |
      | OTEL_LOGS_EXPORTER              | otlp                                       |
      | OTEL_EXPORTER_OTLP_PROTOCOL     | http/json (or http/protobuf, both accepted) |
      | OTEL_EXPORTER_OTLP_ENDPOINT     | the endpoint above                         |
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
  # Open questions (locked when Ariana's live capture artifact lands)
  # -------------------------------------------------------------------
  # 1. Exact OTLP/HTTP body shape for metrics. Sergey to mirror the
  #    receiver shape against the captured bytes.
  # 2. Whether Claude Code respects the `OTEL_EXPORTER_OTLP_*` env
  #    vars per-signal (METRICS / LOGS / TRACES suffixed) or only the
  #    base. The exporterEnvBlock template adapts once we know.
  # 3. Whether `claude_code.api_request` lands as an OTel log_record
  #    (use logCollection) or as a span (use trace pipeline). Decides
  #    the handoff target inside the receiver.
