Feature: Restricting who can sign up on a self-hosted installation
  As the operator of a self-hosted LangWatch
  I want to decide who can create an account and who can create an organization
  So that a stranger who can reach the installation cannot register and make themselves an admin

  # Two settings, both off by default so an installation that sets neither
  # behaves as it always has:
  #
  #   SIGN_UP_MODE=open|invite_only   (Helm: app.signUp.mode)
  #   SIGN_UP_ALLOWED_DOMAINS=a.com,b.com   (Helm: app.signUp.allowedDomains)
  #
  # ADMIN_EMAILS is how the first administrator of an invite-only installation
  # gets in. With ADMIN_EMAILS empty, the very first account on an installation
  # with no users is admitted so the installation can still be bootstrapped.
  #
  # SCIM provisioning and an organization's own SSO connection are the
  # organization's decision, not a self sign-up, and are not restricted here.

  Background:
    Given a self-hosted installation

  @unit
  Scenario: Open sign-up admits anybody
    Given SIGN_UP_MODE is "open" and no allowed domains are set
    When "sam@acme.com" signs up
    Then the account can be created

  @unit
  Scenario: Invite-only refuses an address with no invitation
    Given SIGN_UP_MODE is "invite_only"
    And the installation already has users
    When "stranger@example.com" signs up without an invitation
    Then the sign-up is refused with "auth_sign_up_restricted"

  @unit
  Scenario: Invite-only admits an address holding a pending invitation
    Given SIGN_UP_MODE is "invite_only"
    And "sam@acme.com" holds a pending invitation to an organization
    When "sam@acme.com" signs up
    Then the account can be created

  @unit
  Scenario: An address in ADMIN_EMAILS can always sign up
    Given SIGN_UP_MODE is "invite_only"
    And ADMIN_EMAILS lists "ops@acme.com"
    When "ops@acme.com" signs up
    Then the account can be created

  @unit
  Scenario: The first account on an empty installation is admitted when ADMIN_EMAILS is empty
    Given SIGN_UP_MODE is "invite_only"
    And ADMIN_EMAILS is empty
    And the installation has no users
    When "founder@acme.com" signs up
    Then the account can be created

  @unit
  Scenario: Setting ADMIN_EMAILS closes the first-account window
    Given SIGN_UP_MODE is "invite_only"
    And ADMIN_EMAILS lists "ops@acme.com"
    And the installation has no users
    When "stranger@example.com" signs up
    Then the sign-up is refused with "auth_sign_up_restricted"

  @unit
  Scenario: An address outside the allowed domains is refused
    Given SIGN_UP_ALLOWED_DOMAINS is "acme.com"
    When "stranger@example.com" signs up
    Then the sign-up is refused with "auth_sign_up_restricted"

  @unit
  Scenario: An invited address outside the allowed domains is admitted
    Given SIGN_UP_ALLOWED_DOMAINS is "acme.com"
    And "contractor@example.com" holds a pending invitation to an organization
    When "contractor@example.com" signs up
    Then the account can be created

  @unit
  Scenario: A refused registration spends no address proof and writes no account
    Given the sign-up policy refuses "stranger@example.com"
    When "stranger@example.com" submits the registration form
    Then the registration is refused with "auth_sign_up_restricted"
    And the address proof is not spent
    And no account is written

  @unit
  Scenario: A refused sign-up is told before a confirmation link is sent
    Given the sign-up policy refuses "stranger@example.com"
    When "stranger@example.com" asks for a sign-up confirmation link
    Then the request is refused with "auth_sign_up_restricted"
    And no confirmation email is sent

  @unit
  Scenario: An identity provider sign-in for an uninvited address creates no account
    Given SIGN_UP_MODE is "invite_only"
    When "stranger@example.com" signs in through an identity provider for the first time
    Then no account is created
    And the sign-in error page shows "auth_sign_up_restricted"

  @unit
  Scenario: An address an organization's own SSO connection governs is not restricted
    Given SIGN_UP_MODE is "invite_only"
    And an organization's SSO connection governs "acme.com"
    When "sam@acme.com" signs in through that connection for the first time
    Then the account can be created

  @unit
  Scenario: Invite-only stops a member founding an organization
    Given SIGN_UP_MODE is "invite_only"
    And the installation already has an organization
    When a signed-in member who is not an instance administrator creates an organization
    Then it is refused with "organization_creation_restricted"
    And no organization is created

  @unit
  Scenario: An instance administrator can create an organization on an invite-only installation
    Given SIGN_UP_MODE is "invite_only"
    And ADMIN_EMAILS lists "ops@acme.com"
    When "ops@acme.com" creates an organization
    Then the organization is created

  @unit
  Scenario: The first organization on an invite-only installation can be created
    Given SIGN_UP_MODE is "invite_only"
    And the installation has no organizations
    When the first account creates an organization
    Then the organization is created

  @unit
  Scenario: The sign-in screen learns the installation is invite-only
    Given SIGN_UP_MODE is "invite_only"
    When the browser reads the public configuration
    Then it is told the sign-up mode is "invite_only"
    And the sign-in screen hides its "create an account" links

  @unit
  Scenario: The Helm chart renders the sign-up settings
    Given app.signUp.mode is "invite_only"
    And app.signUp.allowedDomains lists "acme.com" and "acme.io"
    When the chart is rendered
    Then the app receives SIGN_UP_MODE "invite_only"
    And the app receives SIGN_UP_ALLOWED_DOMAINS "acme.com,acme.io"
