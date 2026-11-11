Feature: A project admin restricts which models Langy may use
  As a project admin whose organization only trusts some models
  I want to choose which models Langy may run on in my project
  So that Langy never sends my data to a model we have not approved

  # The list lives where every check already reads it: `config.modelsAllowed`
  # on the project's product-managed Langy virtual key. The gateway, turn
  # preparation, the warm-up and the composer's picker all enforce that field,
  # so saving it is the whole feature. Product-managed keys stay hidden from
  # key listings and refuse customer edit, rotate and revoke (#5966): this is a
  # narrow write of one field that never touches the secret.
  # An empty list means every model the project's providers serve.

  @integration
  Scenario: A project admin saves the models Langy may use
    Given a project whose Langy key allows every model
    When a project admin saves "openai/gpt-5" and "anthropic/claude-sonnet-4-5" as Langy's models
    Then the Langy key's allowed models are exactly those two
    And every gateway is told to fetch the Langy key's configuration again
    And the change is recorded in the audit log

  @integration
  Scenario: Clearing the list lets Langy use every model again
    Given a project whose Langy key allows only "openai/gpt-5"
    When a project admin saves an empty list
    Then the Langy key allows every model

  @integration
  Scenario: Saving the list never changes the Langy key's secret or visibility
    Given a project whose Langy key allows every model
    When a project admin saves "openai/gpt-5" as Langy's only model
    Then the Langy key keeps its secret
    And the Langy key's other settings are unchanged
    And the Langy key is still absent from the organization's key listing

  @integration
  Scenario: Every live Langy key of the project carries the list
    Given a project holding two live Langy keys
    When a project admin saves "openai/gpt-5" as Langy's only model
    Then both Langy keys allow only "openai/gpt-5"

  @integration
  Scenario: The list never reaches a key that is not the project's Langy key
    Given a customer key and another project's Langy key
    When a project admin saves "openai/gpt-5" as Langy's only model
    Then neither of those keys changes

  @unit
  Scenario: Saving the list before Langy ever ran provisions its key first
    Given a project that has no Langy key yet
    When a project admin saves "openai/gpt-5" as Langy's only model
    Then the Langy key is provisioned
    And the list is written onto it

  @unit
  Scenario: Saving refuses when no Langy key can hold the list
    Given a project whose Langy key was revoked while its secret is still stored
    When a project admin saves "openai/gpt-5" as Langy's only model
    Then the save is refused as the Langy key being missing
    And the admin is never told the list was saved

  @unit
  Scenario: A model reference without a provider is refused
    When a project admin saves "gpt-5" as Langy's only model
    Then the request is refused as invalid input
    And the Langy key is unchanged

  @unit
  Scenario: The saved list reads back trimmed and without duplicates
    When a project admin saves " openai/gpt-5 ", "openai/gpt-5" and "openai/gpt-5-mini"
    Then Langy's models read back as "openai/gpt-5" and "openai/gpt-5-mini"

  @integration
  Scenario: Only a project admin may change Langy's models
    Given a project member without the "langy:manage" permission
    When they try to save Langy's models
    Then the request is refused before anything is written
    And they can still read the current list

  @unit
  Scenario: The demo project refuses the Langy model list
    When anyone saves Langy's models on the demo project
    Then the request is refused as Langy not enabled

  @integration
  Scenario: The settings page offers only the models the project can serve
    Given the project has OpenAI connected and no other provider
    When a project admin opens Langy settings
    Then the model list offers OpenAI's chat models
    And it says that leaving it empty lets Langy use every model

  @integration
  Scenario: The settings page warns when Langy's default model is outside the list
    Given Langy's default model is "openai/gpt-5"
    When a project admin picks only "openai/gpt-5-mini"
    Then the page warns that the default model is not in the list
    And it explains that chats switch to an allowed model while runs on the default are refused

  @integration
  Scenario: A member without manage rights sees the list read-only
    Given a project member without the "langy:manage" permission
    When they open Langy settings
    Then they see Langy's current models
    And they cannot change them

  @integration
  Scenario: The page offers no save until the current list has loaded
    Given Langy's current models cannot be read
    When a project admin opens Langy settings
    Then the page says the list could not be loaded
    And it offers no way to save a list
