Feature: Model → provider routing via VK config
  Every request carries a `model` field. The gateway resolves that into a
  specific provider credential via (a) VK model_aliases, (b) explicit
  `provider/model` form, or (c) single-provider default.

  See contract.md §3 (routing), §4.2 (config shape), §11b (blocked
  patterns).

  Background:
    Given a VK with provider slots ["pc_openai_primary", "pc_anthropic_backup"]
    And model_aliases {"chat": "openai/gpt-5-mini", "thinking": "anthropic/claude-haiku-4-5-20251001"}
    And models_allowed ["gpt-5-mini", "claude-haiku-*", "gemini-2.5-flash"]

  Rule: Aliases always win over explicit names

    @integration
    Scenario: alias "chat" resolves to configured provider, ignoring explicit slash form
      When I POST /v1/chat/completions with {"model": "chat", ...}
      Then the gateway dispatches to OpenAI with model "gpt-5-mini"
      And the response header "X-LangWatch-Provider: openai" is set
      And the response header "X-LangWatch-Model: gpt-5-mini" is set

    @integration
    Scenario: alias redirects across providers
      When I POST /v1/chat/completions with {"model": "thinking", ...}
      Then the gateway dispatches to Anthropic with model "claude-haiku-4-5-20251001"
      And the request body sent to Anthropic preserves cache_control blocks byte-for-byte

  Rule: Explicit provider/model form bypasses aliases

    @integration
    Scenario: explicit openai/gpt-5-mini dispatches to OpenAI directly
      When I POST /v1/chat/completions with {"model": "openai/gpt-5-mini", ...}
      Then the gateway dispatches to OpenAI using the pc_openai_primary credential
      And the alias table is not consulted

  Rule: models_allowed allowlist blocks disallowed models

    @integration
    Scenario: model not in allowlist returns model_not_allowed
      Given the VK has models_allowed ["gpt-5-mini"]
      When I POST /v1/chat/completions with {"model": "gpt-4o"}
      Then the response status is 403
      And the error envelope type is "model_not_allowed"
      And no upstream provider is called

  Rule: Blocked-patterns enforcement at pre-dispatch

    @integration
    Scenario: deny-listed tool name returns tool_not_allowed before dispatch
      Given the VK blocked_patterns.tools.deny includes "^shell\\."
      When I POST /v1/chat/completions with tools [{"function": {"name": "shell.exec"}}]
      Then the response status is 403
      And the error envelope type is "tool_not_allowed"
      And no upstream provider is called

    @integration
    Scenario: MCP allow-list excludes unknown MCP
      Given the VK blocked_patterns.mcp.allow includes "^mcp-safe-.*$"
      And the request declares mcp_servers: [{"name": "mcp-safe-search"}, {"name": "mcp-unverified-x"}]
      When I POST /v1/chat/completions
      Then the response status is 403
      And the error envelope type is "tool_not_allowed"
      And policies_triggered includes "blocked_mcp"

  Rule: Provider credentials are resolved from pc_* references, not duplicated

    @integration
    Scenario: VK references existing ModelProvider via pc_* ref
      Given the org already has a ModelProvider row for OpenAI (used by evaluators)
      And the VK's providers[0].credentials_ref = the matching pc_* entry
      When a request dispatches
      Then the gateway uses the same underlying credentials as the evaluator would
      And no duplicate ModelProvider row was created

  Rule: Listed models endpoint reflects effective allowlist

    @integration
    Scenario: GET /v1/models returns aliases + allowed models
      When I GET /v1/models
      Then the response includes "chat" and "thinking" (aliases)
      And the response includes "gpt-5-mini"
      And the response does NOT include "gpt-4o" (not in models_allowed)
