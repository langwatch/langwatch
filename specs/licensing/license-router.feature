@wip @integration
Feature: License tRPC Router
  As a LangWatch administrator
  I want API endpoints to manage licenses
  So that I can upload, view, and remove licenses via the UI

  Background:
    Given I am authenticated as user "user-123"
    And I am an admin of organization "org-456"

  # ============================================================================
  # getStatus Endpoint
  # ============================================================================

  @unimplemented
  Scenario: Gets license status for organization without license
    Given the organization has no license
    When I call license.getStatus with organizationId "org-456"
    Then the response includes:
      | hasLicense     | false       |
      | valid          | false       |
      | planName       | Open Source |

  @unimplemented
  Scenario: Rejects request for unauthorized organization
    Given I am not a member of organization "other-org"
    When I call license.getStatus with organizationId "other-org"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # upload Endpoint
  # ============================================================================

  Scenario: Returns error for expired license
    Given an expired license key for plan "PRO"
    When I call license.upload with:
      | organizationId | org-456           |
      | licenseKey     | <expired-license> |
    Then the request fails with BAD_REQUEST
    And the error message is "License expired"

  # ============================================================================
  # remove Endpoint
  # ============================================================================

