Feature: Default models offer only what the picked scopes can run
  The "Add default models" drawer lists the chat and embedding models of the
  providers the picked scopes run on, not those of the page's project. A
  provider that lists only the models added to it (Azure OpenAI lists only its
  deployments) and holds none of a kind is named, so an empty picker explains
  itself instead of reading as "Not configured".

  @unit
  Scenario: A config row offers the chat models of the picked project, not the page's project
    Given the picked project runs an enabled OpenAI provider
    And the page's project runs a different provider
    When the models for the picked project are listed
    Then the OpenAI chat models are offered

  @unit
  Scenario: A config on several scopes is offered only the models every scope runs
    Given one picked project runs OpenAI and another runs only Anthropic
    When the models for both projects are listed
    Then no OpenAI or Anthropic model is offered

  @unit
  Scenario: Scopes that each offer chat models but share none are told apart from none
    Given one picked project runs OpenAI and another runs only Anthropic
    When the models for both projects are listed
    Then the answer says the scopes share no chat model
    And it does not say so for embeddings, which only one of them offers

  @unit
  Scenario: An organization config is not offered a model only one project's provider lists
    Given a deployment is listed on a project's Azure OpenAI provider only
    When the models for the organization are listed
    Then that deployment is not offered

  @unit
  Scenario: An Azure provider with no deployments is named as having none
    Given the picked project runs an enabled Azure OpenAI provider with no deployments
    When the models for the picked project are listed
    Then no chat or embedding model is offered
    And Azure OpenAI is named as holding no chat model and no embedding model

  @unit
  Scenario: A provider with catalogue models is never named for a kind it does not offer
    Given the picked project runs an enabled Anthropic provider
    When the models for the picked project are listed
    Then Anthropic is not named as holding no embedding model

  @unit
  Scenario: The note names every empty provider and calls a non-Azure provider's entries models
    Given two providers at the picked scopes list only what is added and have no chat model
    When the note explains the empty chat picker
    Then it names both providers in the plural
    And a provider other than Azure is said to have no chat model rather than no deployment

  @unit
  Scenario: Listing models for scopes of another organization is refused
    Given a picked scope belongs to another organization than the page's project
    When the models for the picked scopes are listed
    Then the read is refused with code "model_provider_invalid"

  @unit
  Scenario: Listing models for a scope the caller cannot view is refused
    Given the caller may view project B but not project A
    When the caller lists, from project B, the models for project A
    Then the read is refused before any provider of project A is read

  @unit
  Scenario: A deployment the organization's provider lists is offered beside the project's
    Given the organization's Azure OpenAI provider lists a deployment
    And the picked project's own Azure OpenAI provider lists another
    When the models for the picked project are listed
    Then both deployments are offered, as either one runs from the project

  @unit
  Scenario: Listing models with no scope picked offers nothing
    When the models for no scope are listed
    Then no model is offered and no provider is named

  @unit
  Scenario: The models read is declared with the project view permission
    Given the model provider router
    Then the scope models read requires "project:view"

  @integration
  Scenario: The drawer offers the models of the picked scopes
    Given the drawer edits a config on a project scope
    When the scope models read answers one chat model
    Then the Default picker lists that chat model
    And the read was asked for the config's scopes

  @integration
  Scenario: Empty chat pickers explain an Azure provider with no deployments
    Given the picked scope runs only an Azure OpenAI provider with no deployments
    When the drawer opens
    Then a note says Azure OpenAI lists only the deployments added to it
    And the note offers to open Azure OpenAI

  @integration
  Scenario: The note opens the provider to add a deployment
    Given the note names an Azure OpenAI provider with no deployments
    When the user opens the provider from the note
    Then the Azure OpenAI provider drawer opens on that provider

  @integration
  Scenario: Saving a provider refreshes the models offered for the picked scopes
    Given the drawer was offered no chat model for the picked scopes
    When the user saves a provider after adding a deployment to it
    Then the models offered for the picked scopes are read again

  @integration
  Scenario: Embeddings name an Azure provider with no embedding deployment
    Given the picked scope runs only an Azure OpenAI provider with no embedding deployment
    When the drawer opens
    Then the Embeddings row says to add an embedding deployment to Azure OpenAI
    And it does not say the provider cannot do embeddings

  @integration
  Scenario: Embeddings with no provider offering embeddings say so plainly
    Given the picked scope runs only a provider with no embedding models
    When the drawer opens
    Then the Embeddings row says no provider at these scopes offers an embedding model

  @integration
  Scenario: A refused models read says a picked scope cannot be viewed
    Given the scope models read is refused
    When the drawer opens
    Then a note says "You can't view one of the picked scopes"
    And it offers no retry
    And the Default picker lists no chat model
    And no provider is named as empty

  @integration
  Scenario: A failed models read says so and offers to try again
    Given the scope models read fails for a reason other than a refusal
    When the drawer opens
    Then a note says the models for the picked scopes could not be loaded
    When the user tries again
    Then the models are read again

  @integration
  Scenario: Scopes that share no chat model are told so
    Given every picked scope offers chat models but they share none
    When the drawer opens
    Then a note says no chat model is offered by every picked scope
    And it does not say that no provider offers one

  @integration
  Scenario: The note offers no Open button for a provider the user cannot open
    Given the note names an Azure OpenAI provider the provider editor cannot look up
    When the drawer opens
    Then the note still names Azure OpenAI
    And it offers no button to open it

  @integration
  Scenario: An Azure provider with no chat deployment warns before saving
    Given the Azure OpenAI provider form lists no chat deployment
    Then the form warns that no chat default can be picked until a chat deployment is added
    And saving stays possible

  @integration
  Scenario: An Azure provider with only embedding deployments warns that chat is missing
    Given the Azure OpenAI provider form lists an embedding deployment but no chat deployment
    Then the form warns that it has no chat deployment yet
    And it does not say that no model from it can be picked

  @integration
  Scenario: An Azure provider with a chat deployment shows no warning
    Given the Azure OpenAI provider form lists a chat deployment
    Then the form shows no missing deployment warning
