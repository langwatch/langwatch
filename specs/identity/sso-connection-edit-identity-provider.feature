Feature: Editing an existing SSO connection's identity provider settings
  As an organization administrator
  I need to correct the identity provider settings of a connection I registered
  So that a wrong issuer or a rotated client secret does not force me to delete
  the connection and register it again, which changes the redirect address I
  already gave my identity provider

  # A customer report: an Entra ID connection was registered with a wrong
  # issuer, and the only fix was deleting it. The new connection had a new id,
  # and the redirect address `/api/auth/sso/callback/<connection id>` changed
  # with it, so the app registration in Entra had to be edited too.
  #
  # Editing replaces what the engine dials (OpenID Connect: issuer, client id,
  # client secret; SAML: sign-in address, metadata, entity id, certificate) on
  # the same connection id. The name is a separate fact (rename). The
  # protocol cannot change: the service provider details the administrator
  # copied depend on it.
  #
  # States: every setup state (DRAFT, CLAIMED, APPROVED, REJECTED,
  # VERIFICATION_PENDING, VERIFIED) and the live pair (ACTIVE, SUSPENDED). A
  # wrong issuer on a live connection is the main case. Not TEARDOWN_PENDING,
  # DISCARDED or TORN_DOWN. Grandfathered connections have no settings of
  # their own and are refused.
  #
  # The new settings are checked exactly as at registration (discovery,
  # issuer canonicalisation, metadata) before anything is stored. A refusal
  # uses the registration's named errors and changes nothing.

  Background:
    Given an organization with a registered OpenID Connect connection

  @unit
  Scenario: Editing the identity provider keeps the connection id and redirect address
    When an administrator changes the issuer, client id and client secret
    Then the connection dials the new issuer with the new credentials
    And its connection id is unchanged
    And its redirect address is unchanged
    And its domains, their proofs and who it admits are unchanged
    And its name is unchanged

  @unit
  Scenario: A blank client secret keeps the stored secret
    When an administrator changes the issuer and leaves the client secret blank
    Then the connection keeps the client secret it had

  @unit
  Scenario: Saving unchanged settings records nothing
    When an administrator saves the settings the connection already has
    Then nothing is recorded

  @unit
  Scenario: A live connection can be edited
    Given the connection is live
    When an administrator changes the issuer
    Then the connection dials the new issuer

  @unit
  Scenario: An issuer that fails discovery is refused and nothing changes
    When an administrator saves an issuer whose discovery document names another issuer
    Then the change is refused with the issuer mismatch error
    And no credential is stored
    And the connection keeps the settings it had

  @unit
  Scenario: The protocol cannot change on an existing connection
    When an administrator sends SAML settings for the OpenID Connect connection
    Then the change is refused
    And the connection keeps the settings it had

  @unit
  Scenario: A connection being removed cannot be edited
    Given the connection's removal has been requested
    When an administrator changes the issuer
    Then the change is refused
    And no credential is stored for the refused settings

  @unit
  Scenario: A new issuer needs a new test sign-in before going live
    Given a test sign-in went through the connection's old issuer
    When an administrator changes the issuer
    Then going live waits for a test sign-in through the new issuer

  @unit
  Scenario: Only an administrator who may manage single sign-on can edit
    Given a member who may only view single sign-on settings
    When they try to change the identity provider settings
    Then the change is refused

  @unit
  Scenario: The change is on the connection's history
    Given an administrator has changed the identity provider settings
    When the connection's history is read
    Then it says the identity provider settings were changed and names the new issuer

  @integration
  Scenario: The settings card offers the edit prefilled with the current settings
    Given an administrator viewing the connection's card
    When they choose to edit the identity provider settings
    Then the form shows the current issuer and client id
    And the client secret is blank, with a note that blank keeps the current secret
    And saving sends the changed settings for the same connection
