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

  # A project that keeps several credentials for one provider picks the row it
  # wants, so the composer sends the row id in front of the model reference and
  # the whole thing carries two slashes.
  @unit
  Scenario: A model from a named provider row is accepted with the row id in front
    Given the project's model comes from a named provider row rather than the provider default
    When the composer sends a turn with the row id in front of a slash-containing model id
    Then the turn is accepted rather than rejected as invalid input
    And the full id reaches the app layer unchanged

  @unit
  Scenario: A model reference without a provider segment is rejected as invalid input
    When the composer sends a turn with the model "gpt-5-mini"
    Then the turn is rejected as invalid input
    And the rejection names the model field

  @unit
  Scenario: A model reference with an empty segment is rejected as invalid input
    When the composer sends a turn with the model "custom//stealth"
    Then the turn is rejected as invalid input
    And the rejection names the model field
    And no turn is dispatched to the worker

  @unit
  Scenario: Switching models mid-conversation keeps the conversation
    Given a conversation with earlier turns on one model
    When the user switches the composer to a model from another provider and sends a follow-up
    Then the turn carries what was already said in this conversation
    And the new model can answer from it

  @unit
  Scenario: The composer follows a default-model change made in settings
    Given the composer's model was seeded from the resolved default
    When the default model configuration is saved or removed while the panel is open
    Then the composer's picker snaps to the newly resolved default without a reload
    And a model the user picked on purpose is never replaced

  @unit
  Scenario: Picking a model offers to make it the default at the scope that holds it
    Given the Langy default is configured at a scope the user can manage
    When the user picks a different model in the composer
    Then a dialog offers to make that model the Langy default going forward
    And confirming writes the default at the same scope and kind that held it
    And declining keeps the pick for this conversation only

  @unit
  Scenario: No default offer without the right to change it
    Given the Langy default is configured at a scope the user cannot manage
    When the user picks a different model in the composer
    Then no dialog appears and the pick stays with the conversation
    And picking the default itself, or having no configured default, asks nothing

  # A pick lives with its conversation. The durable record keeps the model of
  # the latest accepted turn, so reopening the conversation — another tab,
  # another device, after a reload — restores the model it last ran on
  # instead of snapping back to the default.
  @unit
  Scenario: Reopening a conversation restores the model it last ran on
    Given a conversation whose last turn ran on a model the user picked
    When the conversation is opened again and its history loads
    Then the composer's picker shows that model, not the resolved default
    And a model the user picked since opening it is never replaced
    And a model the allowlist refuses is not restored

  @unit
  Scenario: A new conversation starts on the resolved default again
    Given the user picked a model for one conversation
    When the user starts a new conversation or switches to another
    Then the pick does not follow to the other conversation
