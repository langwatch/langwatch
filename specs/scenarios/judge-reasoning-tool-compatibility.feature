Feature: Scenario judge reasoning and tool compatibility
  As someone running a scenario
  I want the judge request to use a provider-compatible reasoning mode
  So that the judge returns a verdict instead of failing before evaluation

  # Production evidence (redacted GCX audit, 2026-07-30 through 2026-08-05):
  # four JudgeAgent calls using openai/gpt-5.6-sol failed with the same 400.
  # Each request had a forced function tool and omitted reasoning_effort. The
  # provider said to use Responses or set reasoning_effort to none.
  #
  # The scenario SDK's JudgeAgent is the common cause: it always submits a
  # function tool for the structured verdict. The simulator, tested target,
  # playground, and workflow runtimes are not part of this failure.
  #
  # Bindings:
  #   platform/app/src/server/scenarios/execution/model.factory.ts
  #   platform/app/src/server/scenarios/execution/__tests__/model.factory.unit.test.ts
  #   platform/app/src/server/scenarios/scenario-infra-error.ts

  @unit
  Scenario Outline: The affected gpt-5.6 judge disables reasoning by default
    Given the scenario judge model is "openai/gpt-5.6-<variant>"
    And the judge will force its verdict function tool
    And the judge call does not explicitly select a reasoning effort
    When the judge request is built for Chat Completions
    Then the request includes reasoning_effort "none"
    And the function tool remains present

    Examples:
      | variant |
      | luna    |
      | sol     |
      | terra   |

  @unit
  Scenario: The compatibility value is a default, not an override
    Given the affected judge model has an explicit reasoning effort at call time
    When the judge request is built
    Then the explicit value wins over the compatibility default

  @unit
  Scenario Outline: Unverified models are not silently changed
    Given the scenario judge model is "<model>"
    When the judge request is built
    Then no reasoning effort is injected

    Examples:
      | model                    |
      | openai/gpt-5.6-sol-pro   |
      | azure/gpt-5.6-sol        |
      | openai/gpt-5.5-sol       |

  @unit
  Scenario: The same model outside the judge is untouched
    Given a simulator or tested target uses "openai/gpt-5.6-sol"
    When its model request is built
    Then no reasoning effort is injected by scenario compatibility handling

  @unit
  Scenario: A remaining conflict is surfaced as a handled scenario error
    Given an unrecognised judge model reaches the provider with incompatible reasoning and function tools
    When the provider returns the known invalid-request error
    Then the run stores error code "scenario_model_tool_reasoning_conflict"
    And the user receives safe actionable guidance
    And raw provider prose is not used as the message
