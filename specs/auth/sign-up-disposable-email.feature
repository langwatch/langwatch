Feature: Sign-up refuses disposable email addresses
  As the operator of a LangWatch installation
  I want a new account to need a permanent email address
  So that accounts are not made in bulk from throwaway inboxes

  # One setting, SIGN_UP_DISPOSABLE_EMAILS=refuse|allow. Unset, LangWatch Cloud
  # refuses and a self-hosted installation allows. The domain list is a vendored
  # copy of the community-maintained disposable-email-domains list.
  #
  # The check belongs to the sign-up policy, so every door that creates an
  # account asks it: the confirmation link, the registration form, a passkey
  # sign-up and a first sign-in through an identity provider. It is asked of a
  # new address only, so an existing account is never affected.

  @unit
  Scenario: A new address on a disposable email domain is refused
    Given the installation refuses disposable email addresses
    When "sam@euploading.com" signs up
    Then the sign-up is refused as a disposable address

  @unit
  Scenario: A new address on a permanent email domain is admitted
    Given the installation refuses disposable email addresses
    When "sam@acme.com" signs up
    Then the sign-up policy admits it without reading anything

  @unit
  Scenario: A disposable domain is refused whatever its case and on any subdomain
    Given the installation refuses disposable email addresses
    When "Sam@EUploading.COM" or "sam@mx.euploading.com" signs up
    Then the sign-up is refused as a disposable address
    But "sam@noteuploading.com" is admitted

  @unit
  Scenario: An invited address on a disposable domain is admitted
    Given the installation refuses disposable email addresses
    And "contractor@euploading.com" holds a pending invitation to an organization
    When "contractor@euploading.com" signs up
    Then the account can be created

  @unit
  Scenario: An address in ADMIN_EMAILS on a disposable domain is admitted
    Given the installation refuses disposable email addresses
    And ADMIN_EMAILS names "ops@euploading.com"
    When "ops@euploading.com" signs up
    Then the account can be created

  @unit
  Scenario: A disposable domain listed in SIGN_UP_ALLOWED_DOMAINS is admitted
    Given the installation refuses disposable email addresses
    And SIGN_UP_ALLOWED_DOMAINS lists "euploading.com"
    When "sam@euploading.com" signs up
    Then the account can be created

  @unit
  Scenario: The first account on an empty invite-only installation is refused on a disposable domain
    Given SIGN_UP_MODE is "invite_only" and ADMIN_EMAILS is empty
    And the installation refuses disposable email addresses
    And the installation has no accounts yet
    When "founder@euploading.com" signs up
    Then the sign-up is refused as a disposable address
    But "founder@acme.com" is admitted as the first account

  @unit
  Scenario: An installation that allows disposable addresses admits them
    Given SIGN_UP_DISPOSABLE_EMAILS is "allow"
    When "sam@euploading.com" signs up
    Then the account can be created

  @unit
  Scenario: The cloud refuses disposable addresses and a self-hosted installation allows them by default
    Given SIGN_UP_DISPOSABLE_EMAILS is unset
    Then LangWatch Cloud refuses disposable addresses
    And a self-hosted installation allows them
    And either one follows SIGN_UP_DISPOSABLE_EMAILS when it is set

  @unit
  Scenario: A disposable address is refused before a confirmation link is sent
    Given the sign-up policy refuses "sam@euploading.com" as a disposable address
    When "sam@euploading.com" asks for a sign-up confirmation link
    Then the request is refused with "auth_sign_up_disposable_email"
    And no confirmation email is sent

  @unit
  Scenario: A disposable address submitting the registration form writes no account
    Given the sign-up policy refuses "sam@euploading.com" as a disposable address
    When "sam@euploading.com" submits the registration form
    Then the registration is refused with "auth_sign_up_disposable_email"
    And the address proof is not spent

  @unit
  Scenario: A first sign-in through an identity provider from a disposable address creates no account
    Given the sign-up policy refuses "sam@euploading.com" as a disposable address
    When "sam@euploading.com" signs in through an identity provider for the first time
    Then no account is created
    And the sign-in error page shows "auth_sign_up_disposable_email"

  @unit
  Scenario: An existing account on a disposable domain is sent to sign in
    Given an account already holds "sam@euploading.com"
    And the sign-up policy would refuse that address as a disposable address
    When "sam@euploading.com" reaches the front door
    Then it is sent to sign in to its account
    And the sign-up policy is not asked

  @integration
  Scenario: A refusal after the address is confirmed does not say the address is confirmed
    Given "sam@euploading.com" opened its confirmation link
    And the sign-up policy now refuses that address as a disposable address
    When the sign-up screen shows the refusal
    Then it does not read "Your email is confirmed"

  @unit
  Scenario: The sign-up screen asks for a permanent email address
    Given the front door receives "auth_sign_up_disposable_email"
    When the sign-up screen renders the refusal
    Then it reads "Please use a permanent email address"
    And it does not read as a fault on the installation's side
