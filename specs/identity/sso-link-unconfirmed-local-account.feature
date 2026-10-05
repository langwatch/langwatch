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
  # domain, and the assertion comes from the identity provider that
  # organization configured for it. An account on that domain that never
  # proved its inbox is then vouched for by the same domain owner, so linking
  # it does not hand one person's account to another. Without the proof the
  # link stays refused (ADR-027, no single sign-on account takeover).
  #
  # What the provider says about the address is read in three ways:
  # - verified: `email_verified: true`, or `xms_edov: true` from Microsoft
  #   Entra ID, which never sends `email_verified`.
  # - unverified: `email_verified: false`, or `xms_edov: false` from Entra ID.
  #   This refuses the link.
  # - nothing: no verification claim at all. This is how Entra ID signs every
  #   token unless the app registration requests `xms_edov`, and SAML has no
  #   such attribute, so every SAML provider says nothing.
  #
  # On a self-hosted installation "nothing" is enough to link, for OIDC and
  # SAML alike, onto confirmed and unconfirmed accounts. The domain proof
  # already ties the address to the organization, and the organization runs
  # both the identity provider and the installation: the only party that
  # could assert a wrong address on a proved domain is that organization's
  # own directory administrator. Requiring a claim the provider never sends
  # would refuse every Entra ID and SAML customer while adding no check, since
  # a provider that can send the claim decides its value itself. An explicit
  # "unverified" is the provider telling us something, so it still refuses.
  #
  # Self-hosted only. On LangWatch Cloud anybody may register a password
  # account, so a stranger could register victim@acme.com, never confirm it,
  # and wait for the domain to be verified; the link would then hand the
  # victim an account whose password the stranger knows. Cloud keeps
  # better-auth's own rule.

  Background:
    Given an organization with a single sign-on connection
    And a password account whose address was never confirmed, unless a scenario says otherwise

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
    When the administrator runs the test sign-in, whether or not the provider asserts the address is verified
    Then no single sign-on binding or session is created
    And the account's address stays unconfirmed
    And the refusal is sso_existing_account_unconfirmed

  @integration @regression
  Scenario: An identity provider that says the address is not verified does not link an unconfirmed account
    Given the connection is live and has verified the account's domain
    When the identity provider signs that address in and asserts it is not verified
    Then no single sign-on binding or session is created
    And the account's address stays unconfirmed
    And the refusal is sso_existing_account_unconfirmed

  @integration @regression
  Scenario: Microsoft Entra ID links an unconfirmed password account without sending email_verified
    Given the connection is live, its issuer is Microsoft Entra ID, and it has verified the account's domain
    When Entra ID signs that address in with no email_verified and no xms_edov claim
    Then the session belongs to the existing account
    And the account's address is marked confirmed
    And signing in again reuses the same single sign-on binding

  @integration @regression
  Scenario: Microsoft Entra ID's xms_edov true links an unconfirmed password account
    Given the connection's issuer is Microsoft Entra ID and it has verified the account's domain
    When Entra ID signs that address in with xms_edov true
    Then the session belongs to the existing account
    And the account's address is marked confirmed

  @integration @regression
  Scenario: Microsoft Entra ID's xms_edov false does not link an unconfirmed account
    Given the connection's issuer is Microsoft Entra ID and it has verified the account's domain
    When Entra ID signs that address in with xms_edov false
    Then no single sign-on binding or session is created
    And the account's address stays unconfirmed
    And the refusal is sso_existing_account_unconfirmed

  @integration @regression
  Scenario: A SAML connection links an unconfirmed password account on a verified domain
    Given the connection is a live SAML connection that has verified the account's domain
    When the identity provider signs that address in
    Then the session belongs to the existing account
    And the account's address is marked confirmed
    And no second account is created for that address

  @integration @regression
  Scenario: A confirmed password account links when the provider sends no email_verified
    Given a password account whose address is confirmed
    And the connection's issuer is Microsoft Entra ID and it has verified the account's domain
    When Entra ID signs that address in with no email_verified claim
    Then the session belongs to the existing account
    And no second account is created for that address

  @integration @regression
  Scenario: Microsoft Entra ID's xms_edov true links a confirmed account without a domain proof
    Given a password account whose address is confirmed
    And the connection has not verified the account's domain
    When Microsoft Entra ID signs that address in with xms_edov true
    Then the session belongs to the existing account
    And no second account is created for that address

  @integration @regression
  Scenario: A confirmed account on a domain the connection has not verified is refused with the missing proof named
    Given a password account whose address is confirmed
    And the connection has not verified the account's domain
    When a provider that sends no email_verified claim signs that address in
    Then the sign-in is refused with "sso_domain_not_verified"
    And the page says to verify the domain, not that the email is registered with another method
    And the account is left as it was

  @integration @regression
  Scenario: A deactivated or contested unconfirmed account is not linked
    Given the connection is live and has verified the account's domain
    And the account is deactivated, or another account holds a live identifier for the address or the subject
    When the identity provider signs that address in and asserts it is verified
    Then no single sign-on binding or session is created
    And the account's address stays unconfirmed

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
  Scenario: On LangWatch Cloud a provider that sends no email_verified does not link an existing account
    Given the installation is LangWatch Cloud
    And the connection's issuer is Microsoft Entra ID and it has verified the account's domain
    When Entra ID signs that address in with xms_edov true and no email_verified claim
    Then no single sign-on binding or session is created
    And the account's address stays unconfirmed
    And the refusal is better-auth's own account-not-linked refusal

  @integration @regression
  Scenario: The refusal reaches the sign-in screen with words the reader can act on
    When a sign-in is refused with sso_existing_account_unconfirmed
    Then the code crosses the sign-in redirect boundary as itself
    And the sign-in error screen explains that the account exists and how to get in
    And the single sign-on settings screen tells the administrator what to fix
