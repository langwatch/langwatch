@unit
Feature: webauthnsim, virtual WebAuthn authenticators in the test browser
  Passkeys, security keys and U2F tokens are emulated by Chromium's CDP WebAuthn
  domain on a haven browser lane's page, so a ceremony runs the real server path
  with no device. The e2e suites attach the same kinds through one helper.

  Scenario: A passkey, a security key and a U2F key each attach with their own defaults
    When the developer runs "haven browser authenticator add --lane q"
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
    When the developer runs "haven browser authenticator list --lane q"
    Then each authenticator shows its id, kind and user verification, and each credential its id, rpId, userHandle and signCount
    And no private key is ever shown
    When they run "haven browser authenticator uv --lane q <id> no"
    Then the next assertion that requires user verification fails with NotAllowedError until "uv <id> yes"
    When they run "haven browser authenticator remove --lane q <id>"
    Then the authenticator and its credentials are gone from the lane
