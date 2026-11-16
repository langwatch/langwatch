Feature: Saving a provider keeps what the operator set and where it lives
  Saving a provider from Settings, Model providers stores every per-model setting
  the custom-model form collected, the gateway routes every model the row stores
  whichever shape it was stored in, and a provider of another project in the same
  organization can be saved from any page without moving it.

  @unit
  Scenario: A saved custom model keeps its max tokens, parameters and inputs
    Given the custom-model form set a max tokens limit, supported parameters and multimodal inputs
    When the provider is saved
    Then the stored custom model carries the same max tokens, parameters and inputs

  @unit
  Scenario: A custom model list without settings stores none
    Given a custom model list sent as plain ids
    When the provider is saved
    Then each stored custom model carries only its id, label and type

  @unit
  Scenario: The gateway routes a custom model stored in the saved shape
    Given a provider row whose custom models were stored as id, label and type
    When the gateway lists the models that provider declares
    Then each stored model id is declared
    And no entry is dropped as unroutable

  @unit
  Scenario: The gateway reads a custom model's settings from either stored shape
    Given a custom model stored as id, label and type with a max tokens limit
    When the stored list is read for the gateway
    Then it reads as that model with the same max tokens, parameters and inputs
    And a list mixing plain ids, the older model id shape and the saved shape reads every entry

  @unit
  Scenario: A provider of another project is saved from the page's project
    Given a provider attached only to project A of an organization
    And the operator can write project A
    When they save it while the page is on project B of the same organization
    Then the provider is saved
    And it stays attached to project A only

  @unit
  Scenario: Saving a provider without scopes keeps the scopes it already has
    Given a provider attached only to project A of an organization
    When it is saved from project B without naming any scopes
    Then it stays attached to project A only

  @unit
  Scenario: A provider of another project is not saved by someone who cannot write that project
    Given a provider attached only to project A of an organization
    And the operator can write project B but not project A
    When they save it while the page is on project B
    Then the save is refused as model_provider_scope_forbidden
    And the stored provider is unchanged

  @unit
  Scenario: A provider of another organization is not found from the page's project
    Given a provider attached to a project of another organization
    When it is saved while the page is on project B
    Then the save is refused as model_provider_not_found
