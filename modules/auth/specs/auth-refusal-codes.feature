Feature: Auth refusals reach the browser under registered codes
  better-auth answers a refusal in its own vocabulary. As on main, the sign-in,
  sign-up, password-reset, email-verification and passkey endpoints re-answer
  the refusals whose cause we know under our registered codes, so the browser
  shows the registry's words. Causes a caller must not tell apart share one code.

  @unit
  Scenario: A wrong password on sign-in is refused as identity_sign_in_refused
    Given an account holding a password
    When somebody signs in to it with the wrong password
    Then the refusal carries the code "identity_sign_in_refused"

  @unit
  Scenario: An address nobody holds is refused on sign-in exactly as a wrong password
    Given no account holds an address
    When somebody signs in with that address
    Then the refusal carries the code "identity_sign_in_refused"

  @unit
  Scenario: Signing up with an address already registered is refused as email_already_registered
    Given an account holding an address
    When somebody signs up again with that address
    Then the refusal carries the code "email_already_registered"

  @unit
  Scenario: Signing up with a password that is too short is refused as identity_password_rejected
    Given nobody holds an address
    When somebody signs up with it and a password shorter than the policy allows
    Then the refusal carries the code "identity_password_rejected"

  @unit
  Scenario: A password reset link that will not spend is refused as identity_reset_link_invalid
    Given a password reset token nobody was issued
    When somebody resets a password with it
    Then the refusal carries the code "identity_reset_link_invalid"

  @unit
  Scenario: An expired verification link is refused as identity_verification_expired
    Given the email verification endpoint refused with better-auth's expired token
    When the refusal is answered
    Then it carries the code "identity_verification_expired" at the status the endpoint chose

  @unit
  Scenario: A passkey nobody holds is refused as identity_passkey_not_recognized
    Given the passkey endpoint refused with better-auth's unknown passkey
    When the refusal is answered
    Then it carries the code "identity_passkey_not_recognized" at the status the endpoint chose

  @unit
  Scenario: A passkey already on the account is refused as identity_passkey_already_registered
    Given the passkey registration endpoint refused with better-auth's previously registered
    When the refusal is answered
    Then it carries the code "identity_passkey_already_registered"

  @unit
  Scenario: A refusal on an endpoint main left untranslated keeps better-auth's code
    Given the password reset request endpoint refused with a better-auth code
    When the refusal is answered
    Then it keeps better-auth's code
