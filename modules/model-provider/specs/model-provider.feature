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

  # The response schema declares disabledByDefault and extraHeaders optional,
  # so it cannot settle whether they are sent. Main sends both; this branch had
  # stopped. A caller forced to presence-check every field cannot read the
  # entry at all, so the handler always populates them — the schema stays
  # optional, the answer does not.
  @unit
  Scenario: Every provider entry carries the same keys, present or empty
    Given a project's model providers
    When they are listed
    Then every entry carries disabledByDefault and extraHeaders

  @unit
  Scenario: The platform chain borrows the Google credential from data privacy
    Given data privacy holds the deployment's Google application credential
    When the platform provider chain is read
    Then vertex_ai is in the chain under GOOGLE_APPLICATION_CREDENTIALS
    And the credential is borrowed on the read, never while the module is constructing
