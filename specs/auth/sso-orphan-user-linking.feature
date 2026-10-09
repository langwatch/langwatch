Feature: SSO sign-in links to orphan email-verified User rows

  # WHAT DECIDES THIS, and why the binding sits where it does.
  #
  # No code of ours implements the rule these scenarios describe. Linking is
  # ENABLED in `better-auth/config/models.ts` on purpose — without it an
  # invited person whose User row predates their first sign-in is locked out
  # of their own account — and what keeps that setting from being a hijack is
  # better-auth's own refusal to link into a row whose `emailVerified` is
  # false. A library default is a thin thing to rest a security property on,
  # so the first two scenarios bind to the real callback rather than to our
  # configuration of it: a local identity provider, real RS256, real
  # better-auth, and an orphan row seeded either way.
  #
  # The third is ours, and binds to the hook that enforces it.

  Background:
    Given an organization with SSO enforced for domain "example.com"
    And the organization's SSO provider matches the OAuth provider configured for the deployment

  @integration
  Scenario: Orphan User row from a prior invite is auto-linked on first SSO sign-in
    Given a User row exists for "alice@example.com" with emailVerified=true and zero linked Account rows
    When Alice completes the SSO sign-in callback with the configured OAuth provider
    Then a new Account row is created for that User
    And Alice is signed in
    And no "registered with another authentication method" error is shown

  @integration
  Scenario: Unverified orphan User cannot be hijacked via OAuth
    Given a User row exists for "bob@example.com" with emailVerified=false and zero linked Account rows
    When an OAuth sign-in callback returns email "bob@example.com"
    Then linking is refused
    And the OAuth callback redirects to the auth error page

  @unit
  Scenario: SSO-domain guard still blocks the wrong provider
    Given a User row exists for "carol@example.com" with emailVerified=true and zero linked Account rows
    And the organization's SSO provider is "waad|tenant" but the OAuth callback comes from a different provider
    When the OAuth callback completes
    Then sign-in is rejected with SSO_PROVIDER_NOT_ALLOWED
    And no Account row is created
