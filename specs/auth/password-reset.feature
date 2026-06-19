Feature: Forgot / reset password on credential (email-mode) sign-in
  As a LangWatch user who signed up with an email and password
  I want to reset my password from the sign-in screen when I forget it
  So that I can recover my account on my own, without contacting support

  # Password reset only exists in on-prem credential mode
  # (NEXTAUTH_PROVIDER="email"). In Auth0 / Google / SSO deployments the
  # identity provider owns the credential, so the sign-in screen renders a
  # provider redirect instead of the email/password form — and BetterAuth's
  # /request-password-reset and /reset-password endpoints stay blocked by the
  # cloud-mode gate. The flow reuses the same email infrastructure
  # (SendGrid or AWS SES via `sendEmail`) that powers invites and other
  # transactional mail. BetterAuth already mounts and rate-limits the reset
  # endpoints; this feature wires the previously-missing `sendResetPassword`
  # callback to the mailer and adds the two user-facing pages.

  # --- Sign-in entry point ---

  @integration
  Scenario: The credential sign-in form shows a Forgot password link
    Given the tenant runs on NEXTAUTH_PROVIDER="email"
    When I open /auth/signin
    Then I see the email and password fields
    And I see a "Forgot password?" link pointing to /auth/forgot-password

  @integration
  Scenario: SSO sign-in renders no credential form and no Forgot password link
    Given the tenant runs on a social provider (NEXTAUTH_PROVIDER is not "email")
    When I open /auth/signin
    Then the credential form is not rendered
    And there is no "Forgot password?" link

  @integration
  Scenario: The forgot and reset pages are reachable without signing in
    Given I am not signed in
    When I open /auth/forgot-password or /auth/reset-password
    Then the page renders without bouncing me to sign in
    And a genuinely protected route still bounces me to sign in with a callback

  # --- Requesting a reset (/auth/forgot-password) ---

  @integration
  Scenario: Requesting a reset submits the entered email to the reset endpoint
    Given I am on /auth/forgot-password
    When I enter my email and submit
    Then the app calls BetterAuth requestPasswordReset with that email

  @integration
  Scenario: Requesting a reset always shows a neutral confirmation
    Given I am on /auth/forgot-password
    When I submit any email address
    Then I see a confirmation that a reset link was sent if an account exists
    And the confirmation does not reveal whether the email is registered

  @integration
  Scenario: A failure to dispatch the request still shows the neutral confirmation
    Given I am on /auth/forgot-password
    And the reset endpoint returns an error
    When I submit my email
    Then I still see the same neutral confirmation
    And no error is shown that could be used to enumerate accounts

  # --- The reset email ---

  @integration
  Scenario: The reset email is sent through the existing email infrastructure
    When a reset email is generated for a user
    Then it is dispatched via the shared sendEmail mailer
    And the subject names LangWatch and the password reset

  @integration
  Scenario: The reset email links to the reset page with a one-time token
    When a reset email is generated with a token
    Then the email body contains a button linking to /auth/reset-password with that token

  @integration
  Scenario: The reset email tells the user it expires and is safe to ignore
    When a reset email is generated
    Then the body says the link expires
    And the body says the user can ignore the email if they did not request it

  # --- Reset link, session revocation, and rate limiting ---

  @integration
  Scenario: The reset link is rooted at the deployment's own URL and carries the token
    Given a password reset is generated for a user
    Then the user is sent a reset email
    And the reset link points at this deployment's reset page and carries the token

  @integration
  Scenario: A successful reset revokes all of the user's existing sessions
    Given a user completes a password reset
    Then every existing session for that user is revoked

  @integration
  Scenario: Password reset endpoints are rate-limited to five attempts per hour
    Given the BetterAuth rate-limit configuration
    Then /request-password-reset allows at most 5 attempts per hour
    And /reset-password allows at most 5 attempts per hour

  # --- Setting the new password (/auth/reset-password) ---

  @integration
  Scenario: Submitting a valid new password with a token resets it and returns to sign-in
    Given I open /auth/reset-password with a valid token
    When I enter a new password and a matching confirmation and submit
    Then the app calls BetterAuth resetPassword with the new password and token
    And on success I see a confirmation and a link to sign in

  @integration
  Scenario: The reset form rejects passwords shorter than 8 characters
    Given I open /auth/reset-password with a token
    When I enter a new password shorter than 8 characters
    Then I see a validation error and the reset endpoint is not called

  @integration
  Scenario: The reset form rejects a mismatched confirmation
    Given I open /auth/reset-password with a token
    When the password and confirmation do not match
    Then I see a "Passwords don't match" error and the reset endpoint is not called

  @integration
  Scenario: An invalid or expired token surfaces an error and a way to retry
    Given I open /auth/reset-password with an expired token
    When I submit a valid new password
    Then I see an error that the link is invalid or expired
    And I see a link to request a new reset

  @integration
  Scenario: Opening the reset page without a token prompts a new request
    Given I open /auth/reset-password with no token in the URL
    Then I am told the link is invalid
    And I see a link to request a new reset

  # --- Cloud / SSO mode guard (existing invariant) ---

  # Enforced by the existing BetterAuth `hooks.before` gate and the
  # `emailAndPassword.enabled = NEXTAUTH_PROVIDER === "email"` flag: in
  # cloud/SSO mode the reset endpoints throw EMAIL_PASSWORD_DISABLED. The
  # `auth` instance binds NEXTAUTH_PROVIDER at module load, so exercising the
  # non-email branch would need an env override the singleton can't take in a
  # unit test (mirrors index.test.ts, which only asserts the live-env case).
  # Covered end-to-end by the cloud deployment; left unbound here.
  @regression @unimplemented
  Scenario: Password reset is rejected in cloud/SSO mode
    Given the tenant runs on NEXTAUTH_PROVIDER="auth0"
    When a request hits /request-password-reset or /reset-password
    Then BetterAuth rejects it with EMAIL_PASSWORD_DISABLED

  # --- Full end-to-end (manual dogfood) ---

  # Verified manually in the QA phase against a real database and a real
  # SendGrid send: request a reset for a seeded credential user, open the
  # emailed link, set a new password, and sign in with it. There is no
  # automated full-stack auth e2e harness with email interception in this
  # repo, so this stays @unimplemented and is proved via browser QA in the PR.
  @e2e @unimplemented
  Scenario: A user who forgot their password resets it and signs in with the new one
    Given a credential user who forgot their password
    When they request a reset, open the emailed link, and set a new password
    Then their old password no longer works
    And they can sign in with the new password
