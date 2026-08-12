Feature: Evaluator judge reasoning and tool compatibility
  As someone running an LLM-as-judge evaluator
  I want the judge to work on the model I picked for it
  So that the evaluation returns a verdict instead of failing before it starts

  # Most evaluators here are LLM-as-judge, and a judge does not ask the model
  # for prose: it asks for a structured verdict it can read back. Some models
  # refuse to answer that way while their reasoning is on, and an evaluator
  # pointed at one of them returns no verdict at all, on any entry, until
  # someone changes the model. Nine evaluators are exposed to this rather than
  # one, since asking for a structured verdict is what makes a judge a judge.
  #
  # Which models refuse cannot be read off their names: near neighbours in the
  # same family accept the request, and other models refuse to run with their
  # reasoning off at all. So a model is treated this way only once it has been
  # seen to need it, and the treatment is a default, never an override.
  #
  # Bindings:
  #   services/langevals/langevals_core/langevals_core/litellm_patch.py
  #   services/langevals/langevals_core/tests/test_tool_reasoning_compatibility.py

  @unit
  Scenario: A judge reaches a verdict on a model that would otherwise refuse it
    Given an evaluator model known to refuse a structured verdict while its reasoning is on
    And nobody has chosen a reasoning effort for the evaluator
    When the evaluator asks that model to judge
    Then the model answers
    And the evaluation reaches a verdict

  # Someone who chose a reasoning effort chose it for a reason, and gets the
  # model's own answer rather than a request quietly rewritten underneath them.
  @unit
  Scenario: A reasoning effort the caller chose is the one that is used
    Given an evaluator model known to refuse a structured verdict while its reasoning is on
    And the caller has chosen a reasoning effort for the evaluator
    When the evaluator asks that model to judge
    Then the model is asked with the effort the caller chose

  # Every other model keeps working the way it does today, which matters most
  # for the ones that only work with their reasoning on: switching it off on a
  # guess would break evaluators that have no problem.
  @unit
  Scenario: A model nobody has seen refuse keeps the behaviour it has today
    Given an evaluator model that has not been seen to refuse a structured verdict
    When the evaluator asks that model to judge
    Then nothing about the model's reasoning is decided on the caller's behalf

  # The refusal is about the structured verdict specifically, and reasoning is
  # worth having on the calls that can use it.
  @unit
  Scenario: An evaluator that asks for no verdict keeps its reasoning
    Given an evaluator model known to refuse a structured verdict while its reasoning is on
    And an evaluator that asks that model for prose rather than a verdict
    When the evaluator runs
    Then nothing about the model's reasoning is decided on the caller's behalf

  # A default added to the request, not a rewrite of it: the question the
  # evaluator wrote is still the question the model is asked.
  @unit
  Scenario: The evaluator's own question reaches the model unchanged
    Given an evaluator model known to refuse a structured verdict while its reasoning is on
    When the evaluator asks that model to judge
    Then the model is asked exactly what the evaluator wrote

  # A model can start refusing before anyone has seen it do so. The provider's
  # own words for it name endpoints nobody chose and give the reader nothing to
  # act on, so the failure names the model and the setting instead.
  @unit
  Scenario: A refusal over the reasoning setting says what to change
    Given an evaluator model that has not been seen to refuse a structured verdict
    And the model refuses the judge's request over its reasoning setting
    When the evaluator runs
    Then the failure names the model and the setting to change
    And it does not repeat the provider's own wording

  # Every other refusal belongs to whoever has to read it, and arrives intact.
  @unit
  Scenario Outline: A refusal that is not this conflict reaches the caller untouched
    Given the model refuses the request <reason>
    When the evaluator runs
    Then the caller receives the refusal exactly as the model gave it

    Examples:
      | reason                                                |
      | for a reason unrelated to its reasoning setting       |
      | over its reasoning setting, with no verdict asked for |
