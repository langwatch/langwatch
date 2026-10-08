Feature: Doubleword model provider

  Doubleword hosts open-weight models (DeepSeek, Qwen, GLM, Kimi, gpt-oss and
  others) behind an OpenAI-compatible API at https://api.doubleword.ai/v1. A
  customer adds it with an API key only, the same way as DeepSeek, and calls
  its models as "doubleword/<model>".

  Doubleword model ids carry the vendor's own slash and casing
  ("deepseek-ai/DeepSeek-V4.1-Flash", "Qwen/Qwen3-Embedding-8B"), so every
  place that reads "doubleword/<model>" splits on the first slash only.

  The shipped model catalog lists Doubleword's realtime models with their
  realtime prices. The weekly model-registry sync keeps that list current.

  @unit
  Scenario: A Doubleword credential reaches the gateway with its API key
    Given a Doubleword model provider saved with an API key
    When the gateway configuration is built for it
    Then the provider slot carries that API key

  @unit
  Scenario: The gateway sends Doubleword traffic to Doubleword's public endpoint
    Given a Doubleword credential with an API key and no base URL
    When the gateway dispatches a call with it
    Then the call goes through the OpenAI-compatible adapter
    And it reaches https://api.doubleword.ai

  @unit
  Scenario: A configured base URL still wins over the public endpoint
    Given a Doubleword credential whose base URL names another region
    When the gateway dispatches a call with it
    Then the call reaches the configured endpoint

  @unit
  Scenario: A Doubleword model id keeps its own vendor slash
    When a caller asks for "doubleword/deepseek-ai/DeepSeek-V4.1-Flash"
    Then the provider is Doubleword
    And the model sent to Doubleword is "deepseek-ai/DeepSeek-V4.1-Flash"

  @unit
  Scenario: Playground and workflow calls route to Doubleword
    Given the app sends a Doubleword model with its API key to the NLP engine
    When the engine builds the credential
    Then the credential is a Doubleword credential carrying that key

  @unit
  Scenario: The gateway knows which models a Doubleword key serves
    Given a virtual key holding a Doubleword credential
    When the gateway configuration is built
    Then the Doubleword slot declares the catalog's Doubleword models by their own ids

  @unit
  Scenario: A Doubleword call is priced from the catalog
    When a span for "doubleword/deepseek-ai/DeepSeek-V4.1-Flash" reports its token usage
    Then its cost uses Doubleword's realtime price for that model

  @unit
  Scenario: A provider account with no credit left is named in the playground
    Given a Doubleword account with no credit
    When a prompt playground call to a Doubleword model is refused with HTTP 402
    Then the playground says the provider account has no credit left
