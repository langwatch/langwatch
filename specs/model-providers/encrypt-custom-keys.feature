Feature: Encrypt model provider API keys at rest
  As a platform operator
  I want model provider API keys encrypted in the database
  So that a database breach does not expose customer credentials

  Background:
    Given a project with CREDENTIALS_SECRET configured
    And the encryption utility uses AES-256-GCM

  @unit
  Scenario: New model provider keys are encrypted on save
    When a user saves a model provider with an API key
    Then the customKeys column holds an encrypted string
    And that string cannot be read back as the key object

  @unit
  Scenario: Encrypted keys are decrypted on read
    Given a model provider with encrypted customKeys in the database
    When the repository reads the model provider
    Then the returned customKeys is a decrypted JSON object
    And the original key values are preserved

  @unit
  Scenario: Null customKeys are handled gracefully
    When a model provider is saved without customKeys
    Then the customKeys column remains null
    And reading the model provider returns null customKeys

  @unit
  Scenario: The migration encrypts a plaintext row
    Given a model provider row whose customKeys are still plaintext
    When the encryption migration processes that row
    Then it hands back the encrypted replacement value

  # The per-row decision is proven; how many rows the task touched, and that it
  # says so, is not asserted anywhere.
  @unit @unimplemented
  Scenario: The migration reports how many rows it updated
    Given several plaintext model provider rows
    When the encryption migration task runs
    Then it logs the number of rows it updated

  @unit
  Scenario: Migration is idempotent
    Given model providers with already-encrypted customKeys
    When the encryption migration task runs again
    Then the already-encrypted rows are skipped
    And the data remains valid after decryption

  # A structural rule with no structural test. It wants a lint rule or an
  # import-graph assertion, not a hand-checked claim in a feature file.
  @unit @unimplemented
  Scenario: All database access goes through the repository
    Given the modelProvider router and service
    Then no code outside the repository calls prisma.modelProvider directly
    And deletes use repository.delete or repository.deleteByProvider
    And reads use repository.findAll or repository.findByProvider
