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

  @integration @cli @claude-code
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

  @integration @cli @claude-code @tools
  Scenario: Claude Code tool-call deltas stream byte-for-byte
    Given a tool-using prompt that triggers Claude to call "read_file"
    When I run the prompt through `claude --print`
    Then the SSE stream emitted by the gateway contains the same sequence of "input_json_delta" events as the upstream Anthropic API
    And no chunk is reordered, merged, or split
    And Claude Code's tool-call parser successfully reconstructs the tool call

  @integration @cli @claude-code @cache
  Scenario: Claude Code benefits from Anthropic cache_control passthrough
    Given the VK "cli-key" has cache.mode = "respect"
    And a Claude Code session with a 40000-token system prompt marked with ephemeral cache_control
    When the session runs 5 consecutive prompts
    Then the first response has cache_creation_input_tokens > 0 and cache_read_input_tokens = 0
    And responses 2-5 have cache_read_input_tokens > 30000 and cache_creation_input_tokens = 0
    And the trace records per-request "langwatch.cache_read_tokens" and "cache_write_tokens"

  # ============================================================================
  # Codex CLI
  # ============================================================================

  @integration @cli @codex
  Scenario: Codex reads OPENAI_BASE_URL and OPENAI_API_KEY against /v1/chat/completions
    Given environment variable "OPENAI_BASE_URL" is "http://localhost:7400/v1"
    And environment variable "OPENAI_API_KEY" is the "cli-key" secret
    And ~/.codex/config.toml has wire_api = "chat" for model "gpt-5-mini"
    When I run `codex exec "say hi"`
    Then the exit code is 0
    And Codex sent a POST to "http://localhost:7400/v1/chat/completions"
    And the request used header "Authorization: Bearer lw_vk_live_..."

  @integration @cli @codex @responses-api
  Scenario: Codex with wire_api "responses" hits /v1/responses
    Given environment variable "OPENAI_BASE_URL" is "http://localhost:7400/v1"
    And ~/.codex/config.toml has wire_api = "responses" for model "gpt-5-mini"
    When I run `codex exec "say hi"`
    Then Codex sent a POST to "http://localhost:7400/v1/responses"
    And the gateway successfully dispatched to OpenAI Responses API

  @integration @cli @codex @wire-api-mismatch
  Scenario: Codex wire_api="responses" against a Claude-routed model returns clear error
    Given VK "cli-key" has model_aliases {"gpt-4o": "anthropic/claude-haiku-4-5-20251001"}
    And ~/.codex/config.toml has wire_api = "responses" for model "gpt-4o"
    When I run `codex exec "say hi"`
    Then the gateway returns 400
    And the error envelope has type "bad_request"
    And the error message contains "resolves to Anthropic" AND "wire_api"
    And the error message suggests: set wire_api = "chat" in your Codex config

  @integration @cli @codex @model-alias
  Scenario: Codex with --model alias routes via VK's model_aliases map
    Given VK "cli-key" has model_aliases {"gpt-4o": "azure/my-deployment"}
    When I run `codex exec --model gpt-4o "say hi"`
    Then the gateway dispatched the request to Azure OpenAI
    And the response header "X-LangWatch-Provider" equals "azure_openai"
    And the response header "X-LangWatch-Model" equals "my-deployment"

  # ============================================================================
  # opencode
  # ============================================================================

  @integration @cli @opencode
  Scenario: opencode reads per-provider config and uses a VK
    Given opencode.json configures provider "langwatch" with baseUrl "http://localhost:7400/v1" and apiKey the "cli-key" secret
    And the default provider in opencode.json is "langwatch"
    When I run `opencode --prompt "say hi"`
    Then the exit code is 0
    And the LangWatch trace is recorded under project "gateway-demo"

  @integration @cli @opencode @multi-provider
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

  @integration @cli @cursor
  Scenario: Cursor with custom OpenAI API base hits the gateway
    Given Cursor settings have "OpenAI API Base URL" = "http://localhost:7400/v1"
    And Cursor settings have "OpenAI API Key" = the "cli-key" secret
    When the user triggers a completion
    Then Cursor sends to "http://localhost:7400/v1/chat/completions"
    And a trace is recorded in project "gateway-demo" with "langwatch.client.name" inferred from User-Agent

  @integration @cli @cursor @agent
  Scenario: Cursor Agent respects blocked_patterns.tools policy
    Given VK "cli-key" has blocked_patterns.tools.deny = ["^exec$"]
    When Cursor Agent attempts to call tool "exec" during a session
    Then the gateway returns 403 with type "tool_not_allowed"
    And Cursor Agent surfaces the error to the user

  # ============================================================================
  # Aider
  # ============================================================================

  @integration @cli @aider
  Scenario: Aider with OPENAI_API_BASE uses a VK
    Given environment variable "OPENAI_API_BASE" is "http://localhost:7400/v1"
    And environment variable "OPENAI_API_KEY" is the "cli-key" secret
    When I run `aider --message "say hi"`
    Then Aider exits 0 and produces a diff
    And the LangWatch trace reflects the Aider session

  # ============================================================================
  # Cross-CLI: budget hard-block surfaces as 402 for every CLI
  # ============================================================================

  @integration @cli @budget
  Scenario: Budget hard-cap blocks every CLI the same way
    Given project "gateway-demo" has a monthly budget of $100 with on_breach "block"
    And the project has spent $99.95 this month
    When each of {claude, codex, opencode, aider} makes one more request with "cli-key"
    Then every CLI receives HTTP 402
    And every CLI's error message is OpenAI-compatible and contains "Budget exceeded for scope=project window=month"

  # ============================================================================
  # Cross-CLI: revoked VK invalidates cache within 60s
  # ============================================================================

  @integration @cli @revocation
  Scenario: Revoking a VK stops all CLIs within the cache TTL window
    Given all 5 CLIs are running long-lived sessions with "cli-key"
    When an admin clicks "Revoke" on "cli-key" in the LangWatch UI
    Then within 60 seconds every CLI's next request returns 403 virtual_key_revoked
    And the gateway's auth cache for "cli-key" is evicted
    And the /changes long-poll delivered the vk_revoked event to all gateway replicas
