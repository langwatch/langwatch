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

  # A credential connected at the organization or the team serves every project
  # under it (ADR-021), and the turn's virtual key walks that same ladder. The
  # picker reads the project's provider list, which carries those rows, so a
  # project with no provider row of its own still gets the models.
  @integration
  Scenario: A provider configured on the organization enables its models in the picker
    Given the project's only model provider is connected at the organization
    When the composer's model picker opens
    Then it offers the models that provider serves
    And it offers no model from a provider nobody connected

  # The default model is resolved from the project's configuration, which can
  # name a provider nobody connected here. Seeding it put a model in the pill
  # that the pill's own menu never offered, and every send died at the gateway
  # with "no provider connected". The seed reads the same list the menu does.
  @unit
  Scenario: A default naming a provider nobody connected never reaches the composer
    Given the resolved Langy default names a provider this project cannot reach
    When the composer seeds its model
    Then it holds the first model the project's providers serve
    And a model the project can serve is seeded unchanged

  @unit
  Scenario: The composer follows a default-model change made in settings
    Given the composer's model was seeded from the resolved default
    When the default model configuration is saved or removed while the panel is open
    Then the composer's picker snaps to the newly resolved default without a reload
    And a model the user picked on purpose is never replaced

  # "The user never picked" was read from the pill itself: an empty pick, or one
  # equal to the resolved default. Accepting "make it the default" makes the
  # pick EQUAL the default, so from that moment their choice reads as untouched,
  # and the next default resolution or history landing puts the old model back
  # in front of someone who had just chosen. The choice is tracked, not inferred.
  @unit
  Scenario: A pick that matches the default is still the user's pick
    Given the user picks a model and accepts the offer to make it the default
    When the defaults resolve again, or the conversation's history lands
    Then the picker still holds the model they chose

  @unit
  Scenario: Picking a model offers to make it the default at the scope that holds it
    Given the Langy default is configured at a scope the user can manage
    When the user picks a different model in the composer
    Then a dialog offers to make that model the Langy default going forward
    And confirming writes the default at the same scope and kind that held it
    And declining keeps the pick for this conversation only

  # The dialog interrupts a message being written, so it hands the cursor back
  # when it closes. Both answers count: the reader was typing either way.
  @unit
  Scenario: A dialog gives the cursor back to the composer when it closes
    Given the make-default dialog is open over the panel
    When the user confirms it or keeps the pick for this conversation
    Then the composer holds keyboard focus again

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
