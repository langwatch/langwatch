Feature: Model Provider service
  Model Provider owns provider credentials, model defaults, costs, and translation selection.

  @unit
  Scenario: provider summaries never expose credentials
    Given a project has a stored provider with credentials
    When the Model Provider service lists providers for the project
    Then the provider summary contains a masked credential value
    And the provider repository remains private to the service

  @unit
  Scenario: an unknown provider cannot be persisted
    Given the provider catalog does not know the requested provider
    When the Model Provider service receives a write
    Then it rejects the write before calling the repository

  @unit
  Scenario: translation uses the configured feature default
    Given the default-model repository resolves a model for "translate.text"
    When the Model Provider service translates text
    Then it calls the translation port with that model
    And it returns the translated text

  @unit
  Scenario: a provider may be visible at project, team, or organization scope
    Given a project is attached to a team and organization
    When the private repository lists providers for that project
    Then it may return providers attached at any of those scopes
