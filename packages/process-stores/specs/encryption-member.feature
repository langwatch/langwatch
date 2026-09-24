Feature: The encryption member reads and writes main's sealed credentials

  Stored credentials cross releases in both directions (ADR-155): a value main
  sealed opens here, and a value sealed here opens on main after a rollback.
  main sealed AES-256-GCM as hex `iv:ciphertext:tag` under CREDENTIALS_SECRET,
  or NEXTAUTH_SECRET when CREDENTIALS_SECRET is unset, both read as 32 bytes of hex.

  @unit
  Scenario: A value main sealed opens
    Given a credential sealed by main's own algorithm under the deployment key
    When a module decrypts it through the encryption member
    Then it reads the original plaintext

  @unit
  Scenario: A value sealed here opens on main
    Given a credential encrypted through the encryption member
    When main's own algorithm decrypts it under the same key
    Then it reads the original plaintext

  @unit
  Scenario: A value this branch once sealed in base64url still opens
    Given a credential sealed as base64url iv.tag.ciphertext under the deployment key
    When a module decrypts it through the encryption member
    Then it reads the original plaintext

  @unit
  Scenario: A value sealed under another key is refused without quoting it
    Given a credential sealed under a different key
    When a module decrypts it through the encryption member
    Then decryption throws an error that does not contain the sealed value

  @unit
  Scenario: A value in no known shape is refused without quoting it
    Given a stored value that is neither hex iv:ciphertext:tag nor base64url iv.tag.ciphertext
    When a module decrypts it through the encryption member
    Then decryption throws an error that does not contain the stored value

  @unit
  Scenario: The session secret keys the member when CREDENTIALS_SECRET is unset
    Given a process started with NEXTAUTH_SECRET and no CREDENTIALS_SECRET
    When a credential main sealed under NEXTAUTH_SECRET is decrypted through the encryption member
    Then it reads the original plaintext

  @unit
  Scenario: CREDENTIALS_SECRET keys the member when both are set
    Given a process started with both CREDENTIALS_SECRET and NEXTAUTH_SECRET
    When a credential main sealed under CREDENTIALS_SECRET is decrypted through the encryption member
    Then it reads the original plaintext
