Feature: Single sign-on links an unconfirmed local account on a verified domain, self-hosted only
  As an administrator of a self-hosted installation that does not send email
  I need my existing password account, and my colleagues', to sign in through
  our identity provider
  So that the test sign-in works and nobody is locked out after go-live

  # On an installation with no mailer, a password sign-up can never confirm its
  # address, so the account stays at emailVerified=false. better-auth only
  # links a single sign-on identity onto an existing account whose address is
  # confirmed, so every such account was refused with "account not linked",
  # including the administrator running the setup test sign-in.
  #
  # A verified domain is what authorizes the link. The connection has proved,
  # by DNS, an HTTPS file or the licence, that the organization controls the
  # domain, and the identity provider for that domain asserts the address is
  # verified. An account on that domain that never proved its inbox is then
  # vouched for by the same domain owner, so linking it does not hand one
  # person's account to another. Without both halves the link stays refused
  # (ADR-027, no single sign-on account takeover).
  #
  # Self-hosted only. On LangWatch Cloud anybody may register a password
  # account, so a stranger could register victim@acme.com, never confirm it,
  # and wait for the domain to be verified; the link would then hand the
  # victim an account whose password the stranger knows. Cloud keeps
  # better-auth's own rule.

  Background:
    Given an organization with an OIDC single sign-on connection
    And a password account whose address was never confirmed

  @integration @regression
  Scenario: A verified domain's identity provider links an unconfirmed password account
    Given the connection is live and has verified the account's domain
    When the identity provider signs that address in and asserts it is verified
    Then the session belongs to the existing account
    And the account's address is marked confirmed
    And no second account is created for that address
    And signing in again reuses the same single sign-on binding

  @integration @regression
  Scenario: The setup test sign-in links the registrant's unconfirmed password account
    Given the connection is still being set up and has verified the account's domain by licence
    And the account belongs to the administrator who registered the connection
    When the administrator runs the test sign-in and the identity provider asserts the address is verified
    Then the session belongs to the administrator's existing account
    And the account's address is marked confirmed

  @integration @regression
  Scenario: An unconfirmed account on a domain the connection has not verified is not linked
    Given the connection is still being set up and has not verified the account's domain
    And the account belongs to the administrator who registered the connection
    When the administrator runs the test sign-in
    Then no single sign-on binding or session is created
    And the account's address stays unconfirmed
    And the refusal is sso_existing_account_unconfirmed

  @integration @regression
  Scenario: An identity provider that does not vouch for the address does not link an unconfirmed account
    Given the connection is live and has verified the account's domain
    When the identity provider signs that address in without asserting it is verified
    Then no single sign-on binding or session is created
    And the account's address stays unconfirmed
    And the refusal is sso_existing_account_unconfirmed

  @integration @regression
  Scenario: A person already bound to the connection keeps signing in with an unconfirmed address
    Given the account already holds this connection's single sign-on binding
    And its address is still unconfirmed
    When the identity provider signs them in again without asserting the address is verified, or before the domain is verified
    Then the session belongs to the existing account
    And no second binding is created

  @integration @regression
  Scenario: On LangWatch Cloud an unconfirmed password account is not linked by single sign-on
    Given the installation is LangWatch Cloud
    And the connection is live and has verified the account's domain
    When the identity provider signs that address in and asserts it is verified
    Then no single sign-on binding or session is created
    And the account's address stays unconfirmed
    And the refusal is better-auth's own account-not-linked refusal

  @integration @regression
  Scenario: The refusal reaches the sign-in screen with words the reader can act on
    When a sign-in is refused with sso_existing_account_unconfirmed
    Then the code crosses the sign-in redirect boundary as itself
    And the sign-in error screen explains that the account exists and how to get in
    And the single sign-on settings screen tells the administrator what to fix
