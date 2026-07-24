Feature: OTTL-driven OTLP ingestion source — extract usage + spend
  from any OTLP-emitting tool (Claude Code, Codex, Gemini, Copilot
  Studio, custom in-house) by mapping its wire-specific attributes
  onto the canonical `langwatch.*` namespace, so anomaly rules and
  budgets can govern external (non-virtual-key) usage.

  As an admin who pays for a coding assistant via an upstream OAuth
  seat (Anthropic / OpenAI / Google) and not via a LangWatch-issued
  virtual key, I still want spend + per-user attribution + anomaly
  alerts for that traffic, by pointing the upstream tool's native
  OTLP exporter at a LangWatch ingestion source AND telling LangWatch
  how to read its wire shape via OTTL statements.

  Architecture: each ingestion source carries
  `parserConfig.ottlStatements: string[]` — OpenTelemetry
  Transformation Language lines that the aigateway evaluates (via
  embedded `pkg/ottl` from opentelemetry-collector-contrib) over
  every incoming OTLP payload. After transform, a single generic
  reader walks the canonical fields. Adding a new tool is a data-only
  PR: paste statements in the admin composer, ship.

  Reference: https://code.claude.com/docs/en/monitoring-usage
  Pairs with: specs/ai-governance/puller-framework/http-polling.feature
  (the JSONPath eventMapping pattern for pull adapters; this spec is
  push-mode, where the per-source mapping language is OTTL — closer
  in shape to what OTel tooling expresses natively.)

  Background:
    Given an organization "ACME" with an enterprise license
    And admin Alex with `ingestionSources:manage` permission
    And the hidden Governance Project for ACME exists
    And the aigateway's `/internal/validate-ottl` and `/internal/transform`
      endpoints are reachable from the control plane

  # -------------------------------------------------------------------
  # The canonical contract — what OTTL statements must produce
  # -------------------------------------------------------------------
  # Post-transform LogRecord attribute keys the receiver reads:
  #   langwatch.cost.usd                (double)
  #   langwatch.request_id              (string, idempotency key)
  #   langwatch.model                   (string)
  #   langwatch.input_tokens            (int)
  #   langwatch.output_tokens           (int)
  #   langwatch.cache_read_tokens       (int)
  #   langwatch.cache_creation_tokens   (int)
  #   langwatch.principal.email         (string, optional)
  #   langwatch.team.id_hint            (string, optional)
  #
  # Statements that emit any other key are not extracted. The
  # canonical names exist so a single per-source receiver path
  # handles every upstream tool without per-tool branches.

  # -------------------------------------------------------------------
  # Source creation — Use this template flow (claude_code)
  # -------------------------------------------------------------------
  Scenario: Admin creates a Claude Code source — clicks Use this template
    When Alex visits "/settings/governance/ingestion-sources" and clicks
      "Add ingestion source"
    And selects source type "Claude Code (OTLP)"
    Then the OTTL editor renders empty with a callout offering the
      canonical Claude Code template and a "Use this template" button
    When Alex clicks "Use this template"
    Then the editor populates with 9 statements that map Claude Code's
      wire shape onto the canonical namespace, one per output field,
      all gated on `attributes["event.name"] == "api_request"`
    And each statement passes validation (green dot per row)
    When Alex saves the source with name "claude-code-personal"
    Then the source row's `parserConfig.ottlStatements` matches the
      template byte-for-byte
    And the save response includes the OTLP endpoint URL +
      one-time ingest secret + shell-ready exporter env block

  # -------------------------------------------------------------------
  # Source creation — hand-rolled flow (otel_generic, future tools)
  # -------------------------------------------------------------------
  Scenario: Admin creates a generic OTLP source — empty editor, admin pastes own
    When Alex selects source type "Generic OTLP"
    Then the OTTL editor renders with zero statements and no starter
    When Alex pastes statements that map an in-house tool's
      `usage.cost_dollars` attribute to `langwatch.cost.usd` and
      `usage.req_id` to `langwatch.request_id`
    Then per-statement validation runs against the gateway's pkg/ottl
    And green dots indicate every line parsed successfully
    When Alex saves the source
    Then the receiver applies those statements at receive time without
      any code changes for the new tool

  Scenario: Admin pastes an OTTL statement with a syntax error
    Given Alex is editing OTTL statements on a new source
    When Alex enters `set(attributes["langwatch.cost.usd"], attribues["cost_usd"])`
      (typo: `attribues` vs `attributes`)
    Then the row shows a red dot with the gateway's parser error
      message and line/col coordinates
    And the Create button stays enabled — saving with a known-broken
      statement is allowed (admin's choice; receiver-time errors will
      surface in the source's events-rejected counter)

  # -------------------------------------------------------------------
  # Receive-time path — OTTL drives extraction
  # -------------------------------------------------------------------
  Scenario: Cost extraction via OTTL transform on a Claude Code payload
    Given the Claude Code source with the starter template is configured
    And Claude Code emits a `claude_code.api_request` LogRecord with
      `cost_usd=0.042`, `request_id=req_abc`,
      `model=claude-sonnet-4-5`, `input_tokens=1234`, `output_tokens=567`,
      `cache_read_tokens=200`, `cache_creation_tokens=10`,
      `user.email=bob@acme.test`, plus resource attribute `team.id=platform`
    When the receiver POSTs the payload + statements to
      aigateway `/internal/transform`
    Then the mutated payload carries the same record but with
      additional canonical attributes set:
      | langwatch.cost.usd              | 0.042                |
      | langwatch.request_id            | req_abc              |
      | langwatch.model                 | claude-sonnet-4-5    |
      | langwatch.input_tokens          | 1234                 |
      | langwatch.output_tokens         | 567                  |
      | langwatch.cache_read_tokens     | 200                  |
      | langwatch.cache_creation_tokens | 10                   |
      | langwatch.principal.email       | bob@acme.test        |
      | langwatch.team.id_hint          | platform             |
    And the canonical extractor reads those fields and writes one
      ledger row per applicable budget keyed by `request_id`

  Scenario: Starter template extracts canonical fields from a captured fixture
    Given a Claude Code source with the starter template is configured
    And a fixture batch from the 2026-05-06 capture (Claude Code 2.1.129)
    When the OTTL receiver path processes the fixture
    Then a ledger row lands carrying the per-request cost, model,
      input/output tokens, cache_read/cache_creation tokens, request_id,
      principal email, and team id_hint, sourced byte-faithfully from
      the OTLP attributes
    # This is the rchaves dogfood gate: "skip the claude code service
    # and use a generic OTLP + OTTL mapping done via the UI directly
    # and prove it works, then we can replace the claude code mapping".

  Scenario: New tool mapped purely via admin OTTL — no code change
    Given Alex has created a generic OTLP source named "Codex test"
    And Alex has pasted OTTL statements mapping Codex's wire shape:
      | set(attributes["langwatch.cost.usd"], attributes["openai.usage.cost_usd"]) where attributes["event.name"] == "completion" |
      | set(attributes["langwatch.request_id"], attributes["openai.response_id"]) where attributes["event.name"] == "completion"  |
      | set(attributes["langwatch.model"], attributes["openai.model"]) where attributes["event.name"] == "completion"             |
      | set(attributes["langwatch.input_tokens"], attributes["openai.usage.prompt_tokens"]) where attributes["event.name"] == "completion"     |
      | set(attributes["langwatch.output_tokens"], attributes["openai.usage.completion_tokens"]) where attributes["event.name"] == "completion" |
    When Codex emits a completion LogRecord at the source's endpoint
    Then the receiver folds the cost into the gateway budget rollup
      identically to a Claude Code event — no per-tool code path
      was needed

  Scenario: OTTL transform error mid-batch — receiver still acks, falls back
    Given a source has OTTL statements that parse but reference a key
      with a wrong type
    When the gateway returns `ok: false` with a per-statement error
    Then the receiver logs the error with sourceId + first error
      message
    And falls back to extracting against the un-mutated payload
      (which yields zero canonical fields, so zero ledger rows)
    And still returns 202 to the upstream — the trace pipeline
      handoff for forensic activity already happened, dropping the
      whole batch over an admin-side mapping bug would be louder than
      missing the spend rollup

  # -------------------------------------------------------------------
  # Attribution — OTTL maps principal + team
  # -------------------------------------------------------------------
  Scenario: User attribution from upstream OAuth context
    Given Bob's Claude Code is authenticated against Anthropic OAuth as
      bob@acme.test
    And Bob is a member of organization ACME with email bob@acme.test
    When Claude Code emits a request with `user.email=bob@acme.test`
    And the OTTL starter statement
      `set(attributes["langwatch.principal.email"], attributes["user.email"])`
      runs
    Then the resulting ledger row's `principal_user_id` resolves to
      Bob's User row by email match within the source's organization
    And /governance "spendByUser" attributes the spend to Bob

  Scenario: Team attribution via OTEL_RESOURCE_ATTRIBUTES + OTTL
    Given Alex set `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` in the
      env block on Bob's machine
    And the OTTL starter statement
      `set(attributes["langwatch.team.id_hint"], resource.attributes["team.id"])`
      runs
    When Bob runs Claude Code with that env
    Then the receiver carries `team.id_hint=platform` through the
      ledger row
    And /governance "spendByTeam" attributes the spend to "platform"

  # -------------------------------------------------------------------
  # End-to-end with the user's actual workflow
  # -------------------------------------------------------------------
  Scenario: User runs Claude Code with the env block — usage shows up
    Given Alex has copied the exporter env block from the source row
    And user Bob runs `claude` with those env vars set (no langwatch
      CLI wrapper — Bob's Claude Code is OAuth-authed against his
      personal Anthropic seat)
    And Bob completes a 3-message conversation
    Within 60 seconds:
    Then /governance dashboard's "Spend (30d)" reflects the spend for
      that traffic
    And /governance dashboard's "active users" counts Bob
    And /me dashboard's "Recent activity" lists per-request rows with
      model name and request_id
    And the source row's "events received" counter increments

  # -------------------------------------------------------------------
  # Anomaly rules + budgets work against ingestion-source spend
  # -------------------------------------------------------------------
  Scenario: spend_spike anomaly fires on OTTL-extracted traffic
    Given Alex has saved a spend_spike rule scoped to the Claude Code source
    And there is a 7-day baseline with a $5/day median
    When Bob's daily usage spikes to $50 (10× over baseline)
    Then the anomaly detector evaluates the rule against the
      ingestion-source-origin spend folded from canonical fields
    And an anomaly_alert row is created
    And the anomaly is visible on the governance dashboard's
      "Recent anomalies" panel

  Scenario: GatewayBudget honors ingestion-source spend
    Given Alex has saved a $50/month organization-scope budget
    And gateway traffic this month totals $20
    And ingestion-source traffic (extracted via OTTL) this month totals $40
    When the budget snapshot recomputes
    Then the budget shows $60/$50 spent (over)
    And the budget-exceeded UI shows which sources contributed

  # -------------------------------------------------------------------
  # Cross-cutting concerns
  # -------------------------------------------------------------------
  Scenario: Source disable kills further OTLP ingest immediately
    Given the source has `disabledAt` set
    When Bob's Claude Code instance posts a fresh OTLP batch
    Then the receiver returns 401 unauthorized (treats the bearer as
      revoked)
    And no ledger row is written
    And the source row's "events rejected" counter increments

  Scenario: PII in chat content is redacted on the ingest path
    Given Bob's prompt includes a credit-card number
    When the OTLP body lands
    Then the existing OtlpSpanPiiRedactionService runs against the
      trace handoff (same as gateway path — origin doesn't change PII
      handling)
    And the redacted content shows in the trace viewer with the
      redaction banner already documented at
      "/ai-governance/pii-redaction"

  Scenario: Unknown OTel attribute keys pass through
    Given an upstream tool ships a new attribute (e.g.
      `claude_code.future_flag`) that no statement targets
    When the receiver processes the batch
    Then the unknown attribute is preserved on the trace_summaries row
      under the generic Attributes map
    And the receiver does NOT fail the whole batch

  # -------------------------------------------------------------------
  # Decisions locked from rchaves's γ verdict (2026-05-06)
  # -------------------------------------------------------------------
  # 1. OTTL statements live on `IngestionSource.parserConfig.ottlStatements`
  #    — JSON column, no Prisma migration. Strings stored verbatim;
  #    parsing happens server-side in Go (pkg/ottl) at receive time.
  # 2. Validation is a tRPC mutation on the control plane that proxies
  #    to aigateway `/internal/validate-ottl`. Falls open ({ok:true})
  #    when the gateway is unreachable so the composer doesn't block
  #    on infra during dev — real syntax errors surface only when the
  #    gateway is up, but the alternative (busted-looking editor any
  #    time the gateway is down) is louder than the missed errors.
  # 3. Transform widens sergey's original contract from proto-only to
  #    {encoding: "proto"|"json", payload_b64} — Claude Code emits
  #    JSON OTLP/HTTP, and pdata supports both unmarshallers.
  # 4. Resource→scope→record attribute merge happens INSIDE the OTTL
  #    transform step (pkg/ottl's log context provides this natively),
  #    so canonical statements can target either log attrs OR resource
  #    attrs interchangeably — `resource.attributes["team.id"]` reads
  #    the same way `attributes["cost_usd"]` does.
  #
  # Open: behaviour when admin has BOTH the gateway VK path AND the
  # ingestion source path active for the same upstream seat (double-
  # counting risk). Out of scope for v1 — admins pick one or the
  # other; Lane-S adds a dedup invariant in a follow-up if it becomes
  # a real customer issue.
