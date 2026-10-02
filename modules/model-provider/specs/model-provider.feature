Feature: Model Provider service
  Model Provider owns provider credentials, model defaults, costs, and translation selection.

  @unit
  Scenario: provider summaries never expose credentials
    Given a project has a stored provider with credentials
    When the Model Provider service lists providers for the project
    Then the provider summary contains a masked credential value
    And the provider repository remains private to the service

  @unit
  Scenario: every saved provider row in the project's scope is readable with its skip list
    Given a project can see a saved provider row with a stored list of models allowed to skip permission checks
    When a peer reads every provider row accessible to the project
    Then the row comes back with its stored skip list and a masked credential value

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
  Scenario: A stored provider reads disabledByDefault from its registry default
    Given a project has a stored provider whose registry default is not enabled on this deployment
    When the project's providers are read
    Then the stored provider is disabled by default

  @unit
  Scenario: The platform chain borrows the Google credential from data privacy
    Given data privacy holds the deployment's Google application credential
    When the platform provider chain is read
    Then vertex_ai is in the chain under GOOGLE_APPLICATION_CREDENTIALS
    And the credential is borrowed on the read, never while the module is constructing

  # Managed providers come from the managed-provider peer, as main's managed Bedrock config did.
  @unit
  Scenario: Bedrock reads as managed for an organization the managed-provider peer manages
    Given the managed-provider peer manages Bedrock for an organization
    When model provider asks whether Bedrock is managed for that organization
    Then it answers managed
    And any other provider or organization answers not managed

  @unit
  Scenario: A managed call runs with the parameters the managed-provider peer builds
    Given the managed-provider peer builds Bedrock parameters for a project
    When model provider prepares a Bedrock call for that project
    Then the call runs with the peer's parameters

  @unit
  Scenario: A managed call whose credentials cannot be assumed fails the call
    Given the managed-provider peer cannot assume the customer's role
    When model provider prepares a Bedrock call for that project
    Then preparing the call fails with the peer's error

  @unit
  Scenario: A managed-Bedrock organization lists Bedrock as an enabled system provider
    Given an organization with a project whose Bedrock is managed and not saved
    When the organization's providers are listed
    Then Bedrock is listed once as an enabled system provider

  @unit
  Scenario: A saved Bedrock row is not listed twice for a managed organization
    Given a managed-Bedrock organization that saved its own Bedrock row
    When the organization's providers are listed
    Then Bedrock is listed once, as the saved row

  @unit
  Scenario: An unmanaged organization lists no Bedrock system row
    Given an organization whose Bedrock is not managed and not configured
    When the organization's providers are listed
    Then Bedrock is not listed

  @unit
  Scenario: Moving a provider to another endpoint does not carry its stored secret along
    Given a provider saved with an API key and a base URL
    When the provider is saved with a different base URL and the key left masked
    Then the stored key is not kept
    And its masked extra header values are not kept
    And saving with a newly typed key keeps the new key with the new base URL

  @unit
  Scenario: A stored key is checked only against the endpoint it was saved with
    Given a provider saved with an API key and a base URL
    When its stored key is checked against a different base URL
    Then the check is refused as having no key, and nothing is sent
    And checking against the saved base URL uses the stored key
    And the deployment's own key is only checked against the provider's default endpoint
