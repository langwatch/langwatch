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
  Scenario: The first SAML session stays revocable before projection catches up
    Given a signed SAML callback creates its account before its Identifier projection appears
    When the identifier projection catches up and the user signs in again
    And an operator ends that method's sessions
    Then the first and repeated sessions both stop authenticating
    And historical unattributed sessions are not guessed into that method

  @integration @regression
  Scenario: A fresh SAML callback adopts identity before its first session is used
    Given a signed SAML callback for an address with no User, Account, or Identifier
    When the production arrival hook admits the new user
    Then the identity pipeline creates the generated Identifier and persists D01 finalized
    And the first session records that generated Identifier while local email verification remains false
    And repeating sign-in keeps one account, membership, and migration record

  @integration @regression
  Scenario: Unprojected session attribution refuses uncertain account evidence
    Given the callback has no current transaction or no exact owned native account
    And the case may instead contain detached or conflicting identifier evidence
    When the session looks up its future identifier
    Then it does not borrow or revive an identifier

  @integration @regression
  Scenario: Repeated SAML sessions retain their exact sign-in method
    Given a SAML account already has its live identity projection
    When fresh signed callbacks mint sessions through the mounted SAML endpoint
    Then each session records that exact identifier
    And no unproved second-factor claim is credited
    And ending the method's sessions revokes those repeated sessions

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
