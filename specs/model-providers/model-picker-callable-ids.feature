Feature: Model pickers offer only ids a call can name
  As someone choosing a model for Langy, an evaluator or the playground
  I want every model the picker offers to answer a call
  So that picking a model never ends in a "model does not exist" 404 from the provider

  # The catalog is synced from a source that also lists prices and serving
  # modes. Two of its id shapes are not models a provider serves: the
  # batch-priced tier (`openai/gpt-6-sol:batch`) and the tiered pro mode
  # (`openai/gpt-6-sol-pro`), which OpenAI exposes as `reasoning.mode: pro` on
  # the base model. Both answered 404 model_not_found on the real OpenAI API.

  @unit
  Scenario: A batch-priced tier is not offered
    Given the catalog carries GPT-6 Sol and its batch-priced tier
    When the model picker options are built
    Then GPT-6 Sol is offered
    And the batch-priced tier is not

  @unit
  Scenario: A tiered pro serving mode OpenAI does not serve is not offered
    Given the catalog carries GPT-6 Sol Pro and GPT-5.5 Pro
    When the model picker options are built
    Then GPT-6 Sol Pro is not offered
    And GPT-5.5 Pro, which OpenAI serves under that id, is offered
