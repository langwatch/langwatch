Feature: Advanced routing — weighted, canary, sticky-session, composable
  As an enterprise customer running LLM traffic at scale
  I want routing policies richer than fallback-chains
  So that I can cost-optimize (80/20 mini vs full), roll out new models safely
  (10% canary), keep a user on one model for A/B experiments, and compose
  these patterns together

  Context & rationale:
  Portkey's ai-gateway load-balancing surface covers four axes we don't:
  weighted probabilistic distribution, canary deployments, sticky sessions
  via hashed metadata, and nested composition. LangWatch already has a
  fallback engine (Lane A iter 4 pt2) which handles failure-driven switching;
  this spec covers SUCCESS-driven routing, which is a separate decision.

  Scope for v1.1 (post-v1 GA):
  - Weighted distribution across N slots of the VK's provider chain.
  - Canary flag on a single chain entry (e.g. "send 5% here, rest to default").
  - Sticky session via `X-LangWatch-Session-Id` or metadata-hash.
  - Compose with fallback: weighted-primary → fallback-chain on failure.

  Non-goals for v1.1:
  - Geo-based routing (geo routing lives at the LB, not the gateway).
  - Multi-model parallel calls (would need a fundamentally different response model).
  - Per-request dynamic routing rules — keep policy in the VK config for now.

  Background:
    Given a VK "vk_cost_opt" bound to provider credentials:
      | id           | provider  | model               |
      | gpc_4o_mini  | openai    | gpt-4o-mini         |
      | gpc_4o       | openai    | gpt-4o              |
      | gpc_anthropic| anthropic | claude-haiku-4-5    |
    And the gateway is receiving steady traffic

  # ============================================================================
  # Weighted distribution
  # ============================================================================

  @integration @routing
  Scenario: 80/20 cost-optimization between mini and full
    Given "vk_cost_opt" has routing config:
      """
      {
        "routing": {
          "mode": "weighted",
          "slots": [
            { "credential_id": "gpc_4o_mini", "weight": 8 },
            { "credential_id": "gpc_4o",      "weight": 2 }
          ]
        }
      }
      """
    When 10,000 requests are dispatched through "vk_cost_opt"
    Then approximately 8,000 ± 200 hit `gpc_4o_mini`
    And approximately 2,000 ± 200 hit `gpc_4o`
    And every response has `X-LangWatch-Provider-Credential` set to the chosen slot
    And every OTel span has `langwatch.routing.slot` attribute

  @unit @routing
  Scenario: Weights normalize regardless of scale
    When routing slots use weights `[5, 3, 1]`
    Then the normalized weights are `[0.555, 0.333, 0.111]`
    And a slot with weight `0` is a valid way to temporarily disable it

  @unit @routing
  Scenario: Zero total weight is an error
    When a VK has routing slots all with `weight: 0`
    Then `virtual-keys update` returns 400 with error.code = "validation_error"
    And error.message mentions "at least one slot must have positive weight"

  # ============================================================================
  # Canary deployment
  # ============================================================================

  @integration @routing @canary
  Scenario: 5% canary traffic to a new model
    Given "vk_cost_opt" rolled out a new model via config:
      """
      {
        "routing": {
          "mode": "canary",
          "canary": { "credential_id": "gpc_anthropic", "weight": 5 },
          "default_credential_id": "gpc_4o_mini"
        }
      }
      """
    When 10,000 requests are dispatched
    Then approximately 500 ± 50 hit the canary credential
    And approximately 9,500 ± 50 hit the default
    And the UI's /gateway/usage page shows a "canary" filter that isolates canary spend

  @integration @routing @canary
  Scenario: Rolling a canary weight from 5% → 50% → 100%
    Given a VK currently serves 5% canary
    When an operator updates `routing.canary.weight` to 50
    Then subsequent traffic splits approximately 50/50
    When the operator updates the default to the canary credential and removes the canary
    Then 100% of traffic lands on the new credential
    And no change requires a gateway restart (`/changes` feed invalidates the VK config ≤ 30s)

  # ============================================================================
  # Sticky sessions
  # ============================================================================

  @integration @routing @sticky
  Scenario: Same user consistently hits the same slot
    Given "vk_cost_opt" has:
      """
      {
        "routing": {
          "mode": "weighted",
          "slots": [
            { "credential_id": "gpc_4o_mini", "weight": 5 },
            { "credential_id": "gpc_anthropic", "weight": 5 }
          ],
          "sticky": { "by": "X-LangWatch-Session-Id" }
        }
      }
      """
    When 100 requests come from session id `session_abc`
    Then all 100 hit the same slot (either all gpc_4o_mini or all gpc_anthropic)
    When 100 requests come from session id `session_xyz`
    Then all 100 hit some slot consistently (may be the same or different from session_abc)

  @integration @routing @sticky
  Scenario: Sticky by metadata field
    Given routing sticky is `"by": "metadata.user_id"`
    When requests carry `X-LangWatch-Trace-Metadata: {"user_id": "alice"}`
    Then alice's requests consistently land on the same slot
    And a different user bob can land on a different slot
    And the assignment is stable across gateway replicas (deterministic hash)

  @unit @routing @sticky
  Scenario: Sticky fallback to even distribution when key is absent
    Given routing sticky is `"by": "X-LangWatch-Session-Id"`
    When a request has no `X-LangWatch-Session-Id` header
    Then the request is routed by weight only (not sticky)
    And no error is raised

  # ============================================================================
  # Composition with fallback
  # ============================================================================

  @integration @routing @fallback
  Scenario: Weighted primary + failure-driven fallback
    Given "vk_cost_opt" has:
      """
      {
        "routing": {
          "mode": "weighted",
          "slots": [
            { "credential_id": "gpc_4o_mini",  "weight": 8 },
            { "credential_id": "gpc_4o",       "weight": 2 }
          ]
        },
        "fallback": {
          "chain": ["gpc_anthropic"],
          "on":    ["5xx", "timeout", "rate_limit"],
          "max_attempts": 1
        }
      }
      """
    And `gpc_4o_mini` is returning 503 for every request
    When 100 requests are dispatched
    Then approximately 80 attempts hit `gpc_4o_mini` first (failed), fell back to `gpc_anthropic`
    And approximately 20 attempts hit `gpc_4o` directly (no fallback needed)
    And the response header `X-LangWatch-Fallback-Count` is 1 for the fallback subset, 0 otherwise
    And `langwatch.routing.slot` + `langwatch.fallback.count` span attrs disambiguate the two paths

  # ============================================================================
  # Observability
  # ============================================================================

  @integration @routing @observability
  Scenario: Routing decisions are visible in traces + metrics
    When a request is dispatched with weighted routing
    Then the OTel span has:
      | attribute                   | value                         |
      | langwatch.routing.mode      | weighted|canary|sticky         |
      | langwatch.routing.slot      | <credential_id>               |
      | langwatch.routing.weight    | <normalized weight, 0.0-1.0>  |
      | langwatch.routing.sticky_key| <session id when sticky>      |
    And Prometheus exposes `gateway_routing_slot_selected_total{credential, reason}` counter
    And the /gateway/usage UI filters on routing.slot

  # ============================================================================
  # Migration path from flat provider chain
  # ============================================================================

  @contract @migration
  Scenario: Existing VKs without routing config behave unchanged
    Given a VK configured only with `provider_credential_ids: ["gpc_a", "gpc_b"]` (no routing block)
    When a request is dispatched
    Then the gateway uses `gpc_a` as primary (first in chain) and falls back to `gpc_b` on failure
    And no weighted distribution occurs (backward-compatible with v1.0 shape)
    And this behavior is equivalent to `routing.mode = "priority"` with implicit weights `[1, 0, 0, ...]`

  # ============================================================================
  # Out of scope — tagged for explicit rejection
  # ============================================================================

  @roadmap @out_of_scope
  Scenario: Geo-based routing is handled at the LB, not the gateway
    When a customer asks for "route eu-region users to a eu-region VK"
    Then the answer is "use Route53 latency-based routing OR your CDN's geo-routing
         to point the customer at a different gateway endpoint; the per-gateway
         VK config cannot know the user's location reliably"

  @roadmap @out_of_scope
  Scenario: Multi-model parallel dispatch is not supported in v1.1
    When a customer asks for "call both gpt-4o and claude on every request, return the first"
    Then this is explicitly rejected for v1.1 because:
      | reason                                                                      |
      | it doubles cost                                                             |
      | it breaks the 1-request-1-response contract of the OpenAI/Anthropic schemas |
      | it requires an N-provider race condition policy not worth building in v1    |
