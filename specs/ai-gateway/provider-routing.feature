Feature: Model → provider routing via VK config

  # All scenarios in this file describe gateway routing decisions —
  # alias resolution, allowlist enforcement, MCP allow-list, deny-list
  # tool name. Implemented in the Go gateway service, out of scope for
  # the TS parity check. The /v1/models endpoint scenarios are also Go.

  Every request carries a `model` field. The gateway resolves that into a
  specific provider credential via (a) VK model_aliases, (b) explicit
  `provider/model` form, or (c) single-provider default.

  See contract.md §3 (routing), §4.2 (config shape), §11b (policy
  rules).

  Background:
    Given a VK with provider slots ["pc_openai_primary", "pc_anthropic_backup"]
    And model_aliases {"chat": "openai/gpt-5-mini", "thinking": "anthropic/claude-haiku-4-5-20251001"}
    And models_allowed ["gpt-5-mini", "claude-haiku-*", "gemini-2.5-flash"]

  Rule: Aliases always win over explicit names

    @integration @unimplemented
    Scenario: alias "chat" resolves to configured provider, ignoring explicit slash form
      When I POST /v1/chat/completions with {"model": "chat", ...}
      Then the gateway dispatches to OpenAI with model "gpt-5-mini"
      And the response header "X-LangWatch-Provider: openai" is set
      And the response header "X-LangWatch-Model: gpt-5-mini" is set

    @integration @unimplemented
    Scenario: alias redirects across providers
      When I POST /v1/chat/completions with {"model": "thinking", ...}
      Then the gateway dispatches to Anthropic with model "claude-haiku-4-5-20251001"
      And the request body sent to Anthropic preserves cache_control blocks byte-for-byte

  Rule: Explicit provider/model form bypasses aliases

    @integration @unimplemented
    Scenario: explicit openai/gpt-5-mini dispatches to OpenAI directly
      When I POST /v1/chat/completions with {"model": "openai/gpt-5-mini", ...}
      Then the gateway dispatches to OpenAI using the pc_openai_primary credential
      And the alias table is not consulted

  Rule: models_allowed allowlist blocks disallowed models

    @integration @unimplemented
    Scenario: model not in allowlist returns model_not_allowed
      Given the VK has models_allowed ["gpt-5-mini"]
      When I POST /v1/chat/completions with {"model": "gpt-4o"}
      Then the response status is 403
      And the error envelope type is "model_not_allowed"
      And no upstream provider is called

  Rule: Policy-rules enforcement at pre-dispatch

    @integration @unimplemented
    Scenario: deny-listed tool name returns tool_not_allowed before dispatch
      Given the VK policy_rules.tools.deny includes "^shell\\."
      When I POST /v1/chat/completions with tools [{"function": {"name": "shell.exec"}}]
      Then the response status is 403
      And the error envelope type is "tool_not_allowed"
      And no upstream provider is called

    @integration @unimplemented
    Scenario: MCP allow-list excludes unknown MCP
      Given the VK policy_rules.mcp.allow includes "^mcp-safe-.*$"
      And the request declares mcp_servers: [{"name": "mcp-safe-search"}, {"name": "mcp-unverified-x"}]
      When I POST /v1/chat/completions
      Then the response status is 403
      And the error envelope type is "tool_not_allowed"
      And policies_triggered includes "policy_violation_mcp"

  Rule: Provider credentials are resolved from pc_* references, not duplicated

    @integration @unimplemented
    Scenario: VK references existing ModelProvider via pc_* ref
      Given the org already has a ModelProvider row for OpenAI (used by evaluators)
      And the VK's providers[0].credentials_ref = the matching pc_* entry
      When a request dispatches
      Then the gateway uses the same underlying credentials as the evaluator would
      And no duplicate ModelProvider row was created

  Rule: Listed models endpoint reflects effective allowlist

    @unit
    Scenario: GET /v1/models returns aliases + allowed models
      When I GET /v1/models
      Then the response includes "chat" and "thinking" (aliases)
      And the response includes "gpt-5-mini"
      And the response does NOT include "gpt-4o" (not in models_allowed)

    @unit
    Scenario: GET /v1/models discovers models from self-hosted endpoints
      Given the VK has no models_allowed configured
      And a provider slot points at a self-hosted server via a base URL
      When I GET /v1/models
      Then the gateway asks that server for its model list
      And the server's models appear in the response
      And a server that fails to answer is skipped without failing the request

    @unit
    Scenario: GET /v1/models does not query endpoints when an allowlist is set
      Given the VK has models_allowed ["qwen3-14b"]
      And a provider slot points at a self-hosted server via a base URL
      When I GET /v1/models
      Then the response lists exactly the allowlist plus any aliases
      And no upstream server is queried

    @unit
    Scenario: GET /v1/models expands wildcard allowlist entries
      Given the VK has models_allowed ["claude-haiku-*"]
      And the endpoint's catalog holds "claude-haiku-4-5-20251001" and "claude-opus-4-20250514"
      When I GET /v1/models
      Then the response includes "claude-haiku-4-5-20251001"
      And "claude-haiku-*" itself is absent, a client cannot request a pattern
      And "claude-opus-4-20250514" is absent, the allowlist still applies to discovered models

    @unit
    Scenario: GET /v1/models filters models denied by policy rules
      Given the VK policy_rules.models.deny includes "^gpt-4.*$"
      And the effective model list would include "gpt-4o"
      When I GET /v1/models
      Then "gpt-4o" is absent from the response

  Rule: Model discovery cannot be turned into a probe of the gateway's network

    Discovery is the one place the gateway itself fetches a
    customer-controlled URL, so the endpoint policy that guards dispatch
    has to hold at every hop, not just on the configured base URL.

    @unit
    Scenario: GET /v1/models does not follow redirects away from the configured endpoint
      Given a provider slot points at a self-hosted server via a base URL
      And that server answers the model-list probe with a redirect
      When I GET /v1/models
      Then the redirect target is never contacted
      And the endpoint is skipped like any other failed probe

    @unit
    Scenario: GET /v1/models re-checks the resolved address before connecting
      Given a base URL whose host answers the policy check with a public address
      And the same host resolves to a private address when the connection is made
      When I GET /v1/models
      Then the gateway does not connect
      And the endpoint contributes no models
