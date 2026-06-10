Feature: AI Gateway Governance — Personal-Project Ingest via Template (end-to-end)
  As a personal-project user with a tool that has no LangWatch-side OAuth
  (e.g. Claude Code on Anthropic 20x subscription)
  I want to install the platform-published claude_code template, point my
  upstream tool at the ingest endpoint with an ingestion key, and see traces
  land in /me/traces with the canonical gen_ai.* shape — cost / tokens /
  model populated
  So that my personal-workspace observability matches the shape I'd get
  from a gateway-VK-proxied tool, without LangWatch participating in the
  upstream tool's OAuth flow

  Per gateway.md "client-side OAuth, server-side OTLP":
    Claude Code holds the user's Anthropic OAuth session locally.
    LangWatch never participates in that OAuth flow.
    The user's LangWatch-side credential is just an ingestion key
    (`sk-lw-<...>`) — an ApiKey scoped to one project with a write-only,
    ingest-only role — which they paste into OTEL_EXPORTER_OTLP_HEADERS.

  Per the locked contract:
    Receiver flow: prefix-discriminate `sk-lw` → apiKey verify → ceiling to
    ingest-only (traces:create) → tenantId = the key's bound project → apply
    template.ottlRules WITH principal-field guard (only when the key carries a
    templateId) → post-OTTL receiver-stamp authoritative attribution +
    provenance keys (langwatch.api_key.id, langwatch.origin derived from the
    key's ingestSourceType — coding_agent for a CLI assistant, ai_tool
    otherwise) → handoff to trace pipeline.

  Background:
    Given organization "acme" exists
    And user "jane@acme.com" has personal project "personal-jane"
    And the platform IngestionTemplate "claude_code" exists with canonical
        OTTL rules mapping anthropic.usage.* → gen_ai.usage.*
    And jane has installed the claude_code template, holding ingestion key
        `sk-lw-KEY_JANE` (bound to "personal-jane", carrying the claude_code
        templateId) and OTLP endpoint `https://app.langwatch.ai/v1/traces`

  # ---------------------------------------------------------------------------
  # Happy path — first personal trace
  # ---------------------------------------------------------------------------

  @bdd @personal-project-ingest @happy-path
  Scenario: Claude Code emits a trace; it lands at /me/traces with canonical shape
    Given jane has set OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer sk-lw-KEY_JANE"
    When jane runs Claude Code locally and it emits a span with attributes:
      | attribute                       | value                  |
      | gen_ai.system                   | "anthropic"            |
      | gen_ai.request.model            | "claude-3-5-sonnet"    |
      | anthropic.usage.input_tokens    | 1240                   |
      | anthropic.usage.output_tokens   | 380                    |
      | claude.code.session_id          | "abc123"               |
    Then the receiver:
      | step | action                                                        |
      | 1    | prefix-discriminates `sk-lw-*` → apiKey verification path       |
      | 2    | verifies the key (HMAC + pepper) → finds jane's ingestion key   |
      | 3    | ceilings to ingest-only (role grants only traces:create)       |
      | 4    | sets tenantId = "personal-jane" (the key's bound project)      |
      | 5    | applies template.ottlRules (anthropic.usage.* → gen_ai.usage.*) — the key carries the claude_code templateId |
      | 6    | post-OTTL stamps attribution + provenance keys (receiver-authoritative) |
      | 7    | handoff to trace pipeline                                      |
    And the trace lands at /me/traces with:
      | attribute                          | value (source)                                  |
      | gen_ai.usage.input_tokens          | 1240 (template OTTL output)                     |
      | gen_ai.usage.output_tokens         | 380 (template OTTL output)                      |
      | gen_ai.response.model              | "claude-3-5-sonnet" (template OTTL output)      |
      | langwatch.cost.usd                 | derived from canonicalCostExtractor (receiver)  |
      | langwatch.user.id                  | jane.id (receiver-stamped, NOT template-stamped)|
      | langwatch.project.id               | "personal-jane" (receiver-stamped)              |
      | langwatch.template.id              | claude_code-template-id (receiver-stamped)      |
      | langwatch.api_key.id               | jane's ingestion key id (receiver-stamped)      |
      | langwatch.origin                   | "coding_agent" (receiver-stamped, from source)  |
      | langwatch.source                   | "claude_code" (receiver-stamped post-OTTL)      |
    And the ingestion key's `lastUsedAt` is updated to the trace's timestamp

  # ---------------------------------------------------------------------------
  # Cost / tokens / model — receiver-derived from template OTTL outputs
  # ---------------------------------------------------------------------------

  @bdd @personal-project-ingest @cost-token-model
  Scenario: cost.usd > 0 AND token counts populated AND model name correct
    Given jane has fired one Claude Code trace through the ingestion key
    When the trace appears in /me/traces
    Then `gen_ai.usage.input_tokens` is greater than 0
    And `gen_ai.usage.output_tokens` is greater than 0
    And `langwatch.cost.usd` is greater than 0
    And `gen_ai.response.model` matches the upstream model the user ran
    # Cost is RECEIVER-derived via canonicalCostExtractor reading template-
    # OTTL-output gen_ai.usage.* + gen_ai.response.model. NOT template-written.
    # See template-ottl-principal-guard.feature for the protected-key invariant.

  # ---------------------------------------------------------------------------
  # Cross-user isolation — non-negotiable
  # ---------------------------------------------------------------------------

  @bdd @personal-project-ingest @cross-user-isolation
  Scenario: User A's traces are visible only on user A's /me/traces
    Given user "ben@acme.com" has personal project "personal-ben"
    And ben has installed claude_code, holding ingestion key `sk-lw-KEY_BEN`
    When jane fires 5 Claude Code traces using `sk-lw-KEY_JANE`
    And ben fires 3 Claude Code traces using `sk-lw-KEY_BEN`
    Then jane's /me/traces shows 5 traces (her ingestion keys only)
    And ben's /me/traces shows 3 traces (his ingestion keys only)
    And neither user sees the other's traces under any filter

  # ---------------------------------------------------------------------------
  # Source filter — langwatch.source is receiver-authoritative
  # ---------------------------------------------------------------------------

  @bdd @personal-project-ingest @source-filter
  Scenario: User can filter /me/traces by source slug
    Given jane has ingestion keys for both claude_code AND cursor
    And jane has fired 3 traces from each
    When jane filters /me/traces by `langwatch.source = "claude_code"`
    Then she sees the 3 claude_code traces
    But not the 3 cursor traces
    # `langwatch.source` is in protectedTemplateAttributeKeys — receiver-stamped
    # post-OTTL — so the filter is trustworthy regardless of template OTTL.
