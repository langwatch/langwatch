Feature: Encrypt model provider API keys at rest
  As a platform operator
  I want model provider API keys encrypted in the database
  So that a database breach does not expose customer credentials

  Background:
    Given a project with CREDENTIALS_SECRET configured
    And the encryption utility uses AES-256-GCM

  Scenario: New model provider keys are encrypted on save
    When a user saves a model provider with an API key
    Then the customKeys column contains an encrypted string
    And the encrypted string is not valid JSON
    And the encrypted string contains three colon-separated segments

  Scenario: Encrypted keys are decrypted on read
    Given a model provider with encrypted customKeys in the database
    When the repository reads the model provider
    Then the returned customKeys is a decrypted JSON object
    And the original key values are preserved

  Scenario: Null customKeys are handled gracefully
    When a model provider is saved without customKeys
    Then the customKeys column remains null
    And reading the model provider returns null customKeys

  Scenario: Migration encrypts existing plaintext keys
    Given model providers with plaintext customKeys in the database
    When the encryption migration task runs
    Then all plaintext customKeys are encrypted
    And the migration logs the number of updated rows

  Scenario: Migration is idempotent
    Given model providers with already-encrypted customKeys
    When the encryption migration task runs again
    Then the already-encrypted rows are skipped
    And the data remains valid after decryption

  Scenario: All database access goes through the repository
    Given the modelProvider router and service
    Then no code outside the repository calls prisma.modelProvider directly
    And deletes use repository.delete or repository.deleteByProvider
    And reads use repository.findAll or repository.findByProvider
