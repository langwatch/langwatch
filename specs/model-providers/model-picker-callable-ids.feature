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

  # Langy calls OpenAI models on the Responses API, streamed, at a medium
  # reasoning effort. OpenAI answers 400 unsupported_value when a model does not
  # take that effort: GPT-5 Pro takes only high. Probed on the real API: GPT-5.2
  # Pro, GPT-5.4 Pro, GPT-5.5 Pro, o3 Pro and GPT-5.3 Codex all answer a
  # medium-effort streamed call, so they stay.

  @unit
  Scenario: A model that refuses Langy's reasoning effort is not offered to Langy
    Given an OpenAI provider and the catalogue's GPT-5 Pro, which takes only a high effort
    When Langy's model picker options are built
    Then GPT-5 Pro is not offered and cannot be the Langy default
    And GPT-5.2 Pro, o3 Pro and GPT-5.3 Codex are offered
    And other surfaces still offer GPT-5 Pro

  # The catalogue lists what a provider has ever priced, not what this credential
  # can call: on an OpenAI-only key about half its ids answered 404 (retired,
  # never on the API) or were refused by a chat call (audio, realtime, image).
  # So the picker also asks the provider's own models route and offers only the
  # catalogue ids that list carries. Any failure to ask keeps the catalogue.

  @unit
  Scenario: A catalogue model the provider's own list does not carry is not offered
    Given an OpenAI provider whose model list answers GPT-4.1 and GPT-6 Sol
    When the chat picker options are built
    Then GPT-4.1 and GPT-6 Sol are offered
    And GPT-OSS 120B, which the list does not carry, is not

  @unit
  Scenario: The catalogue is offered when the provider's list is not known
    Given an OpenAI provider whose model list could not be fetched
    When the chat picker options are built
    Then every OpenAI chat model of the catalogue is offered

  @unit
  Scenario: A list that shares no id with the catalogue is ignored
    Given a provider whose model list names only aliases the catalogue does not know
    When the chat picker options are built
    Then the provider's catalogue models are offered as before

  @unit
  Scenario: Custom models are offered whatever the provider's list says
    Given an OpenAI provider with the custom model "my-finetune" and a model list without it
    When the chat picker options are built
    Then "my-finetune" is offered

  @unit
  Scenario: Audio, realtime, image and deep research models are not offered for chat
    Given the catalogue carries GPT Audio, GPT Realtime, GPT-5 Image and o3 Deep Research
    When the chat picker options are built
    Then none of them is offered
    And the OpenRouter auto router is still offered

  @unit
  Scenario: The model list is read from the OpenAI, Anthropic and Gemini answer shapes
    Given a models answer in the OpenAI, the Anthropic or the Gemini shape
    When the provider's model list is read
    Then the bare model ids are returned, Gemini's "models/" prefix removed
    And Anthropic and Gemini are asked for the whole list in one page

  @unit
  Scenario: A provider that cannot be asked answers no list
    Given an Azure, a Bedrock or a masked-key provider
    When its model list is asked for
    Then no request leaves and no list is returned

  @unit
  Scenario: A known list is answered from the cache and asked again once it is old
    Given a provider whose model list was fetched more than six hours ago
    When the picker reads the provider list
    Then the held list is answered at once
    And the provider is asked again in the background

  @unit
  Scenario: A provider that does not answer is not asked on every read
    Given a provider whose model list request failed a minute ago
    When the picker reads the provider list again
    Then the catalogue is offered and the provider is not asked again

  @unit
  Scenario: A slow first listing does not hold the picker
    Given a provider whose model list takes longer than the picker waits
    When the picker reads the provider list
    Then the provider list answers without that provider's list
    And the list is held for the next read once it arrives

  @unit
  Scenario: Saving a provider asks its model list again
    Given an OpenAI provider whose model list is held
    When the provider is saved
    Then its model list is asked again

  @unit
  Scenario: The provider list the pickers read carries each provider's served models
    Given a project with an OpenAI provider whose model list answers GPT-6 Sol
    When the browser lists the project's providers
    Then the OpenAI entry carries GPT-6 Sol as a served model

  @integration
  Scenario: A provider's model list is held in Redis for every replica
    Given one replica saved the model list of a credential
    When another replica reads the listing for that credential
    Then it reads the same ids
