Feature: `langwatch opencode` wrapper end-to-end
  As a developer running OpenCode (the open-source coding-assistant CLI)
  through the LangWatch wrapper
  I want my session authenticated + routed + traced
  So that OpenCode sessions get the same governance properties as the other
  wrappers, with whichever provider OpenCode is configured against (typically
  Anthropic)

  Spec maps to Phase 11 (Sergey: P11-per-wrapper).

  Background:
    Given the LangWatch control plane + stub Anthropic provider are running
    And alice has a default routing policy + active CLI session

  Scenario: `langwatch opencode` injects the right env vars per OpenCode's conventions
    When the harness spawns `langwatch opencode --version`
    Then env contains `OPENCODE_LLM_BASE_URL=<test-gateway-url>/api/v1`
    And env contains `OPENCODE_LLM_API_KEY=lw_vk_<alice's VK>`
    (env-var names per OpenCode's documented LLM-config conventions)

  Scenario: OpenCode invocation routes through gateway
    When the harness fires a stubbed OpenCode request
    Then the gateway receives the request with bearer = alice's VK
    And routes to the configured stub provider
    And response carries the right `gen_ai.system` + token counts

  Scenario: Trace attribution holds across OpenCode's multi-step workflows
    Given OpenCode often makes multiple LLM calls per user-action (planner + tool calls + final answer)
    When the harness fires a multi-call OpenCode workflow
    Then ALL spans in the trace tree carry alice's principal_id + organization_id + `personal: true`
    And the spans share a common trace_id (so the workflow is reconstructable in the trace viewer)

  Scenario: Wrapper exit code passthrough
    Given the stubbed `opencode` binary exits with code 5
    Then `langwatch opencode`'s exit code is 5
