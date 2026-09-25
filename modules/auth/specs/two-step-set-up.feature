Feature: Setting two-step verification up speaks main's rules and our codes
  An account that holds no password (a passkey sign-up) sets two-step
  verification up with no password to type, as on main. A refusal from the
  two-factor endpoints reaches the browser under a registered code, so the
  screen shows the registry's words rather than the plugin's.

  @unit
  Scenario: An account with no password sets two-step verification up without one
    Given a signed-in person whose account holds no password
    When they start setting two-step verification up without a password
    Then they are given an authenticator link issued by "LangWatch"

  @unit
  Scenario: A wrong authenticator code is refused as identity_mfa_code_invalid
    Given a signed-in person part-way through setting two-step verification up
    When they enter a code their authenticator did not produce
    Then the refusal carries the code "identity_mfa_code_invalid"

  @unit
  Scenario: A wrong password is refused as identity_mfa_password_invalid
    Given a signed-in person whose account holds a password
    When they start setting two-step verification up with the wrong password
    Then the refusal carries the code "identity_mfa_password_invalid"

  @unit
  Scenario: Too many wrong codes is refused as identity_mfa_locked_out
    Given a two-factor endpoint that refused with better-auth's lockout
    When the refusal is answered
    Then it carries the code "identity_mfa_locked_out" at the status the endpoint chose
