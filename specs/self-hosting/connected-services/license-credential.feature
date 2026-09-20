Feature: The license is the credential for hosted services
  A connected self-hosted install authenticates to LangWatch-hosted services
  with a token derived from the license it already holds, plus its instance id.
  There is no second key to issue, store or rotate, and the license key itself
  never travels.

  The gateway accepts this token next to a virtual key. It resolves to a managed
  key on the customer organization, so budgets, spend and revocation work the
  way they do for any other gateway traffic.

  As the operator of a connected self-hosted install
  I want my license to be all I need to reach hosted services
  So that I have no extra secret to manage

  Background:
    Given LangWatch Cloud with the gateway running
    And customer organization "ACME" with an active registered license entitled to "instant_evals"

  # ============================================================================
  # Golden path
  # ============================================================================

  @integration
  Scenario: A registered license resolves to the customer's managed key
    When the install calls the gateway with its license token and its instance id
    Then the call is accepted
    And it is attributed to organization "ACME"

  @unit
  Scenario: The managed key is created on first use and reused after
    Given "ACME" has never called a hosted service
    When its license token is resolved twice
    Then one managed key for that license exists on "ACME"
    And both resolutions return that key

  @unit
  Scenario: Each license gets its own managed key
    Given "ACME" holds two active licenses for two installs
    When each install calls a hosted service
    Then the spend of each install is recorded under its own managed key
    And both count against the one budget of "ACME"

  @integration
  Scenario: The managed key is not visible or editable as a customer key
    When an admin of "ACME" lists the organization's virtual keys
    Then the managed key for hosted services is not in the list
    And a customer request to revoke it is refused

  @integration
  Scenario: A license token reaches none of the customer's own model providers
    Given "ACME" has a model provider of its own on LangWatch Cloud
    When the gateway builds the configuration of the license's managed key
    Then it holds none of the customer's provider credentials

  @integration
  Scenario: A virtual key keeps working next to the license token
    Given a Cloud project with a virtual key
    When a call arrives with that virtual key
    Then it is accepted exactly as before

  # ============================================================================
  # Instance binding
  # ============================================================================

  @unit
  Scenario: The first instance to present a license is bound to it
    Given the license has no instance bound
    When the install presents the license token with instance id "instance-a"
    Then the license is bound to "instance-a"

  @unit
  Scenario: Two instances racing to bind leave exactly one bound
    Given the license has no instance bound
    When "instance-a" and "instance-b" present the license token at the same moment
    Then exactly one of them is bound
    And the other is refused as the wrong instance

  @unit
  Scenario: A license token replayed from another instance is refused
    Given the license is bound to "instance-a"
    When a call presents the same license token with instance id "instance-b"
    Then the call is refused with code "connect_wrong_instance"
    And the binding is unchanged

  @unit
  Scenario: A license token with no instance id is refused
    When a call presents a license token without an instance id
    Then the call is refused with code "connect_instance_required"

  # ============================================================================
  # Named refusals
  # ============================================================================

  @unit
  Scenario: An unregistered license is refused
    When a call presents a license token that is not in the registry
    Then the call is refused with code "connect_license_not_registered"

  @unit
  Scenario: A revoked license is refused
    Given the license has been revoked
    When the install presents its license token
    Then the call is refused with code "connect_license_revoked"

  @unit
  Scenario: An expired license is refused
    Given the license term has ended
    When the install presents its license token
    Then the call is refused with code "connect_license_expired"

  @unit
  Scenario: A malformed license token is refused before any lookup
    When a call presents a token that starts with the license prefix but is not 64 hex characters
    Then the call is refused as an invalid credential
    And the registry is not queried

  @unit
  Scenario: A license that stops being active mid-call issues no credential
    Given the license has no managed key yet
    When it is revoked or its term ends after the call read its status and before its managed key is attached
    Then the call is refused with the code for the state the license is now in
    And no managed key is left active on the customer

  @integration
  Scenario: The managed key is recorded only while the license still admits the call
    Given the license was revoked after the call read its status
    When the managed key is recorded against it
    Then the table refuses the write
    And the license still has no managed key

  @unit
  Scenario: A managed key that fails to attach is ended
    Given the license has no managed key yet
    When recording the managed key on the license fails
    Then the error reaches the caller
    And the key that was created for it is ended

  @integration
  Scenario: Refusals do not reveal whether a license exists
    When calls present an unregistered token, a revoked token and a token bound to another instance
    Then none of the responses includes the customer name, the seats or the term

  # ============================================================================
  # Revocation reaches a gateway that already cached the credential
  # ============================================================================

  @unit
  Scenario: Revoking a license revokes its managed key
    Given the gateway has resolved and cached the license token
    When the license is revoked
    Then its managed key is revoked in the same change
    And the gateway is told to drop the cached credential

  @unit
  Scenario: A gateway that cached a revoked license refuses it on the next change poll
    Given the gateway has resolved and cached the license token
    When the license is revoked
    Then the gateway refuses the token after its next change poll

  @unit
  Scenario: Repeated unknown license tokens do not reach the registry every time
    When the same unregistered license token is presented many times in a short window
    Then the gateway answers from its negative cache after the first lookup
    And virtual keys are resolved exactly as before

  @unit
  Scenario: A cached credential is never served to another instance
    Given the gateway has cached the license token for "instance-a"
    When a call presents the same license token with instance id "instance-b"
    Then the cached credential is not used
    And the call is checked against the registry
