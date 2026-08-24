Feature: Enterprise licensing lifecycle

  Scenario: Activate a valid signed license
    Given an organization exists and a current license verifies
    When the licensing service activates the license
    Then it stores validation metadata and provisions only missing retention rules

  Scenario: Reject a license that was not signed by LangWatch
    Given a license payload has an invalid signature
    When the licensing service validates it for activation
    Then validation fails and no license state is written

  Scenario: Preserve a lapsed self-hosted purchase
    Given a genuine signed license has reached its end date
    When the self-hosted plan source resolves the organization
    Then the signed seat limits and enterprise capabilities remain in its plan

  Scenario: Let a lapsed Cloud override step aside
    Given a genuine signed license has reached its end date
    When the active Cloud license source resolves the organization
    Then it returns the free baseline so another entitlement source may apply

  Scenario: Import licensing without side effects
    When a runtime imports the licensing contract or server package
    Then it reads no environment and registers no route, job, or subscriber
