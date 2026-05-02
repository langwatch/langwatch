Feature: License Generation
  As an administrator
  I want to generate licenses for organizations
  So that I can provide valid license keys for self-hosted deployments

  Background:
    Given I am logged in as an administrator
    And I am on the licensing settings page

  # Happy path - full system flow
  @e2e @unimplemented
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
  @integration @unimplemented
  Scenario: Display validation error for missing required fields
    Given I navigate to the license generation section
    When I click "Generate License" without filling any fields
    Then I see validation errors for:
      | Field            | Error                            |
      | organizationName | Organization name is required    |
      | email            | Email is required                |
      | expiresAt        | Expiration date is required      |
      | planType         | Plan type is required            |

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Customize plan limits after selecting template
    Given I navigate to the license generation section
    And I fill in the organization name "Custom Corp"
    And I fill in the email "admin@custom.corp"
    And I select the plan type "PRO"
    When I change maxMembers to "25"
    And I change maxProjects to "50"
    Then the form retains the custom values
    And other fields keep the PRO template defaults

  @integration @unimplemented
  Scenario: License file download uses organization name in filename
    Given I have filled in the organization name "Test Company Inc"
    And I have completed all other required fields
    When I click "Generate License"
    Then the downloaded file is named "Test Company Inc.langwatch-license"

  @integration @unimplemented
  Scenario: License file download sanitizes special characters in filename
    Given I have filled in the organization name "Company/With:Special*Characters"
    And I have completed all other required fields
    When I click "Generate License"
    Then the downloaded file has a sanitized filename
    And the filename uses the .langwatch-license extension

  @integration @unimplemented
  Scenario: Generate another license after successful generation
    Given I have successfully generated a license
    When I click "Generate Another"
    Then the form is cleared
    And I can enter new license details

  # API-level validation

