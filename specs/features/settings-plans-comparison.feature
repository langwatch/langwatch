Feature: Settings Plans Comparison Page
  As an organization member
  I want to view plans in settings and compare them side by side
  So that I can understand available options and my current plan

  Background:
    Given I am logged in as a member of an organization on LangWatch Cloud

  @e2e
  Scenario: Member compares plans on the plans page
    Given my organization is on the "Free" plan
    When I navigate to /settings/plans
    Then I see a comparison layout with these plan columns:
      | plan       |
      | Free       |
      | Growth     |
      | Enterprise |
    And plan capabilities are shown in side-by-side rows
    And the "Free" plan is shown as my current plan

  @integration
  Scenario: Non-admin members can access plans comparison
    Given I am logged in with role "MEMBER"
    When I navigate to /settings/plans
    Then the plans comparison page loads
    And I see Free, Growth, and Enterprise plan columns
    And I do not see an access denied state

  @integration
  Scenario: Growth organizations see Growth as current
    Given my organization is on the "Growth" plan
    When I view /settings/plans
    Then the "Growth" plan is shown as current
    And the "Free" plan is not shown as current
    And the "Enterprise" plan is not shown as current

  @integration
  Scenario: Legacy tier organizations show no current plan in comparison
    Given my organization is on a legacy tier plan that is not shown in this comparison
    When I view /settings/plans
    Then no plan column is shown as current

  @integration
  Scenario: TIERED organizations see a discontinued plan migration notice
    Given my organization is on a legacy pricing plan that has been discontinued
    When I view /settings/plans
    Then I see a notice that my current pricing model has been discontinued
    And the notice contains a link to /settings/subscription to update my plan

  @integration
  Scenario: Free plan column shows default limits
    Given I am on /settings/plans
    Then the "Free" plan shows:
      | detail             | value          |
      | events included    | 50,000         |
      | data retention     | 14 days        |
      | users              | 2 users        |
      | scenarios          | 3              |
      | simulation runs    | 3              |
      | custom evaluations | 3              |
    And the plan is presented as the default starter tier

  @integration
  Scenario: Growth plan column shows seat and usage pricing
    Given I am on /settings/plans
    Then the "Growth" plan shows:
      | detail                        | value                                |
      | base price                    | $29 per seat per month               |
      | included events               | 200,000                              |
      | extra event pricing           | $1 per additional 100,000 events     |
      | included data retention       | 30 days                              |
      | custom retention              | $3 per GB                            |
      | core users                    | up to 20 with volume discount        |
      | lite users                    | unlimited                            |
      | evals simulations and prompts | unlimited                            |

  @integration
  Scenario: Enterprise plan column shows custom commercial option
    Given I am on /settings/plans
    Then the "Enterprise" plan is presented as custom pricing
    And the primary action is "Talk to Sales"
    And the plan highlights:
      | detail                        |
      | alternative hosting options   |
      | custom data retention         |
      | custom SSO and RBAC           |
      | audit logs                    |
      | uptime and support SLA        |
      | compliance and legal reviews  |
      | custom terms and DPA          |

  @integration
  Scenario: Plan details are visually comparable by row
    Given I am on /settings/plans
    When I look at a capability row in the comparison grid
    Then I can see the corresponding Free, Growth, and Enterprise values on the same row
    And usage-oriented capabilities are grouped under a "Usage" section
