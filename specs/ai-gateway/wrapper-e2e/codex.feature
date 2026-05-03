Feature: `langwatch codex` wrapper end-to-end
  As a developer running OpenAI Codex CLI through the LangWatch wrapper
  I want my session authenticated via SSO + routed through the gateway
  with my Personal VK + traced
  So that all the same governance properties hold as for `langwatch claude`,
  with OpenAI as the provider instead of Anthropic

  Spec maps to Phase 11 (Sergey: P11-per-wrapper).

  Background:
    Given the LangWatch control plane is running on a test port
    And a stub Bifrost-compatible OpenAI provider is wired into the gateway
    And alice exists as an org user with a default routing policy resolving to the stub OpenAI provider
    And alice has an active CLI device-flow session

  Scenario: `langwatch codex` injects OpenAI-flavored env vars
    When the harness spawns `langwatch codex --version`
    Then env contains `OPENAI_BASE_URL=<test-gateway-url>/api/v1`
    And env contains `OPENAI_API_KEY=lw_vk_<alice's personal VK>`
    And no OpenAI-side secret leaks via env

  Scenario: Codex invocation routes through gateway
    When the harness fires a stubbed `codex` invocation that POSTs `${OPENAI_BASE_URL}/chat/completions` with `model: gpt-5-mini`
    Then the gateway receives the request with bearer = alice's personal VK
    And forwards to the stub OpenAI provider per the routing policy
    And the response carries `gen_ai.system = "openai"` + correct token counts

  Scenario: Trace attribution
    Given the previous scenario completed
    Then a span exists with alice's principal_id + organization_id + `personal: true` claims
    And `gen_ai.system = "openai"` + `gen_ai.request.model = "gpt-5-mini"`

  Scenario: Wrapper passes through args to the wrapped binary
    Given the stubbed `codex` binary echoes `argv` to stdout
    When the harness runs `langwatch codex --tool foo --output bar`
    Then the wrapper invocation passes `--tool foo --output bar` to the wrapped binary
    And the wrapper's stdout matches the binary's stdout (no rewriting)

  Scenario: Exit code passthrough
    Given the stubbed `codex` binary exits with code 3
    Then `langwatch codex`'s exit code is 3
