Feature: License Generation
  As an administrator
  I want to generate licenses for organizations
  So that I can provide valid license keys for self-hosted deployments

  Background:
    Given I am logged in as an administrator
    And I am on the licensing settings page

  # Happy path - full system flow
  @e2e
  Scenario: Generate a valid license for an organization
    Given I navigate to the license generation section
    When I fill in the organization name "Acme Corp"
    And I fill in the email "admin@acme.corp"
    And I select the plan type "PRO"
    And I set the expiration date to "2025-12-31"
    And I set the plan limits:
      | Field               | Value  |
      | maxMembers          | 10     |
      | maxProjects         | 20     |
      | maxMessagesPerMonth | 100000 |
      | evaluationsCredit   | 500    |
      | maxWorkflows        | 50     |
      | maxPrompts          | 50     |
      | maxEvaluators       | 50     |
      | maxScenarios        | 50     |
      | canPublish          | true   |
    And I click "Generate License"
    Then a license file is automatically downloaded
    And the downloaded file is named "Acme Corp.langwatch-license"
    And I see a success message confirming the download

  # Form validation and error handling
  @integration
  Scenario: Display validation error for missing required fields
    Given I navigate to the license generation section
    When I click "Generate License" without filling any fields
    Then I see validation errors for:
      | Field            | Error                            |
      | organizationName | Organization name is required    |
      | email            | Email is required                |
      | expiresAt        | Expiration date is required      |
      | planType         | Plan type is required            |

  @integration
  Scenario: Display validation error for invalid email format
    Given I navigate to the license generation section
    When I fill in the email "invalid-email"
    And I click "Generate License"
    Then I see a validation error "Invalid email format" for the email field

  @integration
  Scenario: Display validation error for past expiration date
    Given I navigate to the license generation section
    When I fill in all required fields
    And I set the expiration date to "2020-01-01"
    And I click "Generate License"
    Then I see a validation error "Expiration date must be in the future"

  @integration
  Scenario: Display validation error for negative plan limits
    Given I navigate to the license generation section
    When I fill in the organization name "Test Org"
    And I fill in the email "test@test.com"
    And I select the plan type "PRO"
    And I set maxMembers to "-5"
    And I click "Generate License"
    Then I see a validation error "Plan limits must be positive numbers"

  @integration
  Scenario: Generate license with preset plan template
    Given I navigate to the license generation section
    And I fill in the organization name "Enterprise Corp"
    And I fill in the email "admin@enterprise.corp"
    When I select the plan type "ENTERPRISE"
    Then the plan limits are populated with enterprise defaults:
      | Field               | Value    |
      | maxMembers          | 100      |
      | maxProjects         | 500      |
      | maxMessagesPerMonth | 10000000 |
      | evaluationsCredit   | 10000    |
      | maxWorkflows        | 1000     |
      | maxPrompts          | 1000     |
      | maxEvaluators       | 1000     |
      | maxScenarios        | 1000     |
      | canPublish          | true     |

  @integration
  Scenario: Customize plan limits after selecting template
    Given I navigate to the license generation section
    And I fill in the organization name "Custom Corp"
    And I fill in the email "admin@custom.corp"
    And I select the plan type "PRO"
    When I change maxMembers to "25"
    And I change maxProjects to "50"
    Then the form retains the custom values
    And other fields keep the PRO template defaults

  @integration
  Scenario: License file download uses organization name in filename
    Given I have filled in the organization name "Test Company Inc"
    And I have completed all other required fields
    When I click "Generate License"
    Then the downloaded file is named "Test Company Inc.langwatch-license"

  @integration
  Scenario: License file download sanitizes special characters in filename
    Given I have filled in the organization name "Company/With:Special*Characters"
    And I have completed all other required fields
    When I click "Generate License"
    Then the downloaded file has a sanitized filename
    And the filename uses the .langwatch-license extension

  @integration
  Scenario: License file contains valid license key content
    Given I have successfully generated a license
    Then the downloaded file contains a valid base64-encoded license key
    And the file content can be used to activate a license

  @integration
  Scenario: Generate another license after successful generation
    Given I have successfully generated a license
    When I click "Generate Another"
    Then the form is cleared
    And I can enter new license details

  # API-level validation
  @unit
  Scenario: Validate license data schema
    Given valid license input data
    When the schema validation runs
    Then all required fields are validated:
      | Field            | Type   | Required |
      | organizationName | string | yes      |
      | email            | string | yes      |
      | expiresAt        | date   | yes      |
      | plan.type        | string | yes      |
      | plan.name        | string | yes      |
      | plan.maxMembers  | number | yes      |
      | plan.maxProjects | number | yes      |

  @unit
  Scenario: Generate unique license ID
    Given I generate two licenses with the same input
    When I compare the license IDs
    Then each license has a unique licenseId

  @unit
  Scenario: Sign license with RSA-SHA256
    Given valid license data
    When the license is signed
    Then the signature is a valid RSA-SHA256 signature
    And the signed license can be verified with the public key

  @unit
  Scenario: Encode signed license as base64
    Given a signed license
    When the license is encoded
    Then the output is a valid base64 string
    And decoding produces valid JSON with data and signature fields
