@wip @unit
Feature: RSA License Validation
  As a LangWatch self-hosted administrator
  I want to validate RSA-signed licenses
  So that license authenticity can be verified offline

  # ============================================================================
  # License Parsing
  # ============================================================================

  Scenario: Parses valid base64-encoded license key
    Given a valid signed license with organization "Acme Corp"
    When I parse the license key
    Then the parsed license contains organization name "Acme Corp"
    And the parsed license contains a valid signature

  Scenario: Returns null for malformed base64 input
    Given a license key "not-valid-base64!!!"
    When I parse the license key
    Then the result is null

  Scenario: Returns null for valid base64 but invalid JSON
    Given a license key that is base64 of "not json content"
    When I parse the license key
    Then the result is null

  Scenario: Returns null for empty license key
    Given a license key ""
    When I parse the license key
    Then the result is null

  # ============================================================================
  # Signature Verification
  # ============================================================================

  Scenario: Verifies valid RSA-SHA256 signature
    Given a license signed with the private key
    When I verify the signature with the public key
    Then the signature is valid

  Scenario: Rejects tampered license data
    Given a license signed with the private key
    And the license data has been modified after signing
    When I verify the signature with the public key
    Then the signature is invalid

  Scenario: Rejects license with empty signature
    Given a license with an empty signature
    When I verify the signature with the public key
    Then the signature is invalid

  # ============================================================================
  # Expiration Checking
  # ============================================================================

  # ============================================================================
  # Full Validation Pipeline
  # ============================================================================

  Scenario: Validates complete license successfully
    Given a valid unexpired license for plan "PRO" with maxMembers 5
    When I validate the license
    Then validation succeeds
    And the result contains planInfo with maxMembers 5

  # ============================================================================
  # License Data Structure
  # ============================================================================

