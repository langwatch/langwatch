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
    Then the customKeys column contains an encrypted string
    And the encrypted string is not valid JSON
    And the encrypted string contains three colon-separated segments

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
  Scenario: Migration encrypts existing plaintext keys
    Given model providers with plaintext customKeys in the database
    When the key sealing upgrade step runs
    Then all plaintext customKeys are encrypted
    And the step reports the number of updated rows, saving its progress after each

  @unit
  Scenario: Migration is idempotent
    Given model providers with already-encrypted customKeys
    When the key sealing upgrade step runs again
    Then the already-encrypted rows are skipped
    And the data remains valid after decryption

  @unit
  Scenario: The key sealing step resumes after its last sealed row, and a dry run writes nothing
    Given model providers with plaintext customKeys in the database
    When the key sealing upgrade step runs as a dry run
    Then no row is written, no progress is saved, and the report counts the rows it would seal
    And a run from progress saved after a row seals only the rows after it

  @unit
  Scenario: A model provider saved while its keys are being sealed keeps the newer save
    Given model providers with plaintext customKeys in the database
    And a user saves new keys on one provider after the step read it and before the step writes it
    When the key sealing upgrade step runs
    Then that provider keeps the newly saved keys
    And the other providers are sealed

  @unit
  Scenario: A model provider changed during sealing whose keys are still plaintext holds the key sealing step
    Given model providers with plaintext customKeys in the database
    And one provider is edited after the step read it, leaving its keys in plaintext
    When the key sealing upgrade step runs
    Then the other providers are sealed
    And no progress is saved past the edited provider
    And the step fails, so a retry revisits that provider

  @integration
  Scenario: All database access goes through the repository
    Given the API process's setup checklist reports whether a provider is configured
    When the checklist answers the provider step
    Then the read is issued by the model provider repository, not by the checklist
    And the read selects an identifier rather than the stored credential
    And a provider attached to the organization counts toward every project under it
