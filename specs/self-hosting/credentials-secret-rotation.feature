Feature: Rotating CREDENTIALS_SECRET

  CREDENTIALS_SECRET seals every stored credential, peppers API key and SCIM
  token hashes and keys the fingerprint that stops one Slack secret being
  connected twice. An operator rotates it by moving the old value to
  CREDENTIALS_SECRET_PREVIOUS and setting a new CREDENTIALS_SECRET. The previous
  secret only reads: nothing is ever written under it. The `credentials-reseal`
  task moves stored values to the new secret, after which the previous secret
  can be removed.

  @unit
  Scenario: A value sealed before the rotation still reads while the previous secret is set
    Given a credential sealed under the old CREDENTIALS_SECRET
    And a process started with a new CREDENTIALS_SECRET and the old one as CREDENTIALS_SECRET_PREVIOUS
    When the credential is read
    Then it reads the original plaintext

  @unit
  Scenario: A value written after the rotation is sealed under the new secret alone
    Given a process started with a new CREDENTIALS_SECRET and the old one as CREDENTIALS_SECRET_PREVIOUS
    When a credential is saved
    Then the new secret alone opens the stored value
    And the previous secret does not open it

  @unit
  Scenario: A previous secret in the wrong format is refused
    Given a CREDENTIALS_SECRET_PREVIOUS that is not 64 hex characters
    When the process opens its stores and reads the encryption member
    Then it refuses, naming CREDENTIALS_SECRET_PREVIOUS

  @unit
  Scenario: An API key issued before the rotation keeps working and moves to the new secret on use
    Given an API key hashed under the old CREDENTIALS_SECRET
    And a process started with a new CREDENTIALS_SECRET and the old one as CREDENTIALS_SECRET_PREVIOUS
    When a request presents the key
    Then the key is accepted
    And its stored hash is rewritten under the new secret

  @unit
  Scenario: An API key issued before the rotation is refused once the previous secret is removed
    Given an API key hashed under the old CREDENTIALS_SECRET that was never used during the rotation
    And a process started with the new CREDENTIALS_SECRET and no CREDENTIALS_SECRET_PREVIOUS
    When a request presents the key
    Then the key is refused

  @unit
  Scenario: A dedicated API key pepper keeps API keys out of the rotation
    Given a process started with API_KEY_PEPPER set
    And an API key hashed under the value CREDENTIALS_SECRET_PREVIOUS holds
    When a request presents the key
    Then the key is refused

  @unit
  Scenario: A SCIM token issued before the rotation keeps working and moves to the new secret on use
    Given a SCIM token whose digest was stored under the old CREDENTIALS_SECRET
    And a process started with a new CREDENTIALS_SECRET and the old one as CREDENTIALS_SECRET_PREVIOUS
    When the directory presents the token
    Then the token is accepted
    And its stored digest is rewritten under the new secret

  @unit
  Scenario: A Slack secret connected before the rotation is recognised and moves to the new secret
    Given a Slack connection whose secret fingerprint was stored under the old CREDENTIALS_SECRET
    And a process started with a new CREDENTIALS_SECRET and the old one as CREDENTIALS_SECRET_PREVIOUS
    When the same Slack secret is saved for the project again
    Then the existing connection is answered and no second one is created
    And its stored fingerprint is rewritten under the new secret

  @unit
  Scenario: Connecting a Slack secret already connected before the rotation is refused
    Given a Slack connection whose secret fingerprint was stored under the old CREDENTIALS_SECRET
    And a process started with a new CREDENTIALS_SECRET and the old one as CREDENTIALS_SECRET_PREVIOUS
    When a second connection is created in the same scope with the same Slack secret
    Then it is refused as slack_connection_exists, naming the existing connection

  @unit
  Scenario: Replacing a Slack connection's secret with one connected before the rotation is refused
    Given a Slack connection whose secret fingerprint was stored under the old CREDENTIALS_SECRET
    And a process started with a new CREDENTIALS_SECRET and the old one as CREDENTIALS_SECRET_PREVIOUS
    When another connection in the same scope is edited to hold the same Slack secret
    Then the edit is refused as slack_connection_exists

  @unit
  Scenario: Moving a Slack connection made before the rotation into a scope holding its secret is refused
    Given a project Slack connection whose secret fingerprint was stored under the old CREDENTIALS_SECRET
    And an organization connection holding the same Slack secret, stored under the new CREDENTIALS_SECRET
    When the project connection is moved to the organization without a new secret
    Then the move is refused as slack_connection_exists

  @unit
  Scenario: A Slack secret connected after the rotation is fingerprinted under the new secret alone
    Given a process started with a new CREDENTIALS_SECRET and the old one as CREDENTIALS_SECRET_PREVIOUS
    When a Slack connection is created
    Then its stored fingerprint is the one the new secret gives

  @unit
  Scenario: A Slack secret never seen during the rotation is not recognised once the previous secret is removed
    Given a Slack connection whose secret fingerprint was stored under the old CREDENTIALS_SECRET and never looked up during the rotation
    And a process started with the new CREDENTIALS_SECRET and no CREDENTIALS_SECRET_PREVIOUS
    When the same Slack secret is saved for the project again
    Then a second connection is created

  @unit
  Scenario: A sealed value inside a larger stored value is re-sealed in place
    Given a stored JSON document holding a credential sealed under the previous secret beside other fields
    When the document is re-sealed
    Then the credential opens under the new secret alone
    And every other field is unchanged

  @unit
  Scenario: The re-seal task without a previous secret only reports
    Given stored values sealed under the current secret and under an unknown key
    And no CREDENTIALS_SECRET_PREVIOUS
    When the operator runs the credentials-reseal task
    Then it reports which values the current secret opens and which it does not
    And it writes nothing

  @integration
  Scenario: The re-seal task makes the previous secret removable
    Given credentials sealed under the previous secret in a text column and inside a JSON column
    When the operator runs the credentials-reseal task
    Then each credential opens under the new secret alone
    And the summary counts them as re-sealed under their table and column

  @integration
  Scenario: A dry run reports what would be re-sealed and changes nothing
    Given credentials sealed under the previous secret
    When the operator runs the credentials-reseal task with --dry-run
    Then the summary counts them as re-sealed
    And every stored value is unchanged

  @integration
  Scenario: A value sealed under neither secret is reported and left alone
    Given a stored value sealed under a key that is neither the current nor the previous secret
    When the operator runs the credentials-reseal task
    Then the summary counts it as undecryptable under its table and column
    And the stored value is unchanged
    And the task finishes without failing

  @integration
  Scenario: Running the re-seal task again changes nothing
    Given the credentials-reseal task has already moved every credential to the new secret
    When the operator runs it again
    Then it re-seals nothing
    And it counts the moved credentials as already current
