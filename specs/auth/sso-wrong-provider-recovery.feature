Feature: Recover from a wrong-provider sign-in without a redirect loop

  When someone whose account belongs to one sign-in method authenticates with a
  different method that shares the same email, linking is refused and they reach
  the sign-in error page. The error must be actionable and must not trap them
  bouncing between the app and the identity provider.

  # Ported at D04 (ADR-117 §5): what OWNS "acme.com routes to an identity
  # provider" is an SsoConnection now, not two strings on the organization.
  # The scenarios below are unchanged in substance because the recovery is
  # the same on both sides of the flip - it is about what the error page
  # says and does, and the page reads a routing decision either way. Which
  # store answered that decision is SSOCONN_ROUTING's business
  # (specs/identity/sso-connection-lifecycle.feature owns and binds it).
  # Nothing here retires at the flip.

  Background:
    Given an organization whose ACTIVE SSO connection has verified the domain "acme.com"
    And the organization's required sign-in method is that connection's identity provider
    And a user "andrei@acme.com" whose account is linked to that connection

  @integration
  Scenario: Signing in with the wrong method explains what to do and names the right method
    When the user completes an OAuth sign-in with a different method for the same email
    Then linking is refused and they land on the sign-in error page
    And the page explains an account already exists under a different sign-in method
    And the page tells them to sign in with their organization's required method
    And the page does not tell SSO-enforced users to link the method in settings

  @integration
  Scenario: The error page does not auto-redirect back to the identity provider
    Given the user is on the "account already exists" sign-in error page
    Then they remain on that page
    And they are not automatically redirected back to the identity provider

  @integration
  Scenario: Recovery signs the user out of the identity provider before trying again
    Given the user is on the "account already exists" sign-in error page
    When they choose to sign out and try again
    Then their identity-provider session is cleared, not only the app session
    And they return to the sign-in screen able to choose a different method

  @integration
  Scenario: A blocked returning user is not trapped bouncing between the app and the IdP
    Given the user's only live identity-provider session authenticates an identity that cannot sign in
    When they open a protected page
    Then they are not repeatedly redirected between the app and the identity provider
    And they reach a stable error page with a clear recovery action

  @integration
  Scenario: Recovery works the same when the org's required method is not yet known
    Given a user whose email domain no ACTIVE connection has verified
    When they hit the same wrong-method sign-in error
    Then the page still offers to sign out of the identity provider and try again
    And the guidance falls back to signing in with the method used originally

  # A member can be left carrying a stale "you still need to link SSO" flag:
  # it is set at sign-in and only ever cleared by a LATER sign-in that
  # happens to match the organization's required method. The dashboard
  # banner used to point that member at settings, which has nothing for them
  # to click (an SSO-enforced organization offers no connectable providers
  # there) — a dead end for exactly the people it targets.

  @integration
  Scenario: A member who already signs in through single sign-on is not asked to link again
    Given a member whose account still carries a stale "needs to link SSO" flag
    And the member already holds a sign-in that matches their organization's required method
    When they open the dashboard
    Then they are not shown a banner asking them to link their account

  @integration
  Scenario: A member still on the wrong sign-in is told to sign out and use their work email
    Given a member whose account still carries a stale "needs to link SSO" flag
    And the member holds no sign-in that matches their organization's required method
    When they open the dashboard
    Then they see a banner telling them to sign out and sign in again with their work email address
    And the banner offers a sign-out action
    And the banner does not link to the settings page

  @unit
  Scenario: A member is not asked to link a sign-in method their organization no longer requires
    Given a member whose account still carries a stale "needs to link SSO" flag
    And their organization has since stopped requiring a sign-in method
    When their sign-in status is read
    Then it reports nothing left to link

  # A stale flag can also be cleared in bulk, ahead of the member's next
  # sign-in, so nobody has to wait on a sign-in that may never happen to fire
  # the clearing branch above.

  @unit
  Scenario: A one-off cleanup clears the reminder for members who already sign in the right way
    Given a member whose account still carries a stale "needs to link SSO" flag
    And the member already holds a sign-in that matches their organization's required method
    When the one-off cleanup runs
    Then the member's stale flag is cleared

  @unit
  Scenario: The cleanup leaves the reminder for members who have not yet signed in the right way
    Given a member whose account still carries a stale "needs to link SSO" flag
    And the member holds no sign-in that matches their organization's required method
    When the one-off cleanup runs
    Then the member's flag is left in place
