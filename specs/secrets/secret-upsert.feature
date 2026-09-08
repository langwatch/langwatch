Feature: The SDK stores a project secret under a name
  As an operator that keeps a credential in the project secret store
  I want one call that writes a value under a name
  So that I do not have to look up whether the secret exists first

  # The REST API creates a secret by name and updates it by id. The SDK facade
  # joins the two, so a caller writes a value under a name and the facade
  # decides between a create and an update.
  #
  # Values stay write-only. No route in this family returns a stored value.

  @unit
  Scenario: Storing a secret that does not exist yet creates it
    Given the project holds no secret named ACME_TOKEN
    When the caller stores a value under ACME_TOKEN
    Then the secret is created with that value

  @unit
  Scenario: Storing a secret that exists replaces its value
    Given the project holds a secret named ACME_TOKEN
    When the caller stores a new value under ACME_TOKEN
    Then the existing secret is updated and no second secret is created

  @unit
  Scenario: A secret created by a caller running beside this one is updated instead
    Given the project holds no secret named ACME_TOKEN when the caller starts
    And another caller creates ACME_TOKEN first
    When the caller stores a value under ACME_TOKEN
    Then the create is refused as a conflict and the caller updates the secret
