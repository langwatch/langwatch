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
  Scenario: The browser hands a refused setup on whole, so the screen words its code
    Given the two-factor endpoint refused a setup with the handled body for "identity_mfa_password_invalid"
    When the browser starts setting two-step verification up
    Then the refusal it hands the screen is that body, code included

  @unit
  Scenario: The plugin's raw disable route is sealed; turning it off goes through identity
    Given a signed-in person whose account holds a password
    When they post their password to the plugin's own "/two-factor/disable" route
    Then the route answers as one that does not exist
    But identity's disable, which asks every requiring organization and a current code, still reaches the plugin

  @integration
  Scenario: An unfinished two-step challenge does not stop the next sign-in
    Given a person who signed in with their password and left the code step unfinished
    When they sign in with their password again, or a second person is mid-challenge
    Then the new challenge is stored beside the old one and the code step is offered
    # WEB-19201: main stores the challenge's value under a unique column and answers 500 here.

  @unit
  Scenario: Too many wrong codes is refused as identity_mfa_locked_out
    Given a two-factor endpoint that refused with better-auth's lockout
    When the refusal is answered
    Then it is the handled error "identity_mfa_locked_out" at its own status

  @unit
  Scenario: With the flag off, passkeys do not exist
    Given a deployment whose passkey flag is off
    When the authentication plugins are mounted
    Then no passkey plugin is mounted
