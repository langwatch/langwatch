Feature: Semantic caching — fuzzy-match prompts to cached responses
  As an enterprise customer running high-volume chat traffic
  I want the gateway to recognize semantically-similar prompts and serve
  cached responses without re-hitting the upstream provider
  So that I save cost and latency on repeated questions (FAQ bots, support
  agents, RAG pipelines with a long-tail of near-duplicate queries) while
  keeping a strong safety floor — same tenant, same VK, same config.

  Context & rationale:
  Anthropic `cache_control` passthrough (v1 GA, caching-passthrough.feature)
  is a byte-exact prefix cache, managed upstream. Semantic caching is a
  separate primitive:

    - Embeds the incoming prompt.
    - Searches a vector index scoped to {vk_id, model, routing.slot}.
    - On a hit above the similarity threshold, returns the cached
      response WITHOUT calling the upstream.
    - On a miss, dispatches normally and writes the {embedding, response}
      pair to the index after the response returns.

  Portkey has this; we don't in v1 GA. This spec locks the v1.1 contract so
  a future implementation can land incrementally without breaking clients
  that are already relying on the v1 surface.

  Scope for v1.1:
    - Opt-in per VK via `config.semantic_cache`.
    - Embedding via a customer-provided `gpc_*` credential (OpenAI
      text-embedding-3-small by default).
    - Similarity threshold in [0.80, 1.00], default 0.95.
    - TTL in [60, 86400] seconds, default 3600.
    - Cache backend: Redis (shared across gateway replicas).
    - Scoping key: `(vk_id, model, routing_slot, tenant_partition)`.
    - Align with the existing `X-LangWatch-Cache: respect|disable` header
      surface — clients can bypass the semantic cache identically to the
      upstream cache.
    - Skip rules (automatic, non-configurable in v1.1): streaming,
      tool-calling, vision inputs, requests with `temperature > 0` and
      no explicit opt-in.

  Non-goals for v1.1:
    - Cross-VK cache sharing (privacy risk — different VKs may have
      different upstream providers or safety configs).
    - Negative-match cache (remembering which prompts SHOULDN'T hit
      this model — interesting but out of scope).
    - Cache warming from historical traces (requires trace-export
      pipeline work, not a gateway feature).
    - Customer-supplied vector backend (Pinecone, Weaviate) — Redis
      only in v1.1, pluggable in v1.2+.

  Background:
    Given a VK "vk_faq" with semantic caching enabled:
      """
      {
        "semantic_cache": {
          "enabled": true,
          "embedding_credential_id": "gpc_openai_embed",
          "embedding_model": "text-embedding-3-small",
          "similarity_threshold": 0.95,
          "ttl_seconds": 3600
        }
      }
      """
    And Redis is available at `LW_GATEWAY_REDIS_URL`
    And the semantic cache index is empty at the start of each scenario

  # ============================================================================
  # Golden path — hit on a near-duplicate prompt
  # ============================================================================

  @integration @semantic_cache
  Scenario: A near-duplicate prompt serves from cache
    Given the first request sends user message "What are your office hours?"
    And the upstream response is "We're open Monday through Friday, 9am to 5pm."
    When a second request sends user message "When is your office open?"
    And the cosine similarity between the two embeddings is 0.97
    Then the second response matches the cached response byte-for-byte
    And no upstream call is made for the second request
    And the response header `X-LangWatch-Semantic-Cache` is `hit`
    And the response header `X-LangWatch-Semantic-Similarity` is `0.97`
    And `gateway_semantic_cache_hits_total{vk_id,model}` is incremented by 1
    And the OTel span has `langwatch.semantic_cache.hit=true` + similarity attr
    And no debit is written to the budget outbox (upstream wasn't called)
    And a tiny embedding-cost debit IS written (the embedding call happened)

  @integration @semantic_cache
  Scenario: Exact-match prompt hits cache with similarity 1.0
    Given the first request sends user message "FAQ: what's your pricing?"
    When the identical prompt is sent again
    Then the second request is served from cache
    And `X-LangWatch-Semantic-Similarity` is `1.00`
    And the response body is byte-identical to the first

  @integration @semantic_cache
  Scenario: Below-threshold similarity misses and dispatches upstream
    Given a cached entry for "What's the weather in Amsterdam?"
    When a new request asks "What's your company's mission statement?"
    And the cosine similarity is 0.32
    Then the gateway dispatches to the upstream normally
    And the response header `X-LangWatch-Semantic-Cache` is `miss`
    And `gateway_semantic_cache_misses_total{vk_id,model}` is incremented
    And after the upstream responds, the new (embedding, response) is stored

  # ============================================================================
  # Safety — prompts that MUST NOT share a cache
  # ============================================================================

  @contract @semantic_cache @safety
  Scenario: Requests from different VKs never cross-contaminate
    Given "vk_faq" and "vk_internal" both have semantic caching enabled
    And both VKs live in the same organization and project
    When "vk_faq" caches the response to "How do I reset my password?"
    And later "vk_internal" sends a similar query with similarity 0.98
    Then "vk_internal" does NOT hit the "vk_faq" cache entry
    And "vk_internal" dispatches to the upstream as a fresh request
    Because cache keys are scoped on `vk_id` — a hit would leak tenant
    configuration (system prompt, guardrails, provider settings) across
    principals who were deliberately given different VKs.

  @contract @semantic_cache @safety
  Scenario: Streaming requests never hit the semantic cache
    Given a VK with semantic caching enabled
    And a cached entry exists for "Tell me about LangWatch"
    When a request arrives with `"stream": true` for a similar prompt
    Then the gateway dispatches to the upstream as a miss
    And the response header `X-LangWatch-Semantic-Cache` is `skip`
    And the skip-reason response header is `X-LangWatch-Semantic-Cache-Skip: streaming`
    And `gateway_semantic_cache_skips_total{reason="streaming"}` is incremented
    Because the v1.1 cache stores completed responses, not streams — v1.2+
    may add stream replay with a separate opt-in.

  @contract @semantic_cache @safety
  Scenario: Tool-calling requests never hit the semantic cache
    Given a cached entry for a prior tool-calling request
    When a new request includes `tools: [...]` or `tool_choice`
    Then the gateway dispatches to the upstream as a miss
    And the skip-reason is `tool_calling`
    Because tool calls must be dispatched to let the model decide which
    tool to invoke against CURRENT world state — caching a prior tool
    choice would be incorrect behavior, not a performance win.

  @contract @semantic_cache @safety
  Scenario: Non-zero temperature without opt-in is a skip
    Given a VK with semantic caching enabled
    When a request arrives with `temperature: 0.7`
    Then the gateway dispatches to the upstream as a miss
    And the skip-reason is `non_deterministic_temperature`
    And this can be overridden via request header
      `X-LangWatch-Semantic-Cache-Accept-Nondeterministic: true` OR
      VK config `semantic_cache.allow_nondeterministic: true`
    Because a user who sets temperature > 0 is asking for variation;
    serving identical cached output silently would be surprising. The
    opt-in ack makes the tradeoff explicit.

  @contract @semantic_cache @safety
  Scenario: Vision / multimodal inputs are always a skip in v1.1
    Given a request with image content in the user message
    When semantic caching is enabled
    Then the gateway dispatches to the upstream as a miss
    And the skip-reason is `multimodal_content`
    Because v1.1 embeds text only; mixing image+text inputs requires a
    CLIP-style multimodal embedder, deferred to v1.2+.

  # ============================================================================
  # Client-controlled overrides (align with caching-passthrough header surface)
  # ============================================================================

  @contract @semantic_cache @headers
  Scenario: X-LangWatch-Cache: disable bypasses semantic cache (aligned with v1)
    Given a cached semantic entry exists for a prompt
    When a new similar request carries `X-LangWatch-Cache: disable`
    Then the gateway does NOT read from the semantic cache
    And the gateway does NOT write to the semantic cache on miss
    And the response header `X-LangWatch-Semantic-Cache` is `bypass`
    And the upstream `cache_control` passthrough is also disabled
    Because `X-LangWatch-Cache: disable` is a v1 GA header and must
    consistently disable ALL gateway-mediated caching layers.

  @contract @semantic_cache @headers
  Scenario: X-LangWatch-Cache: respect (default) allows semantic cache
    When a request does not set `X-LangWatch-Cache`
    Then semantic caching operates normally (hit / miss / skip per rules)

  @contract @semantic_cache @headers
  Scenario: force mode reserved for v1.2 (consistent with upstream cache)
    When a request sets `X-LangWatch-Cache: force`
    Then the gateway returns 400 with code `cache_override_not_implemented`
    And error.message mentions both "semantic" and "upstream" caches
    Because `force` requires cache-key warmup semantics across both
    layers and is not scoped for v1.1.

  # ============================================================================
  # Observability
  # ============================================================================

  @integration @semantic_cache @observability
  Scenario: Hit/miss/skip appear in Prometheus and OTel
    When the gateway handles a mix of semantic cache outcomes
    Then Prometheus exposes:
      | metric                                                    |
      | gateway_semantic_cache_hits_total{vk_id,model}            |
      | gateway_semantic_cache_misses_total{vk_id,model}          |
      | gateway_semantic_cache_skips_total{vk_id,model,reason}    |
      | gateway_semantic_cache_similarity_bucket{vk_id,model}     |
      | gateway_semantic_cache_entries{vk_id,model}               |
    And each request's OTel span has:
      | attribute                             |
      | langwatch.semantic_cache.enabled      |
      | langwatch.semantic_cache.outcome      |
      | langwatch.semantic_cache.similarity   |
      | langwatch.semantic_cache.skip_reason  |
    And the /gateway/usage UI shows a "semantic cache" filter with hit-rate
    And the budgets page shows "saved by cache" alongside spend

  @integration @semantic_cache @observability
  Scenario: Budget reflects saved cost on cache hits
    Given a cached hit for a prompt that would have cost $0.002 upstream
    When the semantic cache serves the response
    Then the debit written to the outbox is the embedding cost only
    (typically $0.00001 for text-embedding-3-small)
    And the `/gateway/usage` card "Saved by semantic cache" increments by $0.00199
    And a WARN-mode budget's "would have blocked at" counter is unaffected
    Because the saved-cost card is informational; the actual ledger debit
    is the genuine upstream spend (zero) plus the embedding cost.

  # ============================================================================
  # Cache lifecycle
  # ============================================================================

  @integration @semantic_cache @lifecycle
  Scenario: TTL expiration evicts stale entries
    Given a cached entry was stored 3601 seconds ago with ttl_seconds=3600
    When a similar request arrives
    Then the entry is a miss (Redis returned nil / expired)
    And the new response IS stored with a fresh TTL

  @integration @semantic_cache @lifecycle
  Scenario: Editing a VK's config invalidates its semantic cache
    Given "vk_faq" has cached entries
    When an operator updates `vk_faq.config.system_prompt` via the REST API
    Then within 30 seconds (one `/changes` long-poll cycle) the gateway
    evicts all Redis keys matching `semcache:vk_faq:*`
    Because a changed system prompt would produce different responses;
    serving pre-edit cached entries would be a regression, not a feature.
    Implementation note: eviction happens on the gateway side once the
    `/changes` cursor advances past the config-mutation revision. The
    control plane does NOT need to hold Redis credentials.

  @integration @semantic_cache @lifecycle
  Scenario: Revoking a VK nukes its semantic cache
    When "vk_faq" is revoked via `POST /virtual-keys/:id/revoke`
    Then the next `/changes` tick triggers eviction of `semcache:vk_faq:*`
    And a subsequent request with the revoked VK gets 401 (not a cache hit)

  # ============================================================================
  # Compatibility & fallback
  # ============================================================================

  @contract @semantic_cache @compat
  Scenario: Embedding provider unavailable fails OPEN
    Given "vk_faq" has semantic caching enabled with `gpc_openai_embed`
    When the embedding provider returns 503
    Then the gateway skips the semantic cache for this request
    And dispatches the original request to the upstream normally
    And logs a `gateway_semantic_cache_embed_failures_total` increment
    And emits a span event `semantic_cache.embed_failed`
    Because semantic caching is an optimization, not a safety control —
    failing closed would harm availability without security benefit.

  @contract @semantic_cache @compat
  Scenario: Redis unavailable fails OPEN
    Given Redis is unreachable (simulated connection refused)
    When a request arrives with semantic caching enabled
    Then the gateway skips the semantic cache for this request
    And dispatches the original request to the upstream normally
    And `gateway_semantic_cache_backend_failures_total{reason="redis_down"}` increments
    Because, like embedding failures, backend unavailability must not
    degrade availability of the primary request path.

  # ============================================================================
  # Migration path from v1 (no semantic caching)
  # ============================================================================

  @contract @migration
  Scenario: VKs without semantic_cache config behave unchanged
    Given a v1 GA VK has no `semantic_cache` block in its config
    When requests are dispatched
    Then the semantic cache layer is a no-op (no embedding, no Redis I/O)
    And response headers do NOT include `X-LangWatch-Semantic-Cache`
    And no semantic-cache Prometheus metrics are emitted for this VK
    So the v1.1 release is a pure additive feature — opt-in per VK,
    zero performance tax for VKs that don't enable it.

  @contract @migration
  Scenario: Hot-path overhead when semantic caching is DISABLED
    Given a VK without `semantic_cache` configured
    Then the overhead of the semantic-cache check is a single map lookup
    (config.SemanticCache == nil → fast return) < 10 ns
    And no goroutines are spawned for this path
    Consistent with the v1 GA hot-path budget of ~700 ns pre-bifrost.

  # ============================================================================
  # Out of scope — tagged for explicit rejection
  # ============================================================================

  @roadmap @out_of_scope
  Scenario: Cross-organization cache sharing is never supported
    When a customer asks "can two organizations share a semantic cache for
    a common FAQ prompt?"
    Then the answer is no, because the tenant isolation invariant
    (security.mdx §Tenant isolation) prohibits any cross-tenant state
    sharing, regardless of request payload similarity.

  @roadmap @out_of_scope
  Scenario: Vector similarity tuning via runtime ML is deferred
    When a customer asks for "adaptive threshold based on historical hit rate"
    Then this is rejected for v1.1 — the threshold is a static VK config.
    Customer-tunable dashboards for observing threshold vs hit-rate are
    a v1.2+ discussion.
