Feature: Refusing work past the monthly usage allowance
  As the owner of a plan's monthly allowance
  I want callers that create billable data to ask whether the allowance is spent
  So that an organization past its cap is refused the way main refused it

  @unit @entitlements
  Scenario: An organization past its monthly allowance is refused with the plan limit
    Given an organization whose month's volume has reached its plan's allowance
    When a caller asserts the organization is within its usage limit
    Then the assertion throws ERR_PLAN_LIMIT with status 402
    And the refusal carries the count, the allowance and the plan name

  @unit @entitlements
  Scenario: An organization within its monthly allowance is let through
    Given an organization whose month's volume is below its plan's allowance
    When a caller asserts the organization is within its usage limit
    Then the assertion resolves without refusing
