Feature: Import a custom provider's models on save
  As a user configuring a custom (OpenAI-compatible) model provider
  I want its models imported from the provider's /v1/models listing when I save
  So that I do not have to type every model by hand

  # Applies to the custom provider, and to an OpenAI provider whose base URL is
  # not OpenAI's own. The save asks the listing with the credential it is about
  # to store, before the database write.
  #
  # The import only adds. Entries already in the custom model lists are kept
  # as they are, and a model the endpoint stopped listing stays. The ids the
  # last listing carried are stored with the provider, and only ids new since
  # that listing are added, so a model the user removed is not imported again
  # while the endpoint keeps listing it. On the first import nothing was stored
  # yet, so every listed model comes in. Pointing the provider at another
  # endpoint starts a fresh listing; rotating the key on the same one does not.
  #
  # The probe is outbound traffic to a URL the customer chose, so it spends the
  # same per-organization budget as a connection test.

  # Reading the listing

  @unit
  Scenario: Listing entries become importable models
    Given a /v1/models body with entries "model-a" and "model-b"
    When the listing is parsed
    Then it yields the models "model-a" and "model-b" in that order

  @unit
  Scenario: Listing metadata is read only when the entry states it
    Given a listing entry with a context length, reasoning efforts and an embeddings marker
    When the listing is parsed
    Then the model carries the context length as max tokens
    And it is marked as supporting reasoning
    And it is marked as an embeddings model
    And an entry without those fields carries none of them

  @unit
  Scenario: A body that is not a model listing yields no listing
    Given a body that is not JSON, or JSON without a "data" array
    When the listing is parsed
    Then there is no listing

  @unit
  Scenario: A listing is bounded in size and length
    Given a listing body larger than the size cap, or with more entries than the model cap
    When the listing is read
    Then the oversized body yields no listing
    And only the first entries up to the model cap are kept

  # Merging into the custom model lists

  @unit
  Scenario: The first import adds every listed model
    Given a provider with no custom models and no previous listing
    When the listing names "model-a" and "model-b"
    Then both are added as chat models whose id and display name are the listed id

  @unit
  Scenario: Existing entries are kept untouched
    Given a custom model "model-a" the user edited with a display name and max tokens
    When the listing names "model-a"
    Then "model-a" keeps the display name and max tokens the user set

  @unit
  Scenario: A later import adds models new to the listing
    Given a provider whose previous listing named "model-a"
    When the listing names "model-a" and "model-b"
    Then only "model-b" is added

  @unit
  Scenario: A model the endpoint stopped listing stays
    Given a custom model "model-old" imported earlier
    When the listing no longer names "model-old"
    Then "model-old" is still a custom model

  @unit
  Scenario: A model the user removed is not imported again
    Given a provider whose previous listing named "model-a"
    And the user removed "model-a" from the custom models
    When the listing still names "model-a"
    Then "model-a" is not added back

  @unit
  Scenario: An embeddings model is not duplicated as a chat model
    Given a custom embeddings model "embed-a"
    When the listing names "embed-a"
    Then "embed-a" is not added as a chat model

  @unit
  Scenario: Only custom providers and OpenAI on another base URL import
    Given providers of several kinds
    Then a custom provider imports
    And an OpenAI provider with a base URL other than OpenAI's own imports
    And an OpenAI provider on OpenAI's own base URL, or none, does not import

  # Saving

  @integration
  Scenario: Saving a new custom provider imports its models
    Given an OpenAI-compatible endpoint listing "model-a" and "model-b"
    When I save a new custom provider pointed at it
    Then the provider's custom models are "model-a" and "model-b"
    And the save reports 2 models imported

  @integration
  Scenario: A manual entry survives the import
    Given a saved custom provider with a model "manual-model" I added by hand
    When I save it again
    Then "manual-model" is still a custom model

  @integration
  Scenario: Saving again imports models the endpoint added
    Given a saved custom provider whose endpoint now also lists "model-c"
    When I save it again
    Then "model-c" is added
    And the save reports 1 model imported

  @integration
  Scenario: Saving again does not bring back a model I removed
    Given a saved custom provider whose imported model "model-a" I removed
    When I save it again while the endpoint still lists "model-a"
    Then "model-a" is not a custom model

  @integration
  Scenario: Pointing the provider at another endpoint starts a fresh listing
    Given a saved custom provider whose imported model "model-a" I removed
    When I save it pointed at another endpoint that lists "model-a"
    Then "model-a" is imported from the new endpoint

  @integration
  Scenario: An exhausted listing budget skips the import and keeps the save
    Given my organization has used up its connection check budget
    When I save a custom provider
    Then the provider is saved with the models I sent
    And the save reports the import as failed
    And the endpoint is not called

  @integration
  Scenario: An unchanged provider that imports can be saved to re-import
    Given a saved custom provider whose drawer I open without editing anything
    Then the Save button is enabled
    And pressing it saves the provider, which imports any models the endpoint added

  @integration
  Scenario: An endpoint that fails to list does not block the save
    Given an OpenAI-compatible endpoint that answers 500, or answers 200 with a body that is not JSON
    When I save a custom provider pointed at it
    Then the provider is saved with the models I sent
    And the save reports the import as failed

  @integration
  Scenario: The drawer tells the user what the save imported
    Given a save that imported 3 models from "My Endpoint"
    Then a success toast reads "Imported 3 models from My Endpoint"
    And when the import failed a warning toast says the models could not be listed and can be added by hand

  @integration
  Scenario: See all models lists a custom provider's own models
    Given a custom provider with imported models
    When I click the "See all models" link
    Then the modal lists the provider's models instead of an empty catalog
