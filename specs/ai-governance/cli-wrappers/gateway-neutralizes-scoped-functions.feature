Feature: Gateway runs neutralize persisted Path B shell functions so no call is captured twice
  ADR-039 v3 finding, no-double-trace invariant. Tools with a scoped shell
  function persisted for Path B (gemini, opencode, copilot) carry a hazard
  into gateway runs: the wrapper spawns through the user's interactive
  login shell so aliases resolve, which also sources the rc — and the rc
  defines the tool as a function that re-injects the OTel exporter env at
  invocation time, AFTER the wrapper's own exports. Result: the gateway
  captures the calls server-side AND the tool emits OTel for the same
  calls — double trace, double cost.

  Mode exclusivity in the resolver is not enough; the gateway spawn must
  actively remove the persisted function from the shell before invoking
  the tool, while leaving user aliases intact (aliases were the reason for
  the interactive shell in the first place).

  This is a pre-existing hole for gemini/opencode, fixed generically for
  every scoped-function tool alongside copilot (ADR-039 sweep item).

  Pairs with:
    - specs/ai-governance/cli-wrappers/shell-rc-persistence.feature (how the
      scoped function gets installed for Path B)

  Background:
    Given the user has completed `langwatch login --device` for org "acme"
    And the user previously persisted the Path B shell function for the tool

  Rule: gateway spawns remove the tool's scoped function before invocation

    @unit
    Scenario: A gateway copilot run with a persisted rc function emits no OTLP
      Given tool_mode.copilot is saved as "gateway"
      When the user runs `langwatch copilot`
      Then the shell command removes the `copilot` function before invoking the tool
      And the child env carries no OTLP exporter endpoint

    @unit
    Scenario: A gateway opencode run with a persisted rc function emits no OTLP
      Given tool_mode.opencode is saved as "gateway"
      When the user runs `langwatch opencode`
      Then the shell command removes the `opencode` function before invoking the tool
      And the child env carries no OTLP exporter endpoint

    @unit
    Scenario: A gateway gemini run with a persisted rc function emits no OTLP
      Given tool_mode.gemini is saved as "gateway"
      When the user runs `langwatch gemini`
      Then the shell command removes the `gemini` function before invoking the tool
      And the child env carries no OTLP exporter endpoint

  Rule: user aliases and ingestion runs are untouched

    @unit
    Scenario: Gateway runs still honor the user's alias for the tool
      Given tool_mode.copilot is saved as "gateway"
      And the user's rc defines an alias adding a flag to `copilot`
      When the user runs `langwatch copilot`
      Then the alias's flag is present on the spawned invocation

    @unit
    Scenario: Ingestion runs leave the persisted function in place
      Given tool_mode.copilot is saved as "ingestion"
      When the user runs `langwatch copilot`
      Then the stale persisted function is neutralized for this run only
      And the rc file keeps the persisted `copilot` function for bare runs
