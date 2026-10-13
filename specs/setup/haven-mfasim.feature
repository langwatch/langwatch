@unit
Feature: mfasim, second factors in the test browser
  Passkeys, security keys and U2F tokens are emulated by Chromium's CDP WebAuthn
  domain on a haven browser lane's page, so a ceremony runs the real server path
  with no device. TOTP codes come from a secret the browser daemon reads off the
  enrolment page and keeps in the lane's haven state, so an agent enrols and
  answers two-step codes without ever holding the secret. `haven browser mfa` drives both
  on a `haven browser` lane. The e2e suites attach the same WebAuthn kinds through
  one helper.

  Scenario: A passkey, a security key and a U2F key each attach with their own defaults
    When the developer runs "haven browser mfa add --lane q"
    Then a ctap2 internal authenticator with resident keys and user verification is attached
    When they add "--kind security-key"
    Then a ctap2 usb authenticator with presence only is attached, unless "--uv yes" or "--resident yes" asks for more
    When they add "--kind u2f"
    Then a u2f usb authenticator with no resident keys and no user verification is attached
    And presence is always simulated

  Scenario: An authenticator command refuses what it cannot emulate
    When the developer asks for an unknown kind, a u2f key with user verification or resident keys, a yes|no flag with another value, a missing id or no lane
    Then the command fails before reaching the browser and names the usage

  Scenario: Listing, removing and failing user verification address one authenticator by id
    Given a lane with a passkey that has registered a credential
    When the developer runs "haven browser mfa list --lane q"
    Then each authenticator shows its id, kind and user verification, and each credential its id, rpId, userHandle and signCount
    And no private key is ever shown
    When they run "haven browser mfa uv <id> no --lane q"
    Then the next assertion that requires user verification fails with NotAllowedError until "uv <id> yes"
    When they run "haven browser mfa remove <id> --lane q"
    Then the authenticator and its credentials are gone from the lane

  Scenario: TOTP enroll reads the secret off the page and keeps it from the caller
    Given lane "q" shows the two-step setup with its scannable code and setup key
    When the developer runs "haven browser mfa totp enroll --lane q"
    Then the daemon reads the otpauth URI or the setup key from the page, or from the ref given
    And stores it for lane "q" in a file only its owner can read
    And the command answers with the digits and period only, never the secret
    And a snapshot or eval of the page shows the key as "***" and a screenshot masks it

  Scenario: TOTP fill types the current code, or a wrong one, without printing it
    Given lane "q" has enrolled TOTP
    When the developer runs "haven browser mfa totp fill <ref> --lane q"
    Then the code for the current time step is typed into the field and the app accepts it
    And the code appears in no output, log or error
    When they run "haven browser mfa totp fill <ref> --lane q --wrong"
    Then a well-formed code that matches no accepted time window is typed, and the app refuses it
    When a lane that never enrolled runs "haven browser mfa totp fill <ref>"
    Then the command fails and names "haven browser mfa totp enroll"
