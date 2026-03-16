Feature: SCIM 2.0 Inbound Provisioning
  As an enterprise IT administrator
  I want to provision and deprovision LangWatch users from my IdP (Okta, Azure AD, etc.)
  So that user lifecycle is automatically managed without manual LangWatch admin intervention

  Background:
    Given an organization exists with a valid SCIM bearer token
    And the SCIM endpoint is /api/scim/v2

  # ============================================================================
  # ServiceProviderConfig
  # ============================================================================

  Scenario: IdP discovers SCIM capabilities
    When a GET request is sent to /api/scim/v2/ServiceProviderConfig
    Then the response status is 200
    And the response lists supported operations: patch, filter, sort
    And the authentication scheme is "oauthbearertoken"

  # ============================================================================
  # Token Authentication
  # ============================================================================

  Scenario: Request without bearer token is rejected
    When a GET request is sent to /api/scim/v2/Users without an Authorization header
    Then the response status is 401

  Scenario: Request with invalid bearer token is rejected
    When a GET request is sent to /api/scim/v2/Users with an invalid token
    Then the response status is 401

  Scenario: Request with valid bearer token is accepted
    When a GET request is sent to /api/scim/v2/Users with a valid organization token
    Then the response status is 200

  # ============================================================================
  # Token Management
  # ============================================================================

  Scenario: Org admin generates a SCIM token
    Given I am an organization admin
    When I generate a SCIM token from the Settings > SCIM page
    Then a new token is created and shown once in full
    And subsequent views only show the token prefix

  Scenario: Org admin revokes a SCIM token
    Given a SCIM token exists for the organization
    When I revoke the token
    Then subsequent SCIM requests using that token return 401

  # ============================================================================
  # User Provisioning (POST)
  # ============================================================================

  Scenario: IdP provisions a new user
    Given no user exists with email "alice@acme.com"
    When a POST request is sent to /api/scim/v2/Users with:
      | userName  | alice@acme.com |
      | name.givenName  | Alice |
      | name.familyName | Smith |
      | active    | true  |
    Then the response status is 201
    And a user is created with email "alice@acme.com" and name "Alice Smith"
    And the user is added to the organization as a Member
    And the response includes the new user's SCIM id

  Scenario: IdP provisions a user that already exists in LangWatch
    Given a user exists with email "bob@acme.com"
    When a POST request is sent to /api/scim/v2/Users with userName "bob@acme.com"
    Then the response status is 409
    And the error message indicates the user already exists

  # ============================================================================
  # User Retrieval (GET)
  # ============================================================================

  Scenario: IdP lists all provisioned users for the organization
    Given 3 users are members of the organization
    When a GET request is sent to /api/scim/v2/Users
    Then the response status is 200
    And the response contains a ListResponse with 3 users
    And each user resource includes id, userName, name, and active fields

  Scenario: IdP retrieves a single user by SCIM id
    Given a user with SCIM id "user_abc123" is a member of the organization
    When a GET request is sent to /api/scim/v2/Users/user_abc123
    Then the response status is 200
    And the response is a SCIM User resource for that user

  Scenario: IdP retrieves a non-existent user
    When a GET request is sent to /api/scim/v2/Users/nonexistent
    Then the response status is 404

  Scenario: IdP filters users by userName
    Given users with emails "alice@acme.com" and "bob@acme.com" are org members
    When a GET request is sent to /api/scim/v2/Users?filter=userName eq "alice@acme.com"
    Then the response contains exactly 1 user
    And that user's userName is "alice@acme.com"

  # ============================================================================
  # User Update (PUT / PATCH)
  # ============================================================================

  Scenario: IdP updates a user's display name via PUT
    Given a provisioned user with id "user_abc123" and name "Alice Smith"
    When a PUT request is sent to /api/scim/v2/Users/user_abc123 with name.givenName "Alicia"
    Then the response status is 200
    And the user's name is updated to "Alicia Smith"

  Scenario: IdP updates a user's display name via PATCH
    Given a provisioned user with id "user_abc123"
    When a PATCH request is sent to /api/scim/v2/Users/user_abc123 with:
      | op    | replace             |
      | path  | name.givenName      |
      | value | Alicia              |
    Then the response status is 200
    And the user's given name is updated to "Alicia"

  # ============================================================================
  # User Deactivation via PATCH/PUT
  # ============================================================================

  Scenario: IdP deactivates a user by setting active to false
    Given an active provisioned user with id "user_abc123"
    When a PATCH request sets active to false for user "user_abc123"
    Then the response status is 200
    And the user's deactivatedAt is set
    And the user cannot log in to LangWatch

  Scenario: IdP reactivates a previously deactivated user
    Given a deactivated provisioned user with id "user_abc123"
    When a PATCH request sets active to true for user "user_abc123"
    Then the response status is 200
    And the user's deactivatedAt is cleared
    And the user can log in again

  # ============================================================================
  # User Deprovisioning (DELETE)
  # ============================================================================

  Scenario: IdP deprovisions a user via DELETE
    Given a provisioned user with id "user_abc123" who is a member of the organization
    When a DELETE request is sent to /api/scim/v2/Users/user_abc123
    Then the response status is 204
    And the user is deactivated in LangWatch
    And the user is removed from the organization

  Scenario: IdP deletes a non-existent user
    When a DELETE request is sent to /api/scim/v2/Users/nonexistent
    Then the response status is 404

  # ============================================================================
  # UserService
  # ============================================================================

  Scenario: UserService deactivate delegates to prisma correctly
    When UserService.deactivate is called with a valid userId
    Then the user's deactivatedAt is set to the current timestamp

  Scenario: UserService reactivate clears deactivatedAt
    When UserService.reactivate is called with a deactivated user
    Then the user's deactivatedAt is null

  Scenario: UserService findByEmail returns null for unknown email
    When UserService.findByEmail is called with an email that does not exist
    Then null is returned
