Feature: Force a password reset for a set of users
  An operator can mark a user's password as no longer trusted. While the mark
  stands, a correct password opens no session: the person is sent to the
  forgot-password screen to choose a new one through the emailed reset link.
  A completed reset clears the mark, and the old password stops working
  because the reset replaced it. Sign-in methods that do not use the password
  (single sign-on, social providers, passkeys) are not affected.

  The mark is User.passwordResetRequiredAt. The auth module's
  require-password-reset task sets it through the user module and ends the
  marked users' browser sessions and CLI logins; any password write that replaces the stored
  hash clears it.

  # --- Sign-in ---

  @unit
  Scenario: A correct password for a marked user opens no session
    Given a user whose password is marked as requiring a reset
    When they sign in with their email and correct password
    Then no session is created
    And the refusal carries the code PASSWORD_RESET_REQUIRED

  @integration
  Scenario: A marked user who holds a second factor is refused before the challenge
    Given a marked user who has two-step verification turned on
    When they sign in with their email and correct password
    Then the refusal carries the code PASSWORD_RESET_REQUIRED
    And no two-step challenge is started

  @unit
  Scenario: A marked user still signs in through a provider or a passkey
    Given a user whose password is marked as requiring a reset
    When they sign in through a social provider, single sign-on or a passkey
    Then the session is created as usual

  @unit
  Scenario: The session opened by a completed reset is not refused by the mark
    Given a marked user completed a password reset
    When the reset opens its session for the device that set the password
    Then the session is created

  @unit
  Scenario: The refusal reaches the browser as identity_password_reset_required
    Given the password sign-in was refused because a reset is required
    When the refusal is answered
    Then it is the handled error "identity_password_reset_required" with status 403

  @unit
  Scenario: A wrong password for a marked user is refused like any wrong password
    Given a user whose password is marked as requiring a reset
    When they sign in with a wrong password
    Then the refusal is the handled error "identity_sign_in_refused" with status 401
    And nothing says that a reset is required

  @integration
  Scenario: A correct but marked password does not count toward the sign-in lockout
    Given a user whose password is marked as requiring a reset
    When they sign in with their email and correct password several times
    Then no failed attempt is recorded for their address
    And a wrong password is still recorded as a failed attempt

  # --- Clearing the mark ---

  @integration
  Scenario: Completing a password reset clears the mark
    Given a marked user with a credential password
    When they complete a password reset from the emailed link
    Then the mark is cleared
    And the new password signs in
    And the old password is refused

  @unit
  Scenario: Changing the password from the account settings clears the mark
    Given a marked user signed in through another method
    When they change their password from the account settings
    Then the mark is cleared

  # --- The browser ---

  @integration
  Scenario: The sign-in form sends a marked user to choose a new password
    Given I am on the password step of the sign-in screen
    When the sign-in is refused because a reset is required
    Then I am sent to the forgot-password screen with my email filled in
    And no error about a wrong password is shown

  @integration
  Scenario: The forgot-password screen says why a new password is needed
    Given I arrived at the forgot-password screen because a reset is required
    Then the screen says I need to choose a new password before signing in
    And submitting sends the reset link to my email

  @integration
  Scenario: A marked user on a deployment without email is told who can help
    Given the deployment has no outbound email configured
    And I arrived at the forgot-password screen because a reset is required
    Then the screen says I need to choose a new password before signing in
    And it tells me to contact my administrator

  # --- Marking users (operator task) ---

  @integration
  Scenario: The task marks every user who holds a password
    Given users with a credential password and users who sign in only through a provider
    When the operator runs require-password-reset with --all-credential-users
    Then every user with a credential password is marked
    And users without a password are not marked

  @integration
  Scenario: The task marks only the users named by email
    Given several users with a credential password, one stored with capitals in its address
    When the operator runs require-password-reset with --email for that one, in any case
    Then only that user is marked

  @unit
  Scenario: A dry run counts and writes nothing
    Given users with a credential password
    When the operator runs require-password-reset with --all-credential-users --dry-run
    Then the task reports how many users would be marked
    And no user is marked
    And no session or CLI login is ended

  @unit
  Scenario: Marking a user ends their sessions
    Given users with a credential password, one of them marked by an earlier run
    When the operator runs require-password-reset for them
    Then every matched user's browser sessions and CLI logins are ended
    And the task reports how many users had their sessions ended and how many CLI tokens were revoked

  @unit
  Scenario: A misspelled flag is refused before anyone is marked
    When the operator runs require-password-reset with --all-credential-users --dryrun
    Then the task fails naming the unknown argument
    And no user is marked

  @integration
  Scenario: Running the task again keeps the first mark
    Given a user marked by an earlier run
    When the operator runs the task again for the same user
    Then the user's mark keeps its original time

  @unit
  Scenario: The task refuses to run without saying whom to mark
    When the operator runs require-password-reset with no selector
    Then the task fails naming --all-credential-users and --email
    And no user is marked

  @integration
  Scenario: The task reports addresses that hold no password
    Given an address with no account and an address whose account has no password
    When the operator runs require-password-reset with --email for both
    Then the task reports both addresses as not marked
    And no user is marked
