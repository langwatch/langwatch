Feature: `langwatch copilot` defaults to direct OTLP so Copilot seat billing is never silently shifted
  ADR-039 Decision 3. Copilot is the first tool where the gateway path is
  not billing-neutral: Path A switches Copilot into BYOK mode, moving spend
  off the user's already-paid Copilot seat onto the org's provider API keys.
  For claude/codex the base-URL swap bills the same key either way; for
  copilot it does not.

  The wrapper is ingestion-first for every tool (the gateway is reachable
  only by explicit choice - see wrap-path-choice.feature), which already
  keeps copilot billing-safe by default. What stays copilot-specific is the
  WORDING: every route that puts copilot on the gateway - an explicit
  choice, a pinned mode, or org policy - tells the user their Copilot seat
  is being bypassed. Explicit choices (flag, env, prompt answer, pinned
  mode, org policy) are honored unchanged.

  Pairs with:
    - specs/ai-governance/cli-wrappers/wrap-path-choice.feature (the generic
      ingestion-first path-selection precedence)
    - dev/docs/adr/039-copilot-cli-as-tracked-coding-assistant.md

  Background:
    Given the user has completed `langwatch login --device` for org "acme"
    And the cached policy for "copilot" allows both the gateway and direct OTLP paths
    And the user has a personal virtual key

  Rule: copilot rides the ingestion-first defaults

    @unit
    Scenario: Non-interactive copilot run with no pinned mode resolves to direct OTLP
      Given tool_mode.copilot is unset
      And stdin is not a TTY
      When the user runs `langwatch copilot`
      Then the resolved path is direct OTLP (ingestion)
      And no prompt is shown

    @unit
    Scenario: The copilot path prompt pre-selects direct OTLP
      Given tool_mode.copilot is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch copilot`
      Then the select prompt's pre-selected choice is "Direct OTLP"
      And the gateway choice explains that calls route through LangWatch on a virtual key

  Rule: explicit choices win over the copilot exception

    @unit
    Scenario: An explicit --tool-mode=gateway flag routes copilot through the gateway
      Given tool_mode.copilot is unset
      When the user runs `langwatch copilot --tool-mode=gateway`
      Then the resolved path is the gateway
      And the flag is not forwarded to the copilot binary
      And the notice states that usage will bill the org's provider keys instead of the user's Copilot seat

    @unit
    Scenario: A pinned gateway mode for copilot is honored without prompting
      Given tool_mode.copilot is saved as "gateway"
      When the user runs `langwatch copilot`
      Then the resolved path is the gateway
      And no prompt is shown
      And the notice states that usage will bill the org's provider keys instead of the user's Copilot seat

  Rule: gateway routing for copilot explains the billing shift

    @unit
    Scenario: Policy-forced gateway routing for copilot names the seat bypass
      Given the org policy disables direct OTLP for "copilot"
      When the user runs `langwatch copilot`
      Then the wrapper routes through the gateway
      And the notice states that usage will bill the org's provider keys instead of the user's Copilot seat

  Rule: the platform policy knows copilot

    @unit
    Scenario: Copilot's default platform policy allows both paths
      Given no per-org policy row exists for "copilot"
      When the wrapper resolves the platform policy for "copilot"
      Then the gateway path is allowed
      And the direct OTLP path is allowed
