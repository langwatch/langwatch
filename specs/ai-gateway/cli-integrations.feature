Feature: AI Gateway — Coding CLI integrations
  As a LangWatch customer rolling out governed AI usage to engineering teams
  I want every coding CLI (Claude Code, Codex, opencode, Cursor, Aider) to work
  against the LangWatch AI Gateway with no custom client code
  So that my engineers keep their tools while the org gains budget/visibility/policy

  The gateway exposes both OpenAI-compatible and Anthropic-compatible endpoints
  on the same port. CLIs are configured by pointing their standard base-URL env
  var at the gateway and their API-key env var at a LangWatch VK. The gateway's
  streaming contract (pre-first-chunk mutations allowed, post-first-chunk
  byte-for-byte) preserves tool-call deltas that these CLIs depend on.

  Background:
    Given the LangWatch AI Gateway is running at "http://localhost:7400"
    And a LangWatch virtual key "cli-key" exists with secret "lw_vk_live_01HZX..."
    And the key has providers [openai (primary), anthropic (fallback)]
    And the key has models_allowed ["gpt-5-mini", "claude-haiku-4-5-20251001"]

  # ============================================================================
  # Claude Code
  # ============================================================================

  @integration @cli @claude-code @unimplemented
  Scenario: Claude Code reads ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN
    Given environment variable "ANTHROPIC_BASE_URL" is "http://localhost:7400"
    And environment variable "ANTHROPIC_AUTH_TOKEN" is the "cli-key" secret
    When I run `claude --print "say hi"`
    Then the exit code is 0
    And the Claude Code process sent a POST to "http://localhost:7400/v1/messages"
    And the request used header "x-api-key: lw_vk_live_..."
    And the request body was a valid Anthropic Messages payload
    And the response was OpenAI-compatible-error-free (no 401/402/403/404)
    And the LangWatch trace in project "gateway-demo" shows span "gateway.messages" with attribute "langwatch.client.name=claude-code"

  @integration @cli @claude-code @tools @unimplemented
  Scenario: Claude Code tool-call deltas stream byte-for-byte
    Given a tool-using prompt that triggers Claude to call "read_file"
    When I run the prompt through `claude --print`
    Then the SSE stream emitted by the gateway contains the same sequence of "input_json_delta" events as the upstream Anthropic API
    And no chunk is reordered, merged, or split
    And Claude Code's tool-call parser successfully reconstructs the tool call

  @integration @cli @claude-code @cache @unimplemented
  Scenario: Claude Code benefits from Anthropic cache_control passthrough
    Given the VK "cli-key" has cache.mode = "respect"
    And a Claude Code session with a 40000-token system prompt marked with ephemeral cache_control
    When the session runs 5 consecutive prompts
    Then the first response has cache_creation_input_tokens > 0 and cache_read_input_tokens = 0
    And responses 2-5 have cache_read_input_tokens > 30000 and cache_creation_input_tokens = 0
    And the trace records per-request "gen_ai.usage.cache_read.input_tokens" and "gen_ai.usage.cache_creation.input_tokens" (semconv-only post iter 42)

  # ============================================================================
  # Codex CLI
  # ============================================================================

  @integration @cli @codex @unimplemented
  Scenario: Codex reads OPENAI_BASE_URL and OPENAI_API_KEY against /v1/chat/completions
    Given environment variable "OPENAI_BASE_URL" is "http://localhost:7400/v1"
    And environment variable "OPENAI_API_KEY" is the "cli-key" secret
    And ~/.codex/config.toml has wire_api = "chat" for model "gpt-5-mini"
    When I run `codex exec "say hi"`
    Then the exit code is 0
    And Codex sent a POST to "http://localhost:7400/v1/chat/completions"
    And the request used header "Authorization: Bearer lw_vk_live_..."

  @integration @cli @codex @responses-api @unimplemented
  Scenario: Codex with wire_api "responses" hits /v1/responses
    Given environment variable "OPENAI_BASE_URL" is "http://localhost:7400/v1"
    And ~/.codex/config.toml has wire_api = "responses" for model "gpt-5-mini"
    When I run `codex exec "say hi"`
    Then Codex sent a POST to "http://localhost:7400/v1/responses"
    And the gateway successfully dispatched to OpenAI Responses API

  @integration @cli @codex @wire-api-mismatch @unimplemented
  Scenario: Codex wire_api="responses" against a Claude-routed model returns clear error
    Given VK "cli-key" has model_aliases {"gpt-4o": "anthropic/claude-haiku-4-5-20251001"}
    And ~/.codex/config.toml has wire_api = "responses" for model "gpt-4o"
    When I run `codex exec "say hi"`
    Then the gateway returns 400
    And the error envelope has type "bad_request"
    And the error message contains "resolves to Anthropic" AND "wire_api"
    And the error message suggests: set wire_api = "chat" in your Codex config

  @integration @cli @codex @model-alias @unimplemented
  Scenario: Codex with --model alias routes via VK's model_aliases map
    Given VK "cli-key" has model_aliases {"gpt-4o": "azure/my-deployment"}
    When I run `codex exec --model gpt-4o "say hi"`
    Then the gateway dispatched the request to Azure OpenAI
    And the response header "X-LangWatch-Provider" equals "azure_openai"
    And the response header "X-LangWatch-Model" equals "my-deployment"

  # ============================================================================
  # opencode
  # ============================================================================

  @integration @cli @opencode @unimplemented
  Scenario: opencode reads per-provider config and uses a VK
    Given opencode.json configures provider "langwatch" with baseUrl "http://localhost:7400/v1" and apiKey the "cli-key" secret
    And the default provider in opencode.json is "langwatch"
    When I run `opencode --prompt "say hi"`
    Then the exit code is 0
    And the LangWatch trace is recorded under project "gateway-demo"

  @integration @cli @opencode @multi-provider @unimplemented
  Scenario: opencode switching primaries is a VK edit, not a CLI config change
    Given opencode is pointed at the gateway via the "cli-key" VK
    And a user changes the VK's primary provider from openai to anthropic via the LangWatch UI
    When I run `opencode --prompt "hi"` on the next session
    Then the request is dispatched to Anthropic
    And no opencode.json file was modified
    And the trace shows "X-LangWatch-Provider=anthropic"

  # ============================================================================
  # Cursor
  # ============================================================================

  @integration @cli @cursor @unimplemented
  Scenario: Cursor with custom OpenAI API base hits the gateway
    Given Cursor settings have "OpenAI API Base URL" = "http://localhost:7400/v1"
    And Cursor settings have "OpenAI API Key" = the "cli-key" secret
    When the user triggers a completion
    Then Cursor sends to "http://localhost:7400/v1/chat/completions"
    And a trace is recorded in project "gateway-demo" with "langwatch.client.name" inferred from User-Agent

  @integration @cli @cursor @agent @unimplemented
  Scenario: Cursor Agent respects policy_rules.tools policy
    Given VK "cli-key" has policy_rules.tools.deny = ["^exec$"]
    When Cursor Agent attempts to call tool "exec" during a session
    Then the gateway returns 403 with type "tool_not_allowed"
    And Cursor Agent surfaces the error to the user

  # ============================================================================
  # Aider
  # ============================================================================

  @integration @cli @aider @unimplemented
  Scenario: Aider with OPENAI_API_BASE uses a VK
    Given environment variable "OPENAI_API_BASE" is "http://localhost:7400/v1"
    And environment variable "OPENAI_API_KEY" is the "cli-key" secret
    When I run `aider --message "say hi"`
    Then Aider exits 0 and produces a diff
    And the LangWatch trace reflects the Aider session

  # ============================================================================
  # Cross-CLI: budget hard-block surfaces as 402 for every CLI
  # ============================================================================

  @integration @cli @budget @unimplemented
  Scenario: Budget hard-cap blocks every CLI the same way
    Given project "gateway-demo" has a monthly budget of $100 with on_breach "block"
    And the project has spent $99.95 this month
    When each of {claude, codex, opencode, aider} makes one more request with "cli-key"
    Then every CLI receives HTTP 402
    And every CLI's error message is OpenAI-compatible and contains "Budget exceeded for scope=project window=month"

  # ============================================================================
  # Cross-CLI: revoked VK invalidates cache within 60s
  # ============================================================================

  @integration @cli @revocation @unimplemented
  Scenario: Revoking a VK stops all CLIs within the cache TTL window
    Given all 5 CLIs are running long-lived sessions with "cli-key"
    When an admin clicks "Revoke" on "cli-key" in the LangWatch UI
    Then within 60 seconds every CLI's next request returns 403 virtual_key_revoked
    And the gateway's auth cache for "cli-key" is evicted
    And the /changes long-poll delivered the vk_revoked event to all gateway replicas

  # ============================================================================
  # langwatch CLI — cache-rules subcommand (alexis iter 45 — 93538e323)
  # ============================================================================
  # The CLI is a thin wrapper over /api/gateway/v1/cache-rules; full contract
  # lives in specs/ai-gateway/cache-control-rules.feature and
  # specs/ai-gateway/public-rest-api.feature §Cache rules. Scenarios here
  # pin the CLI-specific UX (flag → wire mapping, bulk-apply idempotency,
  # required-permission surfacing).

  @integration @cli @cache-rules @unimplemented
  Scenario: Create a rule with inline matchers (tag + mode + ttl)
    Given a CLI token with "gatewayCacheRules:create"
    When I run `langwatch cache-rules create --name force-cache-enterprise --priority 300 --mode force --ttl 600 --match-tag tier=enterprise`
    Then exit status is 0
    And POST /api/gateway/v1/cache-rules is called with body:
      """
      {
        "name": "force-cache-enterprise",
        "priority": 300,
        "matchers": { "vk_tags": ["tier=enterprise"] },
        "action":   { "mode": "force", "ttl": 600 }
      }
      """
    And stdout shows the created rule id + mode badge

  @integration @cli @cache-rules @unimplemented
  Scenario: Repeatable --match-tag flags compose into an AND-subset vk_tags array
    When I run `langwatch cache-rules create --name multi-tag --mode disable --match-tag env=prod --match-tag team=ml`
    Then the posted matchers.vk_tags equals ["env=prod", "team=ml"]
    # Matches the Go evaluator's AND-subset semantics (every listed tag must
    # be present on the VK for the rule to match).

  @integration @cli @cache-rules @unimplemented
  Scenario: --match-model accepts trailing-* glob without quoting tripping the shell
    When I run `langwatch cache-rules create --name haiku-family --mode respect --match-model "claude-haiku-*"`
    Then the posted matchers.model equals "claude-haiku-*"
    # CLI docs explicitly quote the glob to prevent zsh expansion.

  @integration @cli @cache-rules @unimplemented
  Scenario: `update` preserves unspecified fields; specifying matchers/action replaces them
    Given an existing rule "rule_xxx" with matchers {vk_tags: ["env=prod"], model: "gpt-5-mini"}
    When I run `langwatch cache-rules update rule_xxx --priority 400`
    Then the PATCH body has only {"priority": 400}
    And the stored matchers are unchanged
    When I run `langwatch cache-rules update rule_xxx --match-model claude-haiku-*`
    Then the PATCH body has matchers equal to exactly {"model": "claude-haiku-*"}
    # REPLACE semantics pinned on the CLI path too (mirrors REST §Cache rules PATCH behaviour).

  @integration @cli @cache-rules @unimplemented
  Scenario: `--enable` / `--disable` toggle the enabled flag without touching other fields
    Given rule "rule_xxx" is currently enabled
    When I run `langwatch cache-rules update rule_xxx --disable`
    Then PATCH body equals {"enabled": false}
    When I run `langwatch cache-rules update rule_xxx --enable`
    Then PATCH body equals {"enabled": true}

  @integration @cli @cache-rules @unimplemented
  Scenario: `archive` returns the archived row so scripts can confirm the timestamp
    When I run `langwatch cache-rules archive rule_xxx --format json`
    Then exit status is 0
    And stdout contains a JSON object with archived_at populated (ISO-8601)

  @integration @cli @cache-rules @unimplemented
  Scenario: `apply --file cache-rules.json` is idempotent by name (CI-friendly)
    Given a file `cache-rules.json` with 3 rules keyed by name
    When I run `langwatch cache-rules apply --file cache-rules.json` twice
    Then the second run produces zero new rules
    And existing rules are updated in place (matched by name)
    And the response summary reports `created=0, updated=3, archived=0`

  @integration @cli @cache-rules @security @unimplemented
  Scenario: CLI surfaces the exact missing permission on a 403
    Given a CLI token with only "gatewayCacheRules:view"
    When I run `langwatch cache-rules create --name x --mode respect --match-tag env=prod`
    Then exit status is non-zero
    And stderr contains "permission_denied"
    And stderr names "gatewayCacheRules:create" as the missing permission

  @integration @cli @cache-rules @unimplemented
  Scenario: `export --file` closes the round-trip for git-backed rule ops (alexis iter 50)
    Given three cache rules in the org
    When I run `langwatch cache-rules export --file rules.json`
    Then exit status is 0
    And `rules.json` contains an array of 3 rule objects
    And each object has the same shape as POST /cache-rules would accept (name + priority + enabled + matchers + action)
    And archived rules are NOT included (exports the live set only)
    When I run `langwatch cache-rules apply --file rules.json`
    Then the response summary reports `created=0, updated=3, archived=0`
    # Round-trip: export → commit to infra monorepo → CI apply on deploy.
    # Enables the enterprise rule-ops workflow where rules live alongside
    # service code and drift is caught by git diff after a UI edit.

  @integration @cli @cache-rules @security @unimplemented
  Scenario: `export` requires gatewayCacheRules:view permission
    Given a CLI token with no gatewayCacheRules permissions
    When I run `langwatch cache-rules export --file rules.json`
    Then exit status is non-zero
    And stderr names "gatewayCacheRules:view" as the missing permission
    And `rules.json` is NOT created

  @integration @cli @cache-rules @unimplemented
  Scenario: `apply --file` is a composite create/update/archive permission requirement
    Given a CLI token with "gatewayCacheRules:view" + ":create" but NOT ":update" + ":delete"
    And a rules.json file that would require both an update and an archive
    When I run `langwatch cache-rules apply --file rules.json`
    Then exit status is non-zero
    And stderr lists BOTH "gatewayCacheRules:update" AND "gatewayCacheRules:delete" as missing
    # Per alexis iter 50 permission table: apply = :create + :update + :delete composite
    # because diff-apply touches all three verbs depending on what's in the file.
