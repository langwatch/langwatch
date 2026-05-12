Feature: Per-VK rate limits — RPM / RPD ceilings with dimension-aware 429 shape
  # Ref: docs/ai-gateway/troubleshooting.mdx §429 rate_limit_exceeded
  #      docs/ai-gateway/api/errors.mdx
  # Contract: specs/ai-gateway/_shared/contract.md §3 + §8 (errors)
  # Covers Lane A iter 7 `261b731` — per-VK rate limits RPM / RPD.
  # TPM (tokens-per-minute) deliberately deferred to v1.1.

  Background:
    Given the gateway has a virtual key "vk_prod" with rate_limits: {rpm: 60, rpd: 10000}
    And the VK is bound to an OpenAI provider credential
    And the rate-limit enforcement runs BEFORE guardrails / cache-override / body-parse / bifrost-dispatch
    # i.e. a rate-limited request incurs zero provider cost and does not trip the VK's TPM budget

  # ─────────────────────────────────────────────────────────────────────────
  # §1. Enforcement — VK ceiling fires
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Request within RPM ceiling succeeds
    When 30 requests are made in 60 seconds from a single client
    Then all 30 return 200 OK
    And no rate-limit response headers are emitted

  Scenario: Request crossing the RPM ceiling returns 429 with full envelope
    When 61 requests are made in 60 seconds
    Then requests 1..60 return 200 OK
    And request 61 returns status 429
    And response body is the OpenAI-compat error envelope:
      """
      {"error":{"type":"rate_limit_exceeded","code":"vk_rate_limit_exceeded","message":"…","param":null}}
      """
    And response header "Retry-After" is a positive integer (seconds until the next token is available)
    And response header "X-LangWatch-RateLimit-Dimension" equals "rpm"

  Scenario: Request crossing the RPD ceiling returns 429 with dimension header "rpd"
    Given the VK has served 10000 requests in the current day window
    When the 10001st request arrives
    Then the response status is 429
    And error.code equals "vk_rate_limit_exceeded"
    And response header "X-LangWatch-RateLimit-Dimension" equals "rpd"
    And response header "Retry-After" reflects seconds until the day window resets

  Scenario: Cross-dimension accounting — RPM denial does not burn RPD budget
    Given the VK has already served 59 requests in the current minute
    When a 60th request arrives and is denied by RPM
    Then the response is 429 with dimension "rpm"
    And the RPD counter for the day is NOT incremented for this denied request
    And raising RPM on the VK does NOT simultaneously deplete RPD

  # ─────────────────────────────────────────────────────────────────────────
  # §2. Disambiguation — gateway-level vs upstream rate limit
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: 429 from the upstream provider is distinct from gateway-level denial
    Given the VK's rate_limits.rpm is unset (no gateway cap)
    When the upstream provider (e.g. OpenAI) returns 429 from exhausted quota
    Then the response status is 429
    And error.type equals "rate_limit_exceeded"
    And response header "X-LangWatch-Provider" equals "openai"
    And response header "X-LangWatch-RateLimit-Dimension" is ABSENT (no gateway-level dimension fired)
    And the error.code equals the upstream's reason (e.g. "insufficient_quota"), NOT "vk_rate_limit_exceeded"

  Scenario: Upstream 429 triggers fallback if the VK has a fallback chain
    Given the VK fallback chain is [openai-primary, anthropic-fallback]
    And fallback.on includes "rate_limit"
    When the upstream openai-primary returns 429
    Then the gateway attempts anthropic-fallback
    And the final response is from anthropic-fallback (if it succeeds)
    And response header "X-LangWatch-Fallback-Count" equals 1

  # ─────────────────────────────────────────────────────────────────────────
  # §3. Cache invalidation — ceiling changes take effect on next request
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Raising RPM on the VK propagates within 30 seconds via /changes
    Given the VK has rate_limits.rpm = 60
    When an admin raises rate_limits.rpm to 300 via the REST API or UI
    Then within 30 seconds the gateway's in-memory limiter is updated
    And requests above 60/minute stop being rejected
    And no gateway restart is required

  Scenario: Lowering the ceiling does not retroactively reject in-flight requests
    Given the VK has rate_limits.rpm = 300
    And 200 requests are already in-flight in the current minute
    When an admin lowers rate_limits.rpm to 60
    Then the in-flight 200 requests all complete (no mid-request termination)
    And the 201st request in the current minute is denied with 429 dimension "rpm"

  Scenario: Setting rate_limits to null disables rate limiting entirely
    Given the VK has rate_limits: {rpm: null, rpd: null}
    When 10,000 requests are made in 60 seconds
    Then all requests succeed or fall through to the upstream provider's own limits
    And no gateway-level 429 with X-LangWatch-RateLimit-Dimension fires

  # ─────────────────────────────────────────────────────────────────────────
  # §4. Observability — span attributes + metrics
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Denied request records the dimension on the trace
    Given a request is denied with dimension "rpm"
    Then span attribute "langwatch.status" equals "rate_limited"
    And span attribute "langwatch.ratelimit.dimension" equals "rpm"
    And span attribute "langwatch.provider" is absent (no dispatch happened)

  Scenario: Prometheus counter gateway_rate_limit_denied_total labels dimension
    Given 5 requests denied by RPM and 2 denied by RPD in the last minute
    Then counter gateway_rate_limit_denied_total{dimension="rpm",vk_id="vk_prod"} increments by 5
    And counter gateway_rate_limit_denied_total{dimension="rpd",vk_id="vk_prod"} increments by 2

  # ─────────────────────────────────────────────────────────────────────────
  # §5. TPM deferred to v1.1
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: TPM config on a VK returns cleanly-deferred 400 (v1)
    Given VK config rate_limits.tpm is set to 50000
    When the VK bundle is materialised
    Then the bundle rejects the field with a validation error
    And the VK save fails with 400 "tpm_not_implemented" in v1
    # (v1.1 spec: specs/ai-gateway/semantic-caching.feature is the sibling v1.1 work;
    # TPM needs Redis-coordinated cluster-wide counters; tracked separately.)

  # ─────────────────────────────────────────────────────────────────────────
  # §6. Edge cases
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Only one dimension fires when both would be exhausted simultaneously
    Given rate_limits.rpm = 60 and rate_limits.rpd = 60
    And the VK has served 60 requests in the current minute AND in the current day
    When a 61st request arrives
    Then the response is 429 with dimension header equal to exactly one of "rpm" or "rpd"
    And the error.message names the dimension that fired first (implementation is deterministic — smaller window first)

  Scenario: Concurrent requests across 2 gateway pods share rate-limit state
    Given 2 gateway replicas share the same VK and Redis coordination
    When 30 requests land on replica A and 31 land on replica B within the same minute
    Then request 61 (whichever pod receives it) returns 429 dimension "rpm"
    And the limiter state is Redis-coordinated, not per-pod
    # Note: v1 rate-limits MAY be per-pod if Redis is disabled — see deploy config.

  Scenario: Retry-After header is populated deterministically (not random)
    Given a request is denied at second 45 of the current minute
    Then Retry-After equals 15 (= 60 - 45, the whole seconds until the minute window resets)
    And clients polling Retry-After converge on the same wait time across gateway pods

  # ─────────────────────────────────────────────────────────────────────────
  # §7. RBAC — who can author rate limits
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Only virtualKeys:update principals can edit rate_limits
    Given a user with role VIEWER
    When they PATCH VK config.rate_limits
    Then the response is 403 permission_denied
    And error.message names "virtualKeys:update" as the missing permission

  Scenario: Rate limits edits emit an audit row
    Given a user with role ADMIN raises rate_limits.rpm from 60 to 300
    Then an AuditLog row is written with:
      | action     | gateway.virtual_key.updated          |
      | targetKind | virtual_key                          |
      | targetId   | <vk_id>                              |
      | before     | {rateLimits: {rpm: 60}}              |
      | after      | {rateLimits: {rpm: 300}}             |
    And the row is visible at /settings/audit-log filtered by Target = "virtual_key"
