@unit
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

  Scenario: Rejects license with wrong signature
    Given a license with a signature from a different key pair
    When I verify the signature with the public key
    Then the signature is invalid

  Scenario: Rejects license with empty signature
    Given a license with an empty signature
    When I verify the signature with the public key
    Then the signature is invalid

  # ============================================================================
  # Expiration Checking
  # ============================================================================

  Scenario: License is valid when expiration is in the future
    Given a license with expiration date "2030-12-31T23:59:59Z"
    When I check if the license is expired
    Then the license is not expired

  Scenario: License is expired when expiration is in the past
    Given a license with expiration date "2020-01-01T00:00:00Z"
    When I check if the license is expired
    Then the license is expired

  Scenario: License expires at exactly the expiration time
    Given a license with expiration date at the current moment
    When I check if the license is expired
    Then the license is expired

  # ============================================================================
  # Full Validation Pipeline
  # ============================================================================

  Scenario: Validates complete license successfully
    Given a valid unexpired license for plan "PRO" with maxMembers 5
    When I validate the license
    Then validation succeeds
    And the result contains planInfo with maxMembers 5

  Scenario: Validation fails for invalid format
    Given a license key "garbage-data"
    When I validate the license
    Then validation fails with error "Invalid license format"

  Scenario: Validation fails for invalid signature
    Given a license with tampered data
    When I validate the license
    Then validation fails with error "Invalid signature"

  Scenario: Validation fails for expired license
    Given a valid but expired license for plan "PRO"
    When I validate the license
    Then validation fails with error "License expired"

  # ============================================================================
  # License Data Structure
  # ============================================================================

  Scenario: Extracts all license fields correctly
    Given a license with:
      | licenseId         | lic-001                  |
      | version           | 1                        |
      | organizationName  | Test Org                 |
      | email             | admin@test.org           |
      | issuedAt          | 2024-01-01T00:00:00Z     |
      | expiresAt         | 2025-12-31T23:59:59Z     |
      | planType          | GROWTH                   |
      | maxMembers        | 10                       |
      | maxProjects       | 99                       |
      | maxMessagesPerMonth | 100000                 |
      | evaluationsCredit | 50                       |
      | maxWorkflows      | 100                      |
      | canPublish        | true                     |
    When I validate the license
    Then the license data matches all provided fields
