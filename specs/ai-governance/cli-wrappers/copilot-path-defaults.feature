Feature: `langwatch copilot` defaults to direct OTLP so Copilot seat billing is never silently shifted
  ADR-039 Decision 3. Copilot is the first tool where the gateway path is
  not billing-neutral: Path A switches Copilot into BYOK mode, moving spend
  off the user's already-paid Copilot seat onto the org's provider API keys.
  For claude/codex the base-URL swap bills the same key either way; for
  copilot it does not.

  So copilot inverts the wrapper's usual gateway-leaning defaults. Every
  place the path resolver would silently pick the gateway for other tools
  picks direct OTLP (ingestion) for copilot instead, and every mid-run
  fallback ONTO the gateway tells the user their Copilot seat is being
  bypassed. Explicit choices (flag, env, prompt answer, pinned mode, org
  policy) are honored unchanged.

  Pairs with:
    - specs/ai-governance/cli-wrappers/wrap-path-choice.feature (the generic
      path-selection precedence this feature carves an exception into)
    - dev/docs/adr/039-copilot-cli-as-tracked-coding-assistant.md

  Background:
    Given the user has completed `langwatch login --device` for org "acme"
    And the cached policy for "copilot" allows both the gateway and direct OTLP paths
    And the user has a personal virtual key

  Rule: every silent gateway default flips to ingestion for copilot

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
      And the gateway choice explains that LLM usage is billed per token

    @unit
    Scenario: Aborting the copilot path prompt falls back to direct OTLP for this run
      Given tool_mode.copilot is unset
      And stdin and stdout are a TTY
      When the user runs `langwatch copilot` and aborts the prompt with Ctrl-C
      Then this run proceeds on direct OTLP without persisting a choice
      And the next run prompts again

    @unit
    Scenario: Non-copilot tools keep the gateway default on non-interactive runs
      Given tool_mode.claude is unset
      And stdin is not a TTY
      When the user runs `langwatch claude`
      Then the resolved path is the gateway

  Rule: explicit choices win over the copilot exception

    @unit
    Scenario: An explicit --tool-mode=gateway flag routes copilot through the gateway
      Given tool_mode.copilot is unset
      When the user runs `langwatch copilot --tool-mode=gateway`
      Then the resolved path is the gateway
      And the flag is not forwarded to the copilot binary

    @unit
    Scenario: A pinned gateway mode for copilot is honored without prompting
      Given tool_mode.copilot is saved as "gateway"
      When the user runs `langwatch copilot`
      Then the resolved path is the gateway
      And no prompt is shown

  Rule: mid-run fallbacks onto the gateway explain the Copilot billing shift

    @unit
    Scenario: Policy-forced gateway routing for copilot names the seat bypass
      Given the org policy disables direct OTLP for "copilot"
      When the user runs `langwatch copilot`
      Then the wrapper routes through the gateway
      And the notice states that usage will bill the org's provider keys instead of the user's Copilot seat

    @unit
    Scenario: Ingestion setup failure falling back to the gateway names the seat bypass
      Given tool_mode.copilot resolves to direct OTLP
      And minting the ingestion key fails because the control plane is unreachable
      When the user runs `langwatch copilot`
      Then the wrapper falls back to the gateway path
      And the fallback notice states that usage will bill the org's provider keys instead of the user's Copilot seat

  Rule: the platform policy knows copilot

    @unit
    Scenario: Copilot's default platform policy allows both paths
      Given no per-org policy row exists for "copilot"
      When the wrapper resolves the platform policy for "copilot"
      Then the gateway path is allowed
      And the direct OTLP path is allowed
