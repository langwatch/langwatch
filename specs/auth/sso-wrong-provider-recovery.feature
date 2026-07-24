Feature: Recover from a wrong-provider sign-in without a redirect loop

  When someone whose account belongs to one sign-in method authenticates with a
  different method that shares the same email, linking is refused and they reach
  the sign-in error page. The error must be actionable and must not trap them
  bouncing between the app and the identity provider.

  Background:
    Given an organization with SSO enforced for domain "acme.com"
    And the organization's required sign-in method is its enterprise SSO provider
    And a user "andrei@acme.com" whose account is linked to that SSO provider

  Scenario: Signing in with the wrong method explains what to do and names the right method
    When the user completes an OAuth sign-in with a different method for the same email
    Then linking is refused and they land on the sign-in error page
    And the page explains an account already exists under a different sign-in method
    And the page tells them to sign in with their organization's required method
    And the page does not tell SSO-enforced users to link the method in settings

  Scenario: The error page does not auto-redirect back to the identity provider
    Given the user is on the "account already exists" sign-in error page
    Then they remain on that page
    And they are not automatically redirected back to the identity provider

  Scenario: Recovery signs the user out of the identity provider before trying again
    Given the user is on the "account already exists" sign-in error page
    When they choose to sign out and try again
    Then their identity-provider session is cleared, not only the app session
    And they return to the sign-in screen able to choose a different method

  Scenario: A blocked returning user is not trapped bouncing between the app and the IdP
    Given the user's only live identity-provider session authenticates an identity that cannot sign in
    When they open a protected page
    Then they are not repeatedly redirected between the app and the identity provider
    And they reach a stable error page with a clear recovery action

  Scenario: Recovery works the same when the org's required method is not yet known
    Given a user whose email domain is not mapped to an SSO-enforced organization
    When they hit the same wrong-method sign-in error
    Then the page still offers to sign out of the identity provider and try again
    And the guidance falls back to signing in with the method used originally
