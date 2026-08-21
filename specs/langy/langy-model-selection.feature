Feature: Langy runs on the model the project chose
  As a user of Langy,
  I want Langy to run on the model my project configured, whatever its provider,
  so that Langy spends my key on the model I chose rather than a built-in default.

  # ADR-065, engine half. The resolved Langy model (feature key langy.chat,
  # inheriting the project Default until chosen) is FORWARDED to the worker, so
  # a turn runs on the configured model rather than the worker's own built-in
  # default. A per-send composer override still wins. The engine is
  # provider-blind: whatever model the project's Langy allowlist permits is
  # dispatched with its full provider-prefixed id, and the AI gateway's own
  # prefix routing decides which provider serves it.

  Background:
    Given I am signed in with Langy enabled for project "demo"

  @unit
  Scenario: The configured Langy model is forwarded to the worker
    Given a project with a Langy model configured
    And the user has not overridden the model for this send
    When a turn is dispatched
    Then the configured Langy model is sent to the worker
    And the worker does not fall back to its own built-in default

  @unit
  Scenario: A per-send override still wins over the configured Langy model
    Given a project with a Langy model configured
    When the user picks a different model in the composer for this send
    Then that override is the model sent to the worker

  @unit
  Scenario: Any allowed provider's model is dispatched with its full id
    Given the project's Langy allowlist permits a model from a provider other than OpenAI
    When the user picks it in the composer and sends a message
    Then the turn is accepted rather than refused
    And the model reaches the worker with its provider-prefixed id intact

  # Custom OpenAI-compatible providers accept any model id, and ids from
  # aggregators such as OpenRouter contain a slash of their own
  # ("stealth/ox-alpha"), so the full reference carries two: the provider
  # segment ends at the FIRST slash and the rest is the model.
  @unit
  Scenario: A model id that itself contains a slash is accepted
    Given the project's model is a custom provider model named "stealth/ox-alpha"
    When the composer sends a turn with the full id "custom/stealth/ox-alpha"
    Then the turn is accepted rather than rejected as invalid input
    And the full id reaches the app layer unchanged

  @unit
  Scenario: A model reference without a provider segment is rejected as invalid input
    When the composer sends a turn with the model "gpt-5-mini"
    Then the turn is rejected as invalid input
    And the rejection names the model field

  @unit
  Scenario: Switching models mid-conversation keeps the conversation
    Given a conversation with earlier turns on one model
    When the user switches the composer to a model from another provider and sends a follow-up
    Then the turn carries what was already said in this conversation
    And the new model can answer from it
