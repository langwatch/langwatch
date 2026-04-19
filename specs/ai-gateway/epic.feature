Feature: LangWatch AI Gateway — Cross-cutting epic
  As a LangWatch customer (enterprise or self-hosted)
  I want a single API endpoint that governs every LLM call my org makes
  So that cost, compliance, observability, and reliability are enforced uniformly
  regardless of provider, model, or client SDK

  The epic scenarios here exist to prove the gateway's value proposition end-to-end.
  They compose the per-lane specs:
    - virtual-keys.feature (Lane B: platform CRUD + RBAC)
    - budgets.feature       (Lane B: hierarchical budget enforcement)
    - gateway-provider-settings.feature (Lane B: credentials cohesion)
    - gateway-service.feature (Lane A: Go HTTP server, health checks, routing)
    - auth-cache.feature      (Lane A: JWT + config caching, bootstrap mode)
    - caching-passthrough.feature (Lane A: Anthropic cache_control invariant)
    - streaming.feature       (Lane A: SSE byte-for-byte + stream_chunk guardrails)
    - fallback.feature        (Lane A: 5xx/timeout/429 → next provider)
    - guardrails.feature      (Lane A+B: pre/post/stream_chunk checks)
    - cli-integrations.feature (Lane C: Claude Code, Codex, opencode)
    - observability.feature    (Lane A: per-tenant OTel routing)

  Everything in this file must agree with specs/ai-gateway/_shared/contract.md.
  When a scenario conflicts with the contract, the contract wins and the scenario is amended.

  Background:
    Given organization "acme" exists with team "platform" and project "gateway-demo"
    And project "gateway-demo" has "openai", "anthropic", and "bedrock" providers configured
    And I have a virtual key "prod-key" with id starting "lw_vk_live_" for project "gateway-demo"
    And the key "prod-key" has fallback chain [openai, anthropic]
    And the key "prod-key" has a monthly project budget of $100 with on_breach "block"
    And the LangWatch control-plane is running at "http://localhost:5560"
    And the LangWatch AI Gateway is running at "http://localhost:7400"

  # ============================================================================
  # E1 — Golden path: single request flows through the whole pipeline
  # ============================================================================

  @integration @epic
  Scenario: Single chat completion — OpenAI shape — succeeds and is attributed
    Given the gateway auth cache is warm for key "prod-key"
    When I POST /v1/chat/completions to the gateway with:
      | header        | Authorization: Bearer lw_vk_live_...                    |
      | content-type  | application/json                                        |
      | body          | { "model": "gpt-5-mini", "messages": [{"role":"user","content":"hi"}] } |
    Then the gateway returns 200 within 3 seconds
    And the response body is OpenAI-compatible with an "id", "choices", "usage"
    And the response header "X-LangWatch-Request-Id" is a ULID-formatted string
    And the response header "X-LangWatch-Provider" equals "openai"
    And the response header "X-LangWatch-Model" equals "gpt-5-mini"
    And within 30 seconds a trace appears in project "gateway-demo" with:
      | span.name                  | gateway.chat.completions |
      | attr.langwatch.vk_id       | <the vk id>              |
      | attr.langwatch.project_id  | <acme gateway-demo>      |
      | attr.langwatch.org_id      | <acme org id>            |
    And the project "gateway-demo" monthly budget "spent_usd" increases by the reported cost

  @integration @epic
  Scenario: Single message — Anthropic shape — succeeds via Claude Code-compatible path
    Given the gateway auth cache is warm for key "prod-key"
    When I POST /v1/messages to the gateway with:
      | header        | x-api-key: lw_vk_live_...                               |
      | header        | anthropic-version: 2023-06-01                           |
      | body          | { "model": "claude-haiku-4-5-20251001", "messages": [{"role":"user","content":"hi"}], "max_tokens": 64 } |
    Then the gateway returns 200 within 3 seconds
    And the response body is Anthropic-compatible with "content" and "usage"
    And the response header "X-LangWatch-Provider" equals "anthropic"
    And a corresponding trace is recorded in project "gateway-demo"

  # ============================================================================
  # E2 — Auth caching: hot path has zero control-plane RTT after warmup
  # ============================================================================

  @integration @epic @performance
  Scenario: Hot-path request does not hit the control-plane
    Given the gateway auth cache is warm for key "prod-key"
    And the control-plane /internal/gateway/resolve-key has been called zero times since warmup
    When I POST /v1/chat/completions to the gateway 10 times using key "prod-key"
    Then the gateway returns 200 ten times
    And /internal/gateway/resolve-key is still called zero times (JWT verified locally)
    And /internal/gateway/config/:vk_id is still called zero times (ETag unchanged)
    And /internal/gateway/budget/debit is called 10 times (fire-and-forget)

  @integration @epic
  Scenario: Gateway survives control-plane outage after bootstrap
    Given the gateway has started with LW_GATEWAY_BOOTSTRAP_PULL=true
    And all active VKs have been pre-loaded into L1 cache
    And the LangWatch control-plane is now unreachable
    When I POST /v1/chat/completions to the gateway with a pre-loaded key
    Then the gateway returns 200 (upstream LLM still reachable)
    And a warning is logged: "control_plane_unreachable debit queued"
    And when the control-plane comes back online the queued debits are delivered in FIFO order

  # ============================================================================
  # E3 — Budget enforcement
  # ============================================================================

  @integration @epic
  Scenario: Hard-cap budget breach returns 402 with OpenAI-compatible envelope
    Given project "gateway-demo" has a monthly budget of $100 with on_breach "block"
    And 99.50 USD has been spent this month
    And the next request is estimated to cost 2.00 USD
    When I POST /v1/chat/completions to the gateway with key "prod-key"
    Then the gateway returns 402
    And the response body equals:
      """
      {
        "error": {
          "type":    "budget_exceeded",
          "code":    "budget_exceeded",
          "message": "Budget exceeded for scope=project window=month",
          "param":   null
        }
      }
      """
    And the trace records span attribute "langwatch.budget.breached_scope=project:month"

  @integration @epic
  Scenario: Soft-cap budget breach emits warning header and still succeeds
    Given team "platform" has a monthly team budget of $5000 with on_breach "warn"
    And spend this month is $4600 (92%)
    When I POST /v1/chat/completions to the gateway with key "prod-key"
    Then the gateway returns 200
    And the response header "X-LangWatch-Budget-Warning" equals "team:92"
    And the request is recorded in the trace with the warning flag

  # ============================================================================
  # E4 — Fallback chain
  # ============================================================================

  @integration @epic
  Scenario: Primary provider 5xx triggers fallback to secondary transparently
    Given the key "prod-key" has fallback chain [openai, anthropic]
    And the upstream OpenAI API is returning 503 for all requests
    When I POST /v1/chat/completions with model "gpt-5-mini"
    Then the gateway routes the request to Anthropic with the model translated to "claude-haiku-4-5-20251001"
    And the response is Anthropic-compatible but repackaged in OpenAI shape (since client asked for /v1/chat/completions)
    And the response header "X-LangWatch-Provider" equals "anthropic"
    And the response header "X-LangWatch-Fallback-Count" equals "1"
    And the trace records two attempt spans with "langwatch.fallback.attempt=0" and "=1"

  @integration @epic
  Scenario: Upstream 400 does NOT trigger fallback (client error)
    Given the upstream OpenAI API returns 400 "invalid request format"
    When I POST /v1/chat/completions with a malformed body
    Then the gateway returns 400 with the OpenAI-shaped error envelope passed through
    And no fallback is attempted
    And "X-LangWatch-Fallback-Count" is absent or equals "0"

  # ============================================================================
  # E5 — Caching passthrough (load-bearing for Anthropic cost)
  # ============================================================================

  @integration @epic
  Scenario: Anthropic cache_control is forwarded byte-identically when mode=respect
    Given the VK "prod-key" has cache.mode = "respect"
    When I POST /v1/messages with a body containing a "cache_control": {"type":"ephemeral"} block on the system prompt
    Then the forwarded request body to Anthropic contains the same cache_control block at the same position
    And the response usage includes "cache_read_input_tokens" or "cache_creation_input_tokens"
    And the debit call reports the cache-read vs cache-write token counts separately

  @integration @epic
  Scenario: Cache override via header disables cache for a single request
    Given the VK "prod-key" has cache.mode = "respect"
    When I POST /v1/messages with header "X-LangWatch-Cache: disable" and a cache_control block in the body
    Then the forwarded request body to Anthropic has all cache_control blocks stripped
    And the response header "X-LangWatch-Cache" equals "bypass"

  # ============================================================================
  # E6 — Streaming contract
  # ============================================================================

  @integration @epic
  Scenario: SSE streaming passes tool-call deltas byte-for-byte
    Given the upstream OpenAI is streaming tool-call deltas in SSE format
    When I POST /v1/chat/completions with "stream": true
    Then the gateway proxies each SSE event to the client byte-for-byte after the first chunk
    And the first response frame includes header "X-LangWatch-Request-Id"
    And the total number of SSE events emitted equals the number emitted by upstream
    And the ordering of "delta" events is preserved

  @integration @epic
  Scenario: Stream-chunk guardrail redacts PII mid-stream
    Given the VK "prod-key" has a stream_chunk guardrail "pii-redactor" attached
    And the upstream returns a stream that includes an email "alice@acme.com"
    When I POST /v1/chat/completions with "stream": true
    Then each SSE chunk is sent to /internal/gateway/guardrail/check with direction "stream_chunk"
    And the chunk containing "alice@acme.com" is replaced with the redacted form "[EMAIL]"
    And the client never receives the unredacted email
    And the per-chunk guardrail latency is under 50ms

  # ============================================================================
  # E7 — Blocked patterns (tools/MCP/URLs)
  # ============================================================================

  @integration @epic
  Scenario: Requesting a denied tool returns tool_not_allowed
    Given the VK "prod-key" has blocked_patterns.tools.deny = ["^shell\\..*"]
    When I POST /v1/chat/completions with tools: [{name: "shell.exec"}]
    Then the gateway returns 403
    And the error envelope type is "tool_not_allowed"
    And the message contains the blocked tool name
    And the trace records "langwatch.policy.blocked=tools:shell.exec"

  # ============================================================================
  # E8 — Per-tenant OTel routing
  # ============================================================================

  @integration @epic
  Scenario: Trace for tenant A lands in tenant A's project, not tenant B's
    Given organization "acme" has project "acme-demo" and organization "globex" has project "globex-demo"
    And tenants "acme" and "globex" each have their own VK
    When tenant "acme" and tenant "globex" each POST /v1/chat/completions concurrently
    Then the trace for the "acme" request appears ONLY in project "acme-demo"
    And the trace for the "globex" request appears ONLY in project "globex-demo"
    And no cross-tenant trace leakage is observed in either direction

  # ============================================================================
  # E9 — Coding-CLI integration (dogfood)
  # ============================================================================

  @integration @epic @cli
  Scenario: Claude Code CLI can use a LangWatch VK as an Anthropic endpoint
    Given ANTHROPIC_BASE_URL is set to "http://localhost:7400"
    And ANTHROPIC_AUTH_TOKEN is set to a LangWatch VK
    When I run `claude --print "say hi"`
    Then Claude Code exits 0
    And the request is visible in project "gateway-demo" as a trace tagged "claude-code"
    And the budget is debited accordingly

  @integration @epic @cli
  Scenario: Codex CLI can use a LangWatch VK as an OpenAI endpoint
    Given OPENAI_BASE_URL is set to "http://localhost:7400/v1"
    And OPENAI_API_KEY is set to a LangWatch VK
    When I run `codex exec "say hi"`
    Then Codex exits 0
    And the request is visible in project "gateway-demo" as a trace tagged "codex"

  @integration @epic @cli
  Scenario: Model alias lets the same CLI talk to multiple providers without config change
    Given VK "prod-key" has model_aliases = {"gpt-4o": "azure/my-deployment"}
    When I run `codex exec --model gpt-4o "ping"`
    Then the gateway routes the request to Azure OpenAI using the VK's Azure credentials
    And the response header "X-LangWatch-Provider" equals "azure_openai"

  # ============================================================================
  # E10 — Health & readiness
  # ============================================================================

  @integration @epic
  Scenario: Readiness is green only when all dependencies are usable
    Given the gateway process is alive
    When I GET /readyz
    Then the gateway returns 200 only if:
      | check                                                  |
      | bifrost/core is initialized                            |
      | at least one provider credential resolves successfully |
      | control-plane /internal/gateway/resolve-key is reachable OR bootstrap cache is populated |
      | the changes long-poll goroutine is running             |
    And if any check fails the endpoint returns 503 with a JSON body listing failing checks

  @integration @epic
  Scenario: Liveness is green as long as the process is responsive
    When I GET /healthz
    Then the gateway returns 200 with body {"status":"ok"}
    And /healthz never calls the control-plane

  # ============================================================================
  # E11 — RBAC end-to-end
  # ============================================================================

  @integration @epic
  Scenario: Developer without virtualKeys:create cannot create a VK
    Given user "dev@acme" has only "virtualKeys:view" on project "gateway-demo"
    When they attempt to create a new VK in the UI
    Then the "New virtual key" button is disabled or hidden
    And the POST /api/trpc/virtualKeys.create request returns 403
