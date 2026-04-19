Feature: Blocked patterns — regex policy on tools, MCP servers, URLs, and models
  # Ref: docs/ai-gateway/blocked-patterns.mdx
  # Contract: specs/ai-gateway/_shared/contract.md §8
  # Covers Lane A iters 8 (tools / MCP / models, iter 8 `634d647`), 9 (URL
  # extractor, iter 9 `4b80a8a`), 14 (fail-closed on invalid regex).

  Background:
    Given the gateway has a virtual key "vk_prod"
    And the VK is bound to an OpenAI provider credential
    And the gateway runs enforcement AFTER auth + rate-limit + body-size cap, BEFORE cache-override / guardrails / body-parse / bifrost-dispatch

  # ─────────────────────────────────────────────────────────────────────────
  # §1. Tools dimension — blocked_patterns.tools
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Tool call with a deny-matched name returns 403 tool_not_allowed
    Given VK config blocked_patterns.tools.deny = ["^shell\\..*", "^filesystem\\.write$"]
    When a request to /v1/chat/completions carries tools: [{function: {name: "shell.exec"}}]
    Then the response status is 403
    And error.type equals "tool_not_allowed"
    And error.code equals "tool_not_allowed"
    And error.message names "shell.exec" and the matched pattern
    And the VK's budget is NOT debited (request never reached the provider)

  Scenario: Anthropic-shape tool definitions match the same deny regex
    Given VK config blocked_patterns.tools.deny = ["^shell\\..*"]
    When a request to /v1/messages carries tools: [{name: "shell.exec", input_schema: {}}]
    Then the response status is 403 with error.type "tool_not_allowed"
    And the match is symmetric across the two endpoints

  Scenario: Allow-list with non-matching tool returns 403
    Given VK config blocked_patterns.tools.allow = ["^safe\\..*"]
    And no deny list is set
    When a request carries tools: [{function: {name: "shell.exec"}}]
    Then the response status is 403 tool_not_allowed
    And error.message clarifies that the tool is outside the allowlist

  Scenario: Empty blocked_patterns.tools passes every tool through
    Given VK config blocked_patterns.tools is unset
    When a request carries tools: [{function: {name: "shell.exec"}}]
    Then the request is dispatched to the upstream provider (no policy block)

  # ─────────────────────────────────────────────────────────────────────────
  # §2. MCP dimension — blocked_patterns.mcp
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: MCP server name matched by deny regex returns 403
    Given VK config blocked_patterns.mcp.deny = ["^unauthorized-mcp$"]
    When a request carries mcp_servers: [{name: "unauthorized-mcp", url: "https://evil.example/mcp"}]
    Then the response status is 403 tool_not_allowed
    And error.message names "unauthorized-mcp"

  Scenario: MCP server URL matched by deny regex returns 403
    Given VK config blocked_patterns.mcp.deny = ["evil\\.example"]
    When a request carries mcp_servers: [{name: "trusted-looking", url: "https://evil.example/mcp"}]
    Then the response status is 403 tool_not_allowed
    And error.message names "evil.example"

  # ─────────────────────────────────────────────────────────────────────────
  # §3. URLs dimension — blocked_patterns.urls
  # Iter 9 `4b80a8a`: permissive URL extractor walks the entire body.
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: URL in user message body matches deny regex
    Given VK config blocked_patterns.urls.deny = ["evil\\.com"]
    When a request carries messages: [{role: "user", content: "please fetch https://evil.com/data"}]
    Then the response status is 403
    And error.type equals "url_not_allowed"
    And error.message names "evil.com"

  Scenario: URL in tool-call argument matches deny regex
    Given VK config blocked_patterns.urls.deny = ["evil\\.com"]
    When a request carries tool_calls: [{function: {name: "fetch", arguments: "{\"url\": \"https://evil.com/data\"}"}}]
    Then the response status is 403 url_not_allowed

  Scenario: URL in system prompt matches deny regex
    Given VK config blocked_patterns.urls.deny = ["evil\\.com"]
    When a request carries system: "Background reading: https://evil.com/doc"
    Then the response status is 403 url_not_allowed

  Scenario: Only http(s) URLs are extracted — ftp:// scheme is ignored
    Given VK config blocked_patterns.urls.deny = ["evil\\.com"]
    When a request carries messages containing "ftp://evil.com/data"
    Then the request passes URL enforcement
    And reaches the upstream provider

  Scenario: URL allow-list — only whitelisted hosts pass
    Given VK config blocked_patterns.urls.allow = ["docs\\.langwatch\\.ai", "api\\.openai\\.com"]
    And no deny list is set
    When a request carries messages containing "https://other.example/data"
    Then the response status is 403 url_not_allowed
    When a request carries messages containing "https://docs.langwatch.ai/guide"
    Then the request passes URL enforcement

  # ─────────────────────────────────────────────────────────────────────────
  # §4. Models dimension — blocked_patterns.models
  # Distinct from models_allowed (static allowlist). Blocked_patterns.models
  # is regex-based for pattern-level policy (e.g. ban any preview model).
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Model deny regex returns 403 model_not_allowed
    Given VK config blocked_patterns.models.deny = [".*-preview$"]
    When a request routes to model "gpt-5-preview"
    Then the response status is 403 model_not_allowed
    And error.message names the matched pattern

  Scenario: Model allow regex — non-matching model returns 403
    Given VK config blocked_patterns.models.allow = ["^gpt-5-mini$", "^claude-haiku"]
    When a request routes to model "gpt-5"
    Then the response status is 403 model_not_allowed
    And error.message clarifies the model is outside the allow-regex

  Scenario: Blocked_patterns.models composes with models_allowed (both must pass)
    Given VK config models_allowed = ["gpt-5-mini", "claude-haiku-4-5-20251001"]
    And VK config blocked_patterns.models.deny = [".*-haiku.*"]
    When a request routes to "claude-haiku-4-5-20251001"
    Then the response status is 403 model_not_allowed
    And the cause is the blocked_patterns.models deny (takes precedence over the allowlist membership)

  # ─────────────────────────────────────────────────────────────────────────
  # §5. Evaluation semantics — deny-wins, fail-closed on invalid regex
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Deny wins over allow when both match
    Given VK config blocked_patterns.tools.deny = ["^shell\\."]
    And VK config blocked_patterns.tools.allow = [".*exec.*"]
    When a request carries tools: [{function: {name: "shell.exec"}}]
    Then the response status is 403 tool_not_allowed (deny wins)

  Scenario: Invalid regex fails closed (iter 14)
    Given VK config blocked_patterns.tools.deny = ["[unclosed-bracket"]
    When any request comes through that VK
    Then the response status is 503
    And error.code equals "blocked_patterns_invalid_regex"
    And error.message names the dimension "tools" and the list "deny"
    And the VK bundle refresh logs the pattern as invalid
    And no silent bypass occurs

  Scenario: RE2 incompatibility — backreferences refuse
    Given VK config blocked_patterns.tools.deny = ["(foo)\\1"]
    When the VK bundle is compiled
    Then the pattern compile fails with an RE2 syntax error
    And 503 blocked_patterns_invalid_regex is returned on every request through the VK

  # ─────────────────────────────────────────────────────────────────────────
  # §6. Enforcement ordering — pre-dispatch, zero cost
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: A blocked request incurs zero provider cost
    Given VK config blocked_patterns.tools.deny = ["^shell\\."]
    When 10 requests arrive carrying shell.exec
    Then all 10 return 403 tool_not_allowed
    And 0 requests are dispatched to the upstream provider
    And the VK's gateway_requests_total{provider, status} shows 10 blocked, 0 dispatched
    And the VK's budget ledger shows 0 cost for these requests

  Scenario: Ordering — blocked_patterns runs AFTER cache-override, BEFORE guardrails
    Given VK config has both cache.mode "disable" and blocked_patterns.tools.deny = ["^shell\\."]
    When a request carries cache_control markers AND a blocked tool name
    Then cache_control markers are stripped first (by cache-override)
    And then the blocked-tool check runs on the post-strip body
    And the response status is 403 tool_not_allowed
    And the trace records both stages for debugging

  # ─────────────────────────────────────────────────────────────────────────
  # §7. Observability
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Trace attribute langwatch.policy.blocked records the match
    Given a request is blocked by blocked_patterns.tools.deny
    Then the trace has span attribute "langwatch.policy.blocked" = "tools:^shell\\."
    And span attribute "langwatch.status" = "blocked"
    And span attribute "langwatch.provider" is absent (no dispatch happened)

  Scenario: Metric gateway_blocked_requests_total{dimension,reason} increments per block
    Given requests are blocked across all 4 dimensions (tools / mcp / urls / models)
    Then gateway_blocked_requests_total{dimension="tools",reason="deny"} increments for tools blocks
    And gateway_blocked_requests_total{dimension="urls",reason="allow_miss"} increments for allow-miss URL blocks
    And the metric supports per-VK breakdown via the vk_id label

  # ─────────────────────────────────────────────────────────────────────────
  # §8. RBAC — gatewayVirtualKeys:update governs who authors blocked_patterns
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: MEMBER with virtualKeys:update can edit blocked_patterns on their own VK
    Given a user with role MEMBER
    And the user is the principal owner of a VK
    When they PATCH the VK's config.blocked_patterns
    Then the update succeeds
    And an audit row is written

  Scenario: VIEWER cannot edit blocked_patterns
    Given a user with role VIEWER
    When they PATCH any VK's config.blocked_patterns
    Then the response is 403 permission_denied
