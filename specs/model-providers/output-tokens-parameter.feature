Feature: The model catalog says how each model takes its output token limit
  As someone running evaluators and workflows on a model I picked
  I want my output token limit sent the way that model accepts it
  So that no call fails just because a limit was sent under the wrong name

  # A model's output token limit goes out under one of two names. OpenAI's
  # reasoning models refuse `max_tokens` and accept only
  # `max_completion_tokens`. Every service guessed which name to use from the
  # model's name, and each guessed differently. When OpenAI shipped a
  # generation the guesses did not cover, every LLM-as-judge evaluation on it
  # failed: "Unsupported parameter: 'max_tokens' is not supported with this
  # model. Use 'max_completion_tokens' instead."
  #
  # The name a model takes is a capability of the model, so the catalog records
  # it once and the services that call models read it from there. The rule that
  # fills it lives with the other hand-kept catalog rules and runs when the
  # catalog is regenerated. Older Azure API versions and OpenAI-compatible
  # servers refuse `max_completion_tokens`, so only the models that require it
  # are marked, and a model the catalog does not know keeps the request it gets
  # today.
  #
  # Bindings:
  #   modules/model-provider/process/src/rules/__tests__/output-tokens-parameter.rules.unit.test.ts
  #   services/langevals/langevals_core/tests/test_output_tokens_parameter.py
  #   services/nlpgo/adapters/modelcatalog/catalog_test.go
  #   services/nlpgo/adapters/litellm/translator_test.go

  Rule: The catalog records which name each model takes

    @unit
    Scenario: An OpenAI reasoning model is recorded as taking max_completion_tokens
      Given an OpenAI reasoning model from any generation, including ones newer than the services know by name
      When the catalog is built
      Then the model's entry says its output limit is sent as max_completion_tokens

    @unit
    Scenario: A model that takes max_tokens is recorded as the default
      Given a model that accepts max_tokens, such as GPT-4.1 or a Claude model
      When the catalog is built
      Then the model's entry says nothing about its output limit, which means max_tokens

    @unit
    Scenario: The committed catalog agrees with the rule
      Given the catalog as it is committed
      When every chat model in it is checked against the rule
      Then each model the rule marks carries the mark, and no other model does

    @unit
    Scenario: o4 models carry the o-series reasoning settings
      Given an o4 model in the catalog
      When the catalog is built
      Then it offers low, medium and high reasoning effort with medium by default

    @unit
    Scenario: GPT 5.4 and later models offer the reasoning efforts OpenAI documents
      Given a GPT 5.4, 5.5, 5.6, 6 or 6.1 model in the catalog
      When the catalog is built
      Then it offers the reasoning efforts and the default listed on that model's OpenAI page
      And a model with no OpenAI page of its own offers no reasoning effort

  Rule: An evaluator sends its output limit under the name the catalog records

    @unit
    Scenario: A judge on a model that takes max_completion_tokens reaches the model
      Given an evaluator with an output token limit on a model the catalog marks
      When the evaluator asks that model to judge
      Then the limit is sent as max_completion_tokens
      And max_tokens is not sent

    @unit
    Scenario: An Azure deployment of a marked model is sent the name its model takes
      Given an Azure deployment of a model the catalog marks, under a deployment name of its own
      When the evaluator asks that deployment to judge
      Then the limit is sent as max_completion_tokens

    @unit
    Scenario: A model that takes max_tokens keeps getting max_tokens
      Given an evaluator with an output token limit on a model the catalog does not mark
      When the evaluator asks that model to judge
      Then the limit is sent as max_tokens

    @unit
    Scenario: A model the catalog does not know keeps the request it gets today
      Given an evaluator with an output token limit on a model the catalog does not carry
      When the evaluator asks that model to judge
      Then the limit is sent the way it is sent today

    @unit
    Scenario: A limit the caller already named max_completion_tokens is kept
      Given an evaluator that already sends max_completion_tokens
      When the evaluator asks a model to judge
      Then the limit it chose is the one the model receives

  Rule: A workflow sends its output limit under the name the catalog records

    @unit
    Scenario: A workflow LLM call on a marked model sends max_completion_tokens
      Given a workflow LLM node with an output token limit on a model the catalog marks
      When the node calls the model
      Then the limit is sent as max_completion_tokens

    @unit
    Scenario: A workflow LLM call on a model that takes max_tokens keeps max_tokens
      Given a workflow LLM node with an output token limit on a model the catalog carries and does not mark
      When the node calls the model
      Then the limit is sent as max_tokens

    @unit
    Scenario: The engine reads the catalog the image ships with
      Given a catalog directory holding the catalog and its overlay
      When the engine loads it
      Then an overlay entry wins over the base entry of the same model
