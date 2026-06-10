Feature: SSO sign-in links to orphan email-verified User rows

  Background:
    Given an organization with SSO enforced for domain "example.com"
    And the organization's SSO provider matches the OAuth provider configured for the deployment

  Scenario: Orphan User row from a prior invite is auto-linked on first SSO sign-in
    Given a User row exists for "alice@example.com" with emailVerified=true and zero linked Account rows
    When Alice completes the SSO sign-in callback with the configured OAuth provider
    Then a new Account row is created for that User
    And Alice is signed in
    And no "registered with another authentication method" error is shown

  Scenario: Unverified orphan User cannot be hijacked via OAuth
    Given a User row exists for "bob@example.com" with emailVerified=false and zero linked Account rows
    When an OAuth sign-in callback returns email "bob@example.com"
    Then linking is refused
    And the OAuth callback redirects to the auth error page

  Scenario: SSO-domain guard still blocks the wrong provider
    Given a User row exists for "carol@example.com" with emailVerified=true and zero linked Account rows
    And the organization's SSO provider is "waad|tenant" but the OAuth callback comes from a different provider
    When the OAuth callback completes
    Then sign-in is rejected with SSO_PROVIDER_NOT_ALLOWED
    And no Account row is created
