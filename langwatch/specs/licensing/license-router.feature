@integration
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

  Scenario: Gets license status for organization without license
    Given the organization has no license
    When I call license.getStatus with organizationId "org-456"
    Then the response includes:
      | hasLicense     | false          |
      | valid          | false          |
      | planName       | Self-Hosted (Unlimited) |

  Scenario: Gets license status with current member count
    Given the organization has a valid license with maxMembers 10
    And the organization has 5 members
    When I call license.getStatus with organizationId "org-456"
    Then the response includes:
      | hasLicense     | true  |
      | valid          | true  |
      | currentMembers | 5     |
      | maxMembers     | 10    |

  Scenario: Gets license status with expiration date
    Given the organization has a valid license expiring "2025-12-31"
    When I call license.getStatus with organizationId "org-456"
    Then the response expiresAt is "2025-12-31"

  Scenario: Requires organization:view permission
    Given I am a member but not admin of organization "org-456"
    When I call license.getStatus with organizationId "org-456"
    Then the request succeeds

  Scenario: Rejects request for unauthorized organization
    Given I am not a member of organization "other-org"
    When I call license.getStatus with organizationId "other-org"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # upload Endpoint
  # ============================================================================

  Scenario: Uploads and activates valid license
    Given a valid license key for plan "PRO"
    When I call license.upload with:
      | organizationId | org-456           |
      | licenseKey     | <valid-license>   |
    Then the response includes:
      | success | true |
      | plan    | Pro  |

  Scenario: Returns error for invalid license key
    When I call license.upload with:
      | organizationId | org-456            |
      | licenseKey     | invalid-license    |
    Then the request fails with BAD_REQUEST
    And the error message is "Invalid license format"

  Scenario: Returns error for expired license
    Given an expired license key for plan "PRO"
    When I call license.upload with:
      | organizationId | org-456           |
      | licenseKey     | <expired-license> |
    Then the request fails with BAD_REQUEST
    And the error message is "License expired"

  Scenario: Requires organization:manage permission
    Given I am a member but not admin of organization "org-456"
    And a valid license key
    When I call license.upload with organizationId "org-456"
    Then the request fails with FORBIDDEN

  Scenario: Rejects empty license key
    When I call license.upload with:
      | organizationId | org-456 |
      | licenseKey     |         |
    Then the request fails with validation error

  # ============================================================================
  # remove Endpoint
  # ============================================================================

  Scenario: Removes license from organization
    Given the organization has a valid license
    When I call license.remove with organizationId "org-456"
    Then the response includes:
      | success | true |
    And the organization license is cleared
    And the organization licenseExpiresAt is null
    And the organization licenseLastValidatedAt is null

  Scenario: Succeeds even when no license exists
    Given the organization has no license
    When I call license.remove with organizationId "org-456"
    Then the response includes:
      | success | true |

  Scenario: Requires organization:manage permission for remove
    Given I am a member but not admin of organization "org-456"
    When I call license.remove with organizationId "org-456"
    Then the request fails with FORBIDDEN
