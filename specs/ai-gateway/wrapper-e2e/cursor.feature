Feature: `langwatch cursor` wrapper end-to-end
  As a developer running Cursor CLI / extension through the LangWatch wrapper
  I want my session authenticated + routed through the gateway with my
  Personal VK + traced
  So that Cursor sessions get the same governance + per-user attribution
  as Claude Code / Codex

  Cursor speaks both Anthropic-shaped + custom request shapes; the wrapper
  needs to handle both. Spec maps to Phase 11 (Sergey: P11-per-wrapper).

  Background:
    Given the LangWatch control plane + stub Anthropic provider are running
    And alice has a default routing policy + active CLI session

  Scenario: Cursor wrapper env injection
    When the harness spawns `langwatch cursor --print-env`
    Then env contains `ANTHROPIC_BASE_URL=<test-gateway-url>/api/v1`
    And env contains `ANTHROPIC_AUTH_TOKEN=lw_vk_<alice's VK>`
    And cursor-specific env vars (e.g. `CURSOR_TELEMETRY_ENDPOINT`) are unset / passthrough

  Scenario: Cursor invocation against Anthropic-shaped endpoint
    When the harness fires a Cursor request to `${ANTHROPIC_BASE_URL}/messages`
    Then the gateway routes to the stub Anthropic provider
    And response carries `gen_ai.system = "anthropic"` + `gen_ai.request.model = <cursor's selected model>`

  Scenario: Cursor invocation against custom completion endpoint
    Given Cursor sometimes uses a custom completion shape (not the standard /messages)
    When the harness fires a custom-shaped request through the wrapper
    Then the gateway accepts + forwards correctly (Bifrost handles the OpenAI/Anthropic shape adaptation)
    And the trace still attributes to alice + carries the right `gen_ai.system`

  Scenario: Trace attribution
    Then spans from any Cursor invocation carry alice's principal_id + organization_id + `personal: true`

  Scenario: Wrapper exits with Cursor's exit code
    Given the stubbed `cursor` binary exits with code 0
    Then `langwatch cursor`'s exit code is 0
