Feature: Evaluator judge reasoning and tool compatibility
  As someone running an LLM-as-judge evaluator
  I want the judge request to use a provider-compatible reasoning mode
  So that the evaluation returns a verdict instead of failing before it starts

  # Confirmed against the live provider: a Comparison run whose evaluator model
  # resolved to openai/gpt-5.6-sol failed every single time with "Function
  # tools with reasoning_effort are not supported for gpt-5.6-sol in
  # /v1/chat/completions. To use function tools, use /v1/responses or set
  # reasoning_effort to 'none'." The same model answers normally once reasoning
  # is declared off, and openai/gpt-5-mini rejects that very value, so the
  # compatibility cannot be applied to everything.
  #
  # Nine evaluators are exposed to this rather than one. Comparison, Pairwise
  # Compare, LLM-as-a-Judge Boolean, LLM-as-a-Judge Score, LLM Category, Off
  # Topic, Query Resolution, both Competitor checks and topic naming all ask
  # for their answer through a function tool. They reach the provider through
  # the one litellm entry point langevals already patches, which is where the
  # compatibility belongs.
  #
  # Bindings:
  #   services/langevals/langevals_core/langevals_core/litellm_patch.py
  #   services/langevals/langevals_core/tests/test_tool_reasoning_compatibility.py

  @unit
  Scenario Outline: An affected evaluator model disables reasoning by default
    Given the evaluator model is "openai/gpt-5.6-<variant>"
    And the evaluator asks for its verdict through a function tool
    And the call does not select a reasoning effort of its own
    When the request is sent to the provider
    Then the request declares its reasoning effort as "none"

    Examples:
      | variant |
      | luna    |
      | sol     |
      | terra   |

  @unit
  Scenario: The compatibility value is a default that an explicit effort beats
    Given an affected evaluator model
    And the call selects a reasoning effort of its own
    When the request is sent to the provider
    Then the request carries the effort the caller chose, unchanged

  @unit
  Scenario Outline: An unverified evaluator model keeps its reasoning untouched
    Given the evaluator model is "<model>"
    And the evaluator asks for its verdict through a function tool
    When the request is sent to the provider
    Then the request declares no reasoning effort at all

    Examples:
      | model                  |
      | openai/gpt-5.6-sol-pro |
      | azure/gpt-5.6-sol      |
      | openai/gpt-5.5-sol     |
      | openai/gpt-5.5         |
      | openai/gpt-5-mini      |

  # The refusal is about tools specifically, and reasoning is worth having on
  # the calls that can use it, so a request carrying no tools is not rewritten
  # even on an affected model.
  @unit
  Scenario: A request that carries no tools keeps its reasoning untouched
    Given an affected evaluator model
    And a call that asks for no tools
    When the request is sent to the provider
    Then the request declares no reasoning effort at all

  @unit
  Scenario: The function tool the judge asked for reaches the provider unchanged
    Given an affected evaluator model
    And the evaluator forces a named function call for its verdict
    When the request is sent to the provider
    Then the tool definition and the forced choice arrive as the evaluator wrote them

  @unit
  Scenario: A remaining conflict is reported as a configuration problem the user can fix
    Given an evaluator model outside the verified list
    And the provider refuses its tool-carrying request over the reasoning setting
    When the evaluator runs
    Then the failure names the model and the setting to change
    And the provider's own wording is not used as the message

  @unit
  Scenario: An unrelated provider rejection reaches the caller unchanged
    Given the provider refuses a request for a reason unrelated to reasoning
    When the evaluator runs
    Then the caller receives the provider's own rejection as it stands
