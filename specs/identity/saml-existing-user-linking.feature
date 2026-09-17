Feature: Signed SAML linking to an existing local account
  A managed connection's signed email assertion can link a locally verified address
  after the connection's domain or registrant checks admit that assertion.
  A SAML assertion does not need an OIDC email verification claim.

  @integration @regression
  Scenario: A signed SAML assertion links a verified local account
    Given a verified local account at the address asserted by a managed SAML connection
    When a valid signed SAML response passes the connection's assertion checks
    Then the session belongs to that same user
    And the local profile and verification remain unchanged
    And repeating sign-in reuses the same SAML account binding

  @integration @regression
  Scenario: A SAML account-link refusal is explained as a local sign-in failure
    When the provider setup test returns with an account-not-linked refusal
    Then the settings screen explains that LangWatch could not link the account
    And it asks the administrator to check the verified address and existing sign-in methods
    And it does not describe the refusal as an identity provider error

  @integration @regression
  Scenario: SAML linking refuses unsuitable local identity evidence
    Given an unverified, inactive, ambiguous, or conflicting local identity
    And an assertion may instead be outside the proved domain or have an invalid signature
    When the SAML provider attempts to sign the user in
    Then no new account binding or session is created
    And the local profile and verification remain unchanged
