Feature: An administrator changing someone's email ends that person's sessions
  As an operator or an identity provider changing a member's email address
  I want their existing browser sessions to stop working
  So that whoever still holds a session on the old address cannot keep it

  # A password reset already does this (specs/auth/password-reset.feature). An
  # email change is the same class of event and had no spec of its own: the
  # address is the sign-in identifier, so leaving old sessions alive means the
  # previous holder of that mailbox keeps a working session after the account
  # has been handed to someone else — during an offboarding, or a directory
  # correction, exactly when it matters.
  #
  # Two transports change an email without the member present, and neither goes
  # through the sign-in flow that would otherwise re-establish the session:
  #
  #   * SCIM — an identity provider replaces (PUT) or patches (PATCH) the
  #     `userName`, which is the email.
  #   * The Ops backoffice — an operator edits the user directly.
  #
  # Both call the User service to write, then the Auth service to revoke. That
  # is a cross-feature orchestration living at the transport rather than inside
  # User, so it is stated here rather than assumed from either feature's own
  # behaviour.

  Rule: The revocation follows the write, and only when the address really moved

    The order matters in one direction only. Revoking first would log the
    member out and then, if the write failed, leave them locked out of an
    account whose address never changed. Writing first means the worst case is
    a changed address with sessions still alive, which the next rule covers.

    @unit
    Scenario: SCIM replacing a user's email revokes their browser sessions
      Given a directory-managed member with a live browser session
      When SCIM replaces their userName with a different address
      Then the profile is written first
      And every browser session for that member is revoked afterwards

    @unit
    Scenario: SCIM patching a user's email revokes their browser sessions
      Given a directory-managed member with a live browser session
      When SCIM patches their userName to a different address
      Then the profile is written first
      And every browser session for that member is revoked afterwards

    @unit
    Scenario: An operator changing a user's email revokes their browser sessions
      Given a member with a live browser session
      When an operator changes their email in the backoffice
      Then the profile is written first
      And every browser session for that member is revoked afterwards

    @unit
    Scenario: A change that only differs in case or spacing revokes nothing
      Given a member whose stored email is alice@example.com
      When an operator submits " ALICE@EXAMPLE.COM " for that member
      Then the address is unchanged once normalised
      And no browser session is revoked

  Rule: A revocation that fails does not undo the write

    Session revocation reaches a separate store, so it can fail on its own.
    When it does, the caller is told — the write is not quietly reported as a
    complete email change — but the new address stays written. Rolling the
    address back would leave the directory and LangWatch disagreeing about who
    the member is, which is worse than a session that outlives its address and
    is visible in the failure the caller receives.

    @unit
    Scenario: A failed revocation still leaves the new SCIM email in place
      Given SCIM has replaced a member's email
      When revoking their browser sessions fails
      Then the caller is told the operation failed
      And the member's new email remains written

    @unit
    Scenario: A failed revocation still leaves the new backoffice email in place
      Given an operator has changed a member's email
      When revoking their browser sessions fails
      Then the caller is told the operation failed
      And the member's new email remains written
