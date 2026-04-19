Feature: Cache control rules — operator-defined overrides without client code changes
  # Ref: docs/ai-gateway/cache-control.mdx §Cache rules
  # v1 scope. Narrower than Cloudflare Page Rules on purpose: match on a small
  # set of request-identity fields, apply a cache mode. Rules are compiled into
  # the VK bundle at /changes-refresh time so the hot path stays at ~700 ns.

  Background:
    Given the gateway is running with OPENAI_API_KEY, ANTHROPIC_API_KEY bound
    And an organisation "acme" with one project "acme-demo" and one team "acme-engineers"

  # ─────────────────────────────────────────────────────────────────────────
  # §1. Rule shape + precedence
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Precedence — per-request header beats every rule
    Given a VK "vk_prod_openai" with cache default "respect"
    And a cache rule matching VK "vk_prod_openai" with action "force" and ttl 300
    When a request to /v1/chat/completions carries header "X-LangWatch-Cache: disable"
    Then the response header "X-LangWatch-Cache-Mode" equals "disable"
    And the forwarded request body has NO cache_control markers
    And the response has NOT triggered the rule
    And span attribute "langwatch.cache.rule_id" is absent

  Scenario: Precedence — matched rule beats per-VK default
    Given a VK "vk_prod_openai" with cache default "respect"
    And a cache rule matching VK "vk_prod_openai" with action "disable"
    When a request to /v1/chat/completions does NOT set X-LangWatch-Cache
    Then the response header "X-LangWatch-Cache-Mode" equals "disable"
    And the matched rule id is present on span attribute "langwatch.cache.rule_id"

  Scenario: Precedence — no matching rule falls through to VK default
    Given a VK "vk_prod_openai" with cache default "respect"
    And no cache rules defined for the VK's organisation
    When a request to /v1/chat/completions does NOT set X-LangWatch-Cache
    Then the response header "X-LangWatch-Cache-Mode" equals "respect"
    And span attribute "langwatch.cache.rule_id" is absent

  # ─────────────────────────────────────────────────────────────────────────
  # §2. Matcher semantics — first-match-wins by priority
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: First-match-wins by priority descending
    Given two rules configured for the organisation:
      | priority | match                          | action             |
      | 200      | vk_tags: ["env=prod"]          | force ttl=600      |
      | 100      | model: "gpt-5-mini"            | disable            |
    And a VK "vk_prod_openai" with tags ["env=prod"]
    When a request to /v1/chat/completions resolves to model "gpt-5-mini"
    Then the rule with priority 200 matches first
    And the response header "X-LangWatch-Cache-Mode" equals "force"
    And span attribute "langwatch.cache.rule_id" equals the priority-200 rule id

  Scenario: AND semantics across non-null matchers
    Given a cache rule with matchers:
      | field             | value                        |
      | vk_tags           | ["env=prod", "team=ml"]      |
      | model             | "gpt-5-mini"                 |
      | request_metadata  | {"X-Source": "internal-api"} |
    When a request satisfies vk_tags + model but request_metadata is absent
    Then the rule does NOT match
    And the response header "X-LangWatch-Cache-Mode" equals the VK default

  Scenario: Matcher — vk_prefix matches a string prefix of the VK display-prefix form
    Given a cache rule matching vk_prefix "lw_vk_eval_"
    And a VK minted with display prefix "lw_vk_eval_01HZX9"
    When a request is made with that VK
    Then the rule matches
    And the rule's action is applied
    # Invariant (sergey iter 46 clarification): both `matchers.vk_id` and
    # `matchers.vk_prefix` target the SAME field — the VK's display-prefix
    # form (e.g. `lw_vk_live_01HZX9K3M...`). vk_id is exact; vk_prefix is
    # strings.HasPrefix. A rule sets one or the other; setting both would
    # AND them together (unusual but valid).

  Scenario: Matcher — principal_id restricts to one identity
    Given a cache rule matching principal_id "user_01HZX..."
    When a request is made from principal "user_01HZX..."
    Then the rule matches
    When a request is made from principal "user_OTHER..."
    Then the rule does NOT match

  Scenario: Matcher — request_metadata matches a single header key-value
    Given a cache rule matching request_metadata {"X-Customer-Tier": "enterprise"}
    When a request carries header "X-Customer-Tier: enterprise"
    Then the rule matches
    When a request carries header "X-Customer-Tier: free"
    Then the rule does NOT match

  Scenario: Matcher — model supports trailing-* glob (not full regex, by design)
    Given a cache rule matching model "claude-haiku-*"
    When a request resolves to "claude-haiku-4-5-20251001"
    Then the rule matches
    When a request resolves to "claude-sonnet-4-6"
    Then the rule does NOT match
    # Design note: we deliberately do NOT support regex here — matchers must
    # be trivially auditable in the UI (Lane A iter 45 evaluator comment).

  Scenario: Matcher — vk_tags is AND-subset (every required tag must be present)
    Given a cache rule matching vk_tags ["env=prod", "team=ml"]
    And a VK with tags ["env=prod", "team=ml", "region=eu"]
    When a request is made with that VK
    Then the rule matches (extra tag is ignored)
    Given a VK with tags ["env=prod"] only
    Then the rule does NOT match (missing "team=ml")

  # ─────────────────────────────────────────────────────────────────────────
  # §3. Action behaviour — per-provider dispatch
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Action "force" on Anthropic injects cache_control: ephemeral on system + last user turn
    Given a cache rule matching VK "vk_prod_anthropic" with action "force" ttl 300
    And the VK resolves to an Anthropic model
    When a request arrives at /v1/messages with NO cache_control in the body
    Then the forwarded request body has cache_control: {type: "ephemeral"} on system[-1]
    And the forwarded request body has cache_control: {type: "ephemeral"} on messages[-1].content[-1]
    And the response header "X-LangWatch-Cache-Mode" equals "force"

  Scenario: Action "force" on Anthropic does NOT double-inject if client already set cache_control
    Given a cache rule matching VK "vk_prod_anthropic" with action "force" ttl 300
    When a request arrives at /v1/messages WITH cache_control: {type: "ephemeral"} on system[0]
    Then the forwarded request body preserves the client's existing cache_control
    And no duplicate cache_control fields are added

  Scenario: Action "force" on OpenAI / Azure is a no-op on wire
    Given a cache rule matching VK "vk_prod_openai" with action "force" ttl 300
    And the VK resolves to "gpt-5-mini" (OpenAI)
    When a request arrives at /v1/chat/completions
    Then the forwarded request body is byte-identical to the client's request
    And the response header "X-LangWatch-Cache-Mode" equals "force"
    And span attribute "langwatch.cache.provider_behavior" equals "automatic"

  Scenario: Action "force" on Gemini returns 400 cache_override_not_implemented (v1)
    Given a cache rule matching VK "vk_prod_gemini" with action "force" ttl 300
    And the VK resolves to "gemini-2.5-flash"
    When a request arrives at /v1/chat/completions
    Then the response status is 400
    And error.type is "cache_override_not_implemented"
    And error.message points at /ai-gateway/cache-control#force

  Scenario: Action "disable" strips cache_control from Anthropic body recursively
    Given a cache rule matching VK "vk_prod_anthropic" with action "disable"
    When a request arrives at /v1/messages with cache_control on system[0], messages[0].content[0], and tools[0]
    Then the forwarded request body has NO cache_control anywhere
    And the response header "X-LangWatch-Cache-Mode" equals "disable"

  Scenario: Action "disable" strips cachedContent field from Gemini body
    Given a cache rule matching VK "vk_prod_gemini" with action "disable"
    When a request arrives at /v1/chat/completions with cachedContent: "cache_abc"
    Then the forwarded request body has NO cachedContent field
    And the response header "X-LangWatch-Cache-Mode" equals "disable"

  # ─────────────────────────────────────────────────────────────────────────
  # §4. Evaluation cost — hot-path invariant
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Rules are compiled into the VK bundle at /changes-refresh time
    Given a VK "vk_prod_openai" with 5 cache rules scoped at org level
    When the gateway fetches /internal/gateway/config/vk_prod_openai
    Then the bundle response contains a cache_rules array of length 5
    And cache_rules is pre-sorted by priority descending
    And no control-plane round-trip is required per request

  Scenario: Rule evaluation is sub-100-nanosecond — 28× headroom vs 700 ns target
    Given a VK bundle with 10 cache rules attached
    When a request flows through the gateway
    Then cacherules.Evaluate executes in under 100 nanoseconds (Lane A iter 45 benchmarks: 24.4 ns/op 4th-match, 25.0 ns/op no-match, 4.4 ns/op empty-rules fast-path; amd64 VirtualApple 2.5GHz)
    And there are zero allocations on the hot path (0 B/op, 0 allocs/op)
    And the ~700 ns hot-path target is preserved with 28× headroom

  Scenario: Rule update propagates within 30 seconds via /changes long-poll
    Given a VK "vk_prod_openai" is in use by a client
    When an admin creates a new cache rule matching that VK
    Then within 30 seconds the next request hits the new rule
    And the transition is observable via langwatch.cache.rule_id changing on the span

  # ─────────────────────────────────────────────────────────────────────────
  # §5. Observability — rule attribution in traces + metrics
  # ─────────────────────────────────────────────────────────────────────────
  # NOTE: Lane A iter 45 (e037888be) ships the evaluator in isolation with
  # benchmark evidence. Span-attr + metric emission requires the
  # follow-up iter wiring Evaluate() into cacheoverride.Apply — scheduled
  # before v1 GA so this section's scenarios are contract, not reality,
  # until that commit lands.

  Scenario: Span attributes record the matched rule
    Given a cache rule "rule_prod_force" matches a request
    When the request completes
    Then span attribute "langwatch.cache.rule_id" equals "rule_prod_force"
    And span attribute "langwatch.cache.rule_priority" equals the rule's priority
    And span attribute "langwatch.cache.mode_applied" equals the rule's action.mode

  Scenario: Prometheus counter records rule hits by mode + provider
    Given a cache rule "rule_prod_force" is configured
    When 50 requests match the rule, dispatched to OpenAI
    Then counter gateway_cache_rule_hits_total{rule_id="rule_prod_force",mode="force",provider="openai"} increments by 50

  Scenario: Rule miss does not increment rule-hit counter
    Given no cache rules match a request
    Then counter gateway_cache_rule_hits_total does NOT increment for that request
    And the request's trace has no langwatch.cache.rule_id attribute

  # ─────────────────────────────────────────────────────────────────────────
  # §6. RBAC — who can author rules
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: gatewayCacheRules:create permission gates rule creation
    Given a user with role MEMBER (no gatewayCacheRules:create)
    When they POST /api/gateway/v1/cache-rules
    Then the response is 403 permission_denied
    And error.message names "gatewayCacheRules:create" as the missing permission

  Scenario: ADMIN role has full CRUD on cache rules
    Given a user with role ADMIN
    When they POST / PATCH / DELETE on /api/gateway/v1/cache-rules
    Then every operation succeeds
    And every mutation emits an audit log entry

  # ─────────────────────────────────────────────────────────────────────────
  # §7. UI behaviour — /gateway/cache-rules page (Lane B iter 40, 73552f964)
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: List view shows priority-ordered rules with matcher + action badges
    Given three cache rules with priorities 200 / 100 / 50 in the org
    When the user opens /gateway/cache-rules
    Then rows appear in descending priority order
    And each row shows a matcher summary (vk_id / vk_prefix / vk_tags / principal_id / model / request_metadata)
    And each row shows an action badge colour-coded by mode:
      | mode    | colour  |
      | respect | green   |
      | force   | orange  |
      | disable | red     |
    And rules with action.ttl set show a "TTL {seconds}s" indicator
    And rules with action.salt set show a "salted" indicator

  Scenario: Precedence copy at top of page reminds the operator of ordering
    When the user opens /gateway/cache-rules
    Then page header copy contains "per-request header > rule > VK default"
    And it links to /ai-gateway/cache-control#precedence

  Scenario: Inline enable / disable toggle is one click
    Given a rule "rule_prod" is currently enabled
    When the user clicks the Switch in the row's Enabled column
    Then the rule's enabled flag flips to false
    And a GatewayChangeEvent is emitted (kind = CACHE_RULE_UPDATED)
    And a GatewayAuditLog row records the toggle with before/after JSON

  Scenario: Create drawer uses progressive disclosure for mode-dependent fields
    When the user opens the "New cache rule" drawer
    Then mode defaults to "respect" and the TTL field is hidden
    When the user changes mode to "force"
    Then the TTL field becomes visible
    When the user changes mode back to "respect" or "disable"
    Then the TTL field is hidden and its value cleared

  Scenario: Edit drawer round-trips matchers + action via fromWire/toWire
    Given an existing rule with matchers {vk_tags: ["env=prod"], model: "gpt-5-mini"} and action {mode: "force", ttl: 300}
    When the user opens the Edit drawer for that rule
    Then the matcher fields show those exact values
    And the action fields show mode=force ttl=300
    When the user saves without changes
    Then the PATCH body is semantically equivalent to the original (no spurious diffs)

  Scenario: Archive via row menu soft-deletes and emits CACHE_RULE_DELETED event
    Given a rule "rule_old"
    When the user clicks "Archive" from the row's menu and confirms
    Then the rule's archivedAt is set to now
    And a GatewayChangeEvent (kind = CACHE_RULE_DELETED) is emitted
    And the rule disappears from the default list view (archived filter off)
    And an audit log row records the archive with before-JSON preserved

  Scenario: MEMBER role sees the page as read-only (no Create / Edit / Archive actions)
    Given a user with role MEMBER (gatewayCacheRules:view only)
    When they open /gateway/cache-rules
    Then the list renders but the "New cache rule" button is disabled with a tooltip naming the missing permission
    And row menu Edit + Archive entries are disabled
    And the Enabled switch is read-only

  # ─────────────────────────────────────────────────────────────────────────
  # §8. Open questions (deferred from v1 scope)
  # ─────────────────────────────────────────────────────────────────────────

  # - time_window matchers (cron-style time-of-day / day-of-week) — deferred
  # - semantic-cache salt (composes with the gateway's own semantic cache, v1.1)
  # - force on Gemini (requires /cachedContents pre-POST, breaks zero-hop) — v1.1
  # - rule import/export as JSON — v1.1 (CLI scripting)
  # - A/B mode: 50/50 split with different rules — v1.2
