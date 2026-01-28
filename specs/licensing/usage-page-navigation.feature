Feature: Plan Management Navigation
  As a user
  I want plan management links to redirect me based on deployment type
  So that I can manage my plan or license appropriately

  Background:
    Given I am logged in as an administrator

  # Usage page plan change redirect
  @e2e
  Scenario: Usage page change plan redirects to Subscription in SaaS mode
    Given the platform is deployed in SaaS mode (IS_SAAS=true)
    And I am on the usage settings page at /settings/usage
    When I click the "Change plan" button
    Then I am redirected to /settings/subscription

  @e2e
  Scenario: Usage page change plan redirects to License in self-hosted mode
    Given the platform is deployed in self-hosted mode (IS_SAAS=false)
    And license enforcement is enabled
    And I am on the usage settings page at /settings/usage
    When I click the "Change plan" button
    Then I am redirected to /settings/license

  # Project limit reached redirects
  @e2e
  Scenario: Project limit reached redirects to Subscription in SaaS mode
    Given the platform is deployed in SaaS mode
    And the organization has reached the maximum number of projects
    When I try to create a new project
    Then the upgrade link redirects to /settings/subscription

  @e2e
  Scenario: Project limit reached redirects to License in self-hosted mode
    Given the platform is deployed in self-hosted mode
    And the organization has reached the maximum number of projects
    When I try to create a new project
    Then the upgrade link redirects to /settings/license

  # Message limit reached redirects
  @e2e
  Scenario: Message limit banner redirects to Subscription in SaaS mode
    Given the platform is deployed in SaaS mode
    And the organization has reached the maximum messages for the month
    When I see the limit warning banner
    Then the upgrade link redirects to /settings/subscription

  @e2e
  Scenario: Message limit banner redirects to License in self-hosted mode
    Given the platform is deployed in self-hosted mode
    And the organization has reached the maximum messages for the month
    When I see the limit warning banner
    Then the upgrade link redirects to /settings/license

  # Publish feature upgrade redirect
  @e2e
  Scenario: Publish upgrade redirects to Subscription in SaaS mode
    Given the platform is deployed in SaaS mode
    And the organization plan does not allow publishing
    When I try to publish from the studio
    Then the upgrade button redirects to /settings/subscription

  @e2e
  Scenario: Publish upgrade redirects to License in self-hosted mode
    Given the platform is deployed in self-hosted mode
    And the organization plan does not allow publishing
    When I try to publish from the studio
    Then the upgrade button redirects to /settings/license

  # Settings menu visibility
  @integration
  Scenario: Settings menu shows appropriate items based on deployment type
    Given the platform deployment type is determined
    When I view the settings menu
    Then in SaaS mode:
      | Menu Item    | Visible |
      | Subscription | true    |
      | License      | false   |
    And in self-hosted mode:
      | Menu Item    | Visible |
      | Subscription | false   |
      | License      | true    |

  @integration
  Scenario: Platform provides hook for determining plan management URL
    Given a component needs to link to plan management
    When it calls the getPlanManagementUrl helper
    Then in SaaS mode it returns "/settings/subscription"
    And in self-hosted mode it returns "/settings/license"

  # Resource limits display on Usage page
  @e2e
  Scenario: Usage page shows resource limits in self-hosted mode with license
    Given the platform is deployed in self-hosted mode
    And a valid license is installed
    When I view the usage page
    Then I see the "Resource Limits" section
    And I see current usage vs limit for:
      | Resource    |
      | Members     |
      | Projects    |
      | Prompts     |
      | Workflows   |
      | Scenarios   |
      | Evaluators  |

  @e2e
  Scenario: Usage page shows FREE tier limits in self-hosted mode without license
    Given the platform is deployed in self-hosted mode
    And no license is installed
    When I view the usage page at /settings/usage
    Then I see the "Resource Limits" section
    And I see the "Free" plan indicator
    And I see current usage vs FREE tier limits for:
      | Resource    | Limit |
      | Members     | 1     |
      | Projects    | 2     |
      | Prompts     | 3     |
      | Workflows   | 3     |
      | Scenarios   | 3     |
      | Evaluators  | 3     |
    And I see a "Manage license" button to upgrade

  @e2e
  Scenario: Usage page shows trace usage in SaaS mode
    Given the platform is deployed in SaaS mode
    When I view the usage page
    Then I see the "Trace Usage" section with a progress bar
    And I see the message count vs monthly limit
    And I see the "Change plan" button

  @integration
  Scenario: Usage page conditionally renders sections based on deployment type
    Given the platform deployment type is determined
    Then in SaaS mode:
      | Section           | Visible |
      | Trace Usage       | true    |
      | Change plan link  | true    |
      | Resource Limits   | false   |
    And in self-hosted mode with license:
      | Section           | Visible |
      | Resource Limits   | true    |
      | Change plan link  | true    |
      | Trace Usage       | false   |
    And in self-hosted mode without license:
      | Section           | Visible |
      | Resource Limits   | true    |
      | Manage license    | true    |
      | Trace Usage       | false   |

  @integration
  Scenario: Usage page shows FREE tier defaults when no license installed
    Given the platform is deployed in self-hosted mode
    And no license is installed
    When I view the usage page
    Then the resource limits section displays FREE tier limits:
      | Resource            | Max Limit |
      | maxMembers          | 1         |
      | maxProjects         | 2         |
      | maxWorkflows        | 3         |
      | maxPrompts          | 3         |
      | maxEvaluators       | 3         |
      | maxScenarios        | 3         |
      | maxMessagesPerMonth | 1000      |
      | evaluationsCredit   | 2         |
    And each resource row shows current usage count

  # Button label consistency
  @integration
  Scenario: Plan management button uses appropriate label
    Given the usage page is displayed
    When in SaaS mode
    Then the button label is "Change plan"
    When in self-hosted mode
    Then the button label is "Manage license"
