@wip @unit
Feature: License to PlanInfo Mapping
  As a LangWatch system
  I want to convert license data to PlanInfo structure
  So that existing enforcement code works seamlessly

  # ============================================================================
  # Basic Mapping
  # ============================================================================

  Scenario: Maps all numeric limits correctly
    Given a license with:
      | maxMembers          | 5      |
      | maxProjects         | 10     |
      | maxMessagesPerMonth | 50000  |
      | evaluationsCredit   | 100    |
      | maxWorkflows        | 25     |
    When I map the license to PlanInfo
    # Only seat + message limits surface on PlanInfo. Projects, workflows,
    # evaluationsCredit, etc. stay in the signed license payload but are
    # OSS/uncapped, so they are not mapped onto the active plan.
    Then the PlanInfo has:
      | maxMembers          | 5      |
      | maxMessagesPerMonth | 50000  |

  Scenario: Maps canPublish flag correctly when true
    Given a license with canPublish true
    When I map the license to PlanInfo
    Then the PlanInfo canPublish is true

  Scenario: Maps canPublish flag correctly when false
    Given a license with canPublish false
    When I map the license to PlanInfo
    Then the PlanInfo canPublish is false

  # ============================================================================
  # Default Values
  # ============================================================================

  Scenario: Sets free flag to false for licensed plans
    Given a license with plan type "PRO"
    When I map the license to PlanInfo
    Then the PlanInfo free is false

  Scenario: Sets overrideAddingLimitations to false
    Given any valid license
    When I map the license to PlanInfo
    Then the PlanInfo overrideAddingLimitations is false

  Scenario: Sets prices to zero for self-hosted
    Given any valid license
    When I map the license to PlanInfo
    Then the PlanInfo prices are:
      | USD | 0 |
      | EUR | 0 |

  # ============================================================================
  # Constants: UNLIMITED_PLAN
  # ============================================================================

  # Limits use Number.MAX_SAFE_INTEGER (effectively unlimited and JSON-safe)
  # rather than Infinity, which serializes to null and would break tRPC.
  Scenario: UNLIMITED_PLAN has correct structure for backward compatibility
    When I access the UNLIMITED_PLAN constant
    Then the plan type is "OPEN_SOURCE"
    And the plan name is "Open Source"
    And the plan free is true
    And the plan overrideAddingLimitations is true
    And maxMembers is Number.MAX_SAFE_INTEGER
    And maxMessagesPerMonth is Number.MAX_SAFE_INTEGER
    And canPublish is true

  # ============================================================================
  # Constants: FREE_PLAN
  # ============================================================================

  Scenario: FREE_PLAN has correct limits for expired/invalid licenses
    When I access the FREE_PLAN constant
    Then the plan type is "FREE"
    And the plan name is "Free"
    And the plan free is true
    And maxMembers is 1
    And maxMessagesPerMonth is 1000
    And canPublish is false
