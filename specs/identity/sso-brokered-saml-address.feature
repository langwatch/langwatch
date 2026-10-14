Feature: A SAML address asserted through the deployment's broker counts as verified only on a proved domain

  As the organizations that sign in through LangWatch's Auth0 broker
  We want an address our own SAML connection asserts to count as verified
  So that existing accounts at our domain link on their first SAML sign-in, and nobody else's do

  # ADR-096 (v3). Auth0 reports every SAML address unverified. A `samlp|<connection>|<id>` subject
  # counts as verified only when the organization that proved the address's domain holds a live
  # legacy route whose pin names that connection. Identity answers (`SsoAssertionApi`
  # `isBrokeredAddressProved`); the sso module's broker profile mapper asks it.

  @unit
  Scenario: A brokered SAML address on the pinning organization's proved domain is verified
    Given an organization whose live legacy route pins the broker connection "samlp|acme"
    And that organization proved "acme.com", by its legacy import or by its own connection
    When the broker asserts "alice@acme.com" for subject "samlp|acme|alice"
    Then the address counts as verified

  @unit
  Scenario: A brokered SAML address on another organization's domain is not verified
    Given the broker connection "samlp|acme" is pinned by one organization
    And "globex.com" is proved by a different organization
    When the broker asserts "bob@globex.com" for subject "samlp|acme|bob"
    Then the address does not count as verified

  @unit
  Scenario: A brokered SAML address on a domain nobody proved is not verified
    Given no organization proved "unclaimed.example"
    When the broker asserts "carol@unclaimed.example" for a SAML subject
    Then the address does not count as verified

  @unit
  Scenario: A brokered SAML subject from a connection the organization does not pin is not verified
    Given an organization pins "samlp|acme" and proved "acme.com"
    When the broker asserts "dan@acme.com" for subject "samlp|acme-two|dan"
    Then the address does not count as verified

  @unit
  Scenario: A pin naming only the broker or the SAML strategy verifies nobody
    Given an organization's legacy route pins "auth0" or "samlp" rather than one connection
    When the broker asserts an address on its proved domain for a SAML subject
    Then the address does not count as verified

  @unit
  Scenario: A lapsed domain proof or a legacy route that is no longer live verifies nobody
    Given the domain's proof lapsed, or the pinning legacy route is suspended
    When the broker asserts an address on that domain for the pinned connection's subject
    Then the address does not count as verified

  @unit
  Scenario: A brokered SAML subject with no address or no answer from identity is not verified
    Given the SAML profile carries no address, or no identity answer is composed
    When the broker profile is mapped
    Then the address does not count as verified, and identity is not asked without an address

  @unit
  Scenario: Profiles from the broker's other connections keep their own verification claim
    Given a broker subject from a database, social or enterprise OIDC connection
    When the broker profile is mapped
    Then the mapping states no verification of its own and identity is not asked
