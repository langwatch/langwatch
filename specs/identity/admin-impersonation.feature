Feature: Who an administrator may borrow access from
  As the LangWatch platform
  I need every impersonation to be refused unless the target is an ordinary,
  live account
  So that the audit trail always names one real person acting as one other
  real person, and a revoked account stays revoked

  # Impersonation exists so support can see what a customer sees. That makes it
  # the most powerful thing the admin surface offers, and the reason it is worth
  # specifying is what it must NOT reach: another administrator, and an account
  # somebody deliberately shut off.
  #
  # The rest of the behaviour is specified elsewhere and inherited whole: the
  # claims an impersonated session carries and the second factor the operator
  # needs are specs/identity/mfa-and-session-shape.feature's; the banner and the
  # way out are specs/auth/impersonation-banner.feature's; the reason is
  # specs/features/backoffice-user-impersonation-reason.feature's.

  Background:
    Given an operator who may use the admin surface
    And a reason given for the impersonation

  # Two administrators who can step into each other leave an audit trail that
  # answers "who did this" with a chain, not a person — and one compromised
  # administrator becomes all of them. Whether the address that makes somebody
  # an administrator is the one on their account record or the one on their
  # identifier makes no difference: it is the address they sign in as that
  # decides, so the refusal reads it the same way the sign-in does.
  @unit
  Scenario: An administrator cannot impersonate another administrator
    Given the target is themselves an administrator
    When the operator tries to impersonate them
    Then the request is refused as not permitted, rather than failing
    And no impersonation window is opened
    And it is refused just the same when the target's administrator address is the one on their identifier

  # A deactivated account has had its sessions ended on purpose. An operator
  # walking back into it would undo that with one click.
  @unit
  Scenario: A deactivated account cannot be impersonated
    Given the target's account has been deactivated
    When the operator tries to impersonate them
    Then the request is refused
    And no impersonation window is opened

  # Impersonation is meant to be entered and left one subject at a time. An
  # operator already inside one who jumps straight to a second account leaves
  # the audit trail hopping subject→subject, never passing back through the
  # operator between hops — the same washing-out the admin-to-admin refusal
  # exists to prevent, reached another way. So the way to borrow a new account
  # is to stop the current impersonation first.
  @unit
  Scenario: An operator already impersonating cannot jump straight to another account
    Given the operator is already impersonating an account
    When they try to impersonate a different account without stopping first
    Then the request is refused as not permitted, telling them to stop first
    And no new impersonation window is opened

  @unit
  Scenario: An account that does not exist is not impersonated
    Given the target does not name anybody
    When the operator tries to impersonate them
    Then the request is refused as not found
    And no impersonation window is opened, and nothing is recorded as having happened

  # The refusals above are about who may be stepped into. This one is about
  # what may be done from inside the window: an operator sees what the subject
  # sees, but must never change how the subject signs in. Setting a first
  # password demands no proof at all, so without this an operator could mint a
  # durable credential on exactly the SSO-only and passkey-only accounts that
  # procedure exists for; changing one is refused for the same reason, its own
  # current-password proof notwithstanding.
  @unit
  Scenario: An impersonating operator cannot set or change a password
    Given the operator is impersonating an ordinary account
    When they try to set or change that account's password
    Then the request is refused as not available while impersonating
    And no credential is written on the account
