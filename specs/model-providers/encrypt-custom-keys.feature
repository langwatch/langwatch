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

  @integration
  Scenario: All database access goes through the repository
    Given the API process's setup checklist reports whether a provider is configured
    When the checklist answers the provider step
    Then the read is issued by the model provider repository, not by the checklist
    And the read selects an identifier rather than the stored credential
    And a provider attached to the organization counts toward every project under it
