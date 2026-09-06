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

  Rule: Discovery and dispatch agree on what the key can do

    Any provider the materialised chain can dispatch to contributes its
    models to GET /v1/models, or the response says why it cannot. A key
    that completes fine against two providers while listing zero models is
    a displayed guarantee contradicting reality: the production canary key
    (openai + anthropic + bedrock, plain API keys) answered {"data": []}
    while both chat lanes returned 200, because discovery only probed
    base-URL credentials and silently skipped every hosted one.

    @unit
    Scenario: GET /v1/models lists hosted provider catalogs for API-key credentials
      Given the VK's chain holds openai and anthropic credentials with API keys and no base_url
      And no models_allowed is configured
      When I GET /v1/models
      Then the gateway asks each provider's public models endpoint with that credential's key
      And the anthropic probe carries the required anthropic-version header
      And models from both providers appear in the response with correct attribution

    @unit
    Scenario: GET /v1/models lists deployment-mapped models without probing
      Given a bedrock credential whose deployment map holds "claude-haiku-4-5"
      When I GET /v1/models
      Then "claude-haiku-4-5" is listed without any outbound call
      # The map's keys are the ids dispatch routes onto the provider's
      # deployments, so they are the catalog for deployment-routed
      # providers (Azure, Bedrock, Vertex).

    @unit
    Scenario: GET /v1/models says so when a provider's catalog cannot be enumerated
      Given the VK's chain holds a bedrock credential with no deployment map
      When I GET /v1/models
      Then the response carries header X-Langwatch-Models-Discovery-Incomplete containing "bedrock:not-enumerable"
      And the body stays exactly the OpenAI list shape

    @unit
    Scenario: a failed catalog probe surfaces as a gap, not a silent empty list
      Given an openai credential whose catalog endpoint answers 500
      When I GET /v1/models
      Then the response carries header X-Langwatch-Models-Discovery-Incomplete containing "openai:probe-failed"
      And other providers' models still appear

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

  Rule: A key can be narrowed to specific providers, or left open to all

    Which providers a key may reach is a list on the key, not an abstract
    scope. Leaving it open is stored as the absence of a list, which is what
    makes "all" mean all current and future providers rather than a snapshot
    of the ones that happened to exist on the day the key was made.

    @integration
    Scenario: A key left open reaches providers added after it was created
      Given a key created with every provider allowed
      When a provider is added to the organization afterwards
      Then the key can reach it without being edited

    @integration
    Scenario: A key narrowed to one provider reaches only that provider
      Given a key allowed to use exactly one provider
      When its configuration is read
      Then only that provider is offered to the gateway
      And a provider added afterwards is not

    @integration
    Scenario: A key cannot name a provider outside its reach
      When a key is saved naming a provider its ownership does not reach
      Then the save is refused

    @integration
    Scenario: A key cannot be saved with no providers at all
      When a key is saved allowing no providers
      Then the save is refused

    @integration
    Scenario: A provider outside the key's allowlist is refused even if a stale chain offers it
      Given a key allowed to use exactly one provider
      But a configuration bundle whose credential chain still carries another provider
      When a request arrives that would fall back onto the other provider
      Then the gateway does not dispatch to it
      # The materialised chain already respects the allowlist; this is the
      # dispatch-side check that keeps a stale or hand-crafted bundle from
      # turning a narrowing the UI displays as active into a decoration.

  Rule: A route that forwards a request unchanged decides the vendor

    The Gemini surface at /v1beta sends the caller's body and URL path to
    Google as they arrived. The model id comes from that path, so it carries
    no provider prefix, and the credential chain picked the vendor instead.
    A key with an OpenAI credential and no Google one sent the body to
    OpenAI, which answered 404 for a model it never had. The 404 is the
    small part. The prompt had already left for a vendor the caller never
    named.

    A route that forwards bytes unchanged knows its own vendors from the
    registration. Gemini and Vertex both serve this wire, so either
    credential can answer it. No other credential may receive the body.

    @unit
    Scenario: A provider-native route refuses a key with no provider that speaks it
      Given a key with an OpenAI credential and no Google credential
      When a request arrives on the Gemini route at /v1beta
      Then the request is refused as model provider not bound
      And the refusal names the providers that serve the route
      And no call is made to any provider

    @unit
    Scenario: Either Google credential serves the provider-native route
      Given a key with a Vertex credential and no Gemini credential
      When a request arrives on the Gemini route at /v1beta
      Then the Vertex credential serves it

    @unit
    Scenario: A translated route leaves the provider choice to the model
      Given a key with credentials for several providers
      When a request arrives on /v1/chat/completions
      Then the route pins no provider
      And the resolved model decides which credential serves the request
