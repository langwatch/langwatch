Feature: Single sign-on links an unconfirmed local account on a verified domain
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
  Scenario: A sign-up still waiting for its emailed confirmation is not linked
    Given the connection is live and has verified the account's domain
    And the account is a sign-up still waiting for its emailed confirmation
    When the identity provider signs that address in and asserts it is verified
    Then no single sign-on binding or session is created
    And the refusal is sso_existing_account_unconfirmed

  @integration @regression
  Scenario: The refusal reaches the sign-in screen with words the reader can act on
    When a sign-in is refused with sso_existing_account_unconfirmed
    Then the code crosses the sign-in redirect boundary as itself
    And the sign-in error screen explains that the account exists and how to get in
    And the single sign-on settings screen tells the administrator what to fix
