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
  #   services/langevals/langevals_core/tests/test_forced_tool_choice_fallback.py
  #   services/langevals/tests/deterministic/test_llm_boolean_polarity_framing.py
  #   services/langevals/evaluators/langevals/tests/test_llm_boolean.py (real calls)

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

  # Some models refuse any tool_choice that forces a function, reasoning or
  # not (Claude Opus 5.5 on Bedrock), and Claude refuses it while thinking is
  # on. The judge then asks with tool_choice "auto" instead.
  @unit
  Scenario: A judge reaches a verdict on a model that refuses a forced function call
    Given an evaluator model that refuses a forced function call
    When the evaluator asks that model to judge
    Then the request is sent again with tool_choice "auto"
    And the evaluation reaches a verdict from the function call

  @unit
  Scenario: A model seen refusing a forced function call is asked with auto from then on
    Given an evaluator model that already refused a forced function call in this process
    When the evaluator asks that model to judge again
    Then the request goes out with tool_choice "auto" on the first attempt

  @unit
  Scenario: A judge that skips its function under auto is reminded once
    Given an evaluator model asked with tool_choice "auto"
    And it answers in prose without calling the verdict function
    When the evaluator reads the answer
    Then the request is sent once more with a reminder to call the function

  @unit
  Scenario: A judge that never calls its function fails with a clear error
    Given an evaluator model that answers without a usable call to the verdict function
    When the evaluator reads the answer
    Then the evaluation fails with an error naming the model and what was wrong with the answer

  @unit
  Scenario: A refusal that is not about the forced function call reaches the caller untouched
    Given the model refuses the request for a reason other than a forced function call
    When the evaluator runs
    Then the caller receives the refusal exactly as the model gave it
    And no second request is sent

  # Most customer boolean prompts state a fail condition ("return false if the
  # answer mentions a competitor"). The judge's result is the value the
  # instructions ask for, never its own reading of whether the output passed.
  @unit
  Scenario: The boolean judge is told its result is exactly what the instructions ask for
    Given a boolean judge prompt
    When the evaluator asks the model to judge
    Then the system prompt is the customer's prompt followed by the result framing
    And the verdict field is named result and described as the value the instructions ask for

  @unit @regression
  Scenario Outline: A fail-condition prompt yields false when its condition holds and true when it does not
    Given the boolean judge prompt "Return false if the answer mentions a competitor"
    And an output that <mentions> a competitor
    When the evaluator runs
    Then the evaluation's passed field is <result>

    Examples:
      | mentions         | result |
      | mentions         | false  |
      | does not mention | true   |
