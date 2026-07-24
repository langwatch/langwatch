Feature: `langwatch claude` wrapper end-to-end
  As a developer running Claude Code through the LangWatch CLI wrapper
  I want my session to be authenticated via SSO + routed through the
  gateway with my Personal VK + traced end-to-end
  So that the company gets per-user attribution + budgets + governance
  while I get the same Claude Code experience I'd have running it
  directly

  Background:
    Given the LangWatch control plane is running on a test port
    And a stub Bifrost-compatible Anthropic provider is wired into the gateway test harness
    And alice exists as an org user with a default routing policy resolving to the stub Anthropic provider
    And alice has an active CLI device-flow session

  Scenario: `langwatch claude` injects the right env vars
    When the e2e harness spawns `langwatch claude --version` (with a stubbed Claude binary that prints its env vars)
    Then the spawned binary's env contains `ANTHROPIC_BASE_URL=<test-gateway-url>/api/v1`
    And the spawned binary's env contains `ANTHROPIC_AUTH_TOKEN=vk-lw-<alice's personal VK>`
    And no other Anthropic-related secret leaks via env

  Scenario: First completion routes through the gateway
    When the harness fires a stubbed `claude` invocation that POSTs to `${ANTHROPIC_BASE_URL}/messages` with `model: claude-3-5-sonnet-20241022`
    Then the gateway receives the request with bearer = alice's personal VK
    And resolves the routing policy → stub Anthropic provider
    And forwards the request → receives the stub response → returns to the wrapper
    And the response carries the right OTel `gen_ai.usage.input_tokens` + `output_tokens` + `gen_ai.system = "anthropic"`

  Scenario: Trace lands in the trace store with correct attribution
    Given the previous scenario completed
    When the harness queries the trace store after a brief flush window
    Then a span exists with `langwatch.principal_id = <alice user id>` + `langwatch.organization_id = <alice org id>` + `personal: true` JWT-claim attribution
    And the span's `gen_ai.system = "anthropic"` + `gen_ai.request.model = "claude-3-5-sonnet-20241022"`
    And cost + token counts are populated

  Scenario: Budget exhaustion blocks the call gracefully
    Given alice's monthly personal budget has been exhausted
    When the harness fires a `claude` request through the wrapper
    Then the gateway responds 429 with `error: "budget_exceeded"`
    And the wrapper surfaces a clear error message — NOT a confusing 5xx or hung response

  Scenario: Wrapper surfaces no-providers guidance when the device login lacks a personal VK
    Given alice's org has NO default routing policy AND NO accessible ModelProvider
    When the harness runs `langwatch claude` for a user without a Personal VK provisioned
    Then `langwatch login --device` succeeds (the device session is approved without `default_personal_vk` — see auth-cli.ts swallow path) but the local config has no VK secret
    And the wrapper's preflight check refuses to spawn the underlying tool
    And the wrapper surfaces the actionable message "Your organization has no AI providers configured. Ask an admin to add one at Settings → Model Providers." (not a stack trace)

  Scenario: Wrapper exits with the wrapped binary's exit code
    Given the stubbed `claude` binary exits with code 7
    When the harness runs `langwatch claude <some args>`
    Then `langwatch claude`'s exit code is 7 (passthrough)
