@integration
Feature: Unified API Keys
  As a LangWatch user
  I want to manage personal and service API keys from a single page
  So that I can control access to the platform without switching between tabs

  Background:
    Given I am signed in as a user in an organization
    And the organization has at least one project

  # ── Unified table ──────────────────────────────────────────────

  Scenario: Single table replaces tabs
    When I navigate to Settings > API Keys
    Then I see a single "API Keys" heading with no tab switcher
    And a "+ Create new secret key" button in the header
    And one table with columns: NAME, STATUS, SECRET KEY, CREATED, LAST USED, CREATED BY, PERMISSIONS

  Scenario: Personal API key row displays in table
    Given I have created an API key named "CI Pipeline" with "All" permissions
    When I navigate to Settings > API Keys
    Then the table contains a row with:
      | NAME        | CI Pipeline  |
      | STATUS      | Active       |
      | SECRET KEY  | sk-...XXXX   |
      | PERMISSIONS | All          |
    And the row has an edit icon button and a revoke icon button

  Scenario: Legacy project key row displays in table
    When I navigate to Settings > API Keys
    Then the table contains a legacy project key row with:
      | NAME        | Project API Key |
      | STATUS      | Active          |
      | SECRET KEY  | sk-...XXXX      |
      | CREATED BY  | Service         |
      | PERMISSIONS | All             |
    And the legacy project key row has no edit or revoke button

  Scenario: Expired API key shows expired status
    Given I have an API key that has passed its expiration date
    When I navigate to Settings > API Keys
    Then that API key row shows STATUS "Expired"

  Scenario: Non-admin sees own keys plus service keys
    Given I am a member (not admin)
    And there are service API keys in the organization
    When I navigate to Settings > API Keys
    Then I see my own API keys and all service keys
    And I do not see other users' personal keys

  Scenario: Admin sees all API keys in the organization
    Given I am an organization admin
    And another user has created a personal API key
    When I navigate to Settings > API Keys
    Then I see all API keys including other users' personal keys
    And the CREATED BY column shows each key's owner

  # ── Personal API keys ─────────────────────────────────────────

  Scenario: Non-admin creates personal API key
    When I click "+ Create new secret key"
    Then the create drawer opens
    And there is no "Key type" toggle (non-admins always create personal keys)
    When I fill in name "My CI Key"
    And I select "All" permissions
    And I click "Create secret key"
    Then a new API key is created assigned to me
    And the token is displayed once for copying

  Scenario: Personal API key is bounded by user's role binding ceiling
    Given my role on "Project Alpha" is Member
    When I create an API key with "All" permissions
    Then the key's effective permissions are bounded by my Member role on "Project Alpha"
    And using the key for admin-only operations on "Project Alpha" is denied

  Scenario: Restricted permission mode limits key to selected projects
    When I select "Restricted" in the permission toggle
    Then I see a list of all projects in the organization
    And each project has a role selector: Admin, Member, Viewer, None
    When I set "Project Alpha" to "Viewer" and "Project Beta" to "None"
    And I click "Create secret key"
    Then the key only grants Viewer access to "Project Alpha"
    And the key has no access to "Project Beta"

  Scenario: Restricted mode respects user ceiling per project
    Given my role on "Project Alpha" is Member
    When I select "Restricted" and look at "Project Alpha"
    Then the role selector does not include "Admin" (exceeds my ceiling)

  Scenario: Read only mode sets all bindings to Viewer
    When I select "Read only" in the permission toggle
    And I click "Create secret key"
    Then all role bindings on the key are set to VIEWER

  Scenario: Personal API key is disabled when user is removed from org
    Given I have created a personal API key
    When my user is removed from the organization
    Then the API key no longer authenticates

  # ── Admin: create for another user ─────────────────────────────

  Scenario: Admin sees key type toggle and user picker
    Given I am an organization admin
    When I click "+ Create new secret key"
    Then the create drawer shows a "Key type" toggle with "Personal" and "Service"
    And under "Personal" there is a user picker defaulting to myself

  Scenario: Admin creates API key for another user
    Given I am an organization admin
    When I select "Personal" key type
    And I select user "alice@example.com" from the user picker
    And I fill in name "Alice CI Key" and select "All" permissions
    And I click "Create secret key"
    Then the key is created with userId = Alice
    And the ceiling validation uses Alice's permissions, not the admin's
    And createdByUserId is set to the admin's userId

  Scenario: Non-admin cannot create API key for another user
    Given I am a member (not admin)
    When I call apiKey.create with assignedToUserId = another user
    Then the request is rejected with a permission error

  # ── Service API keys ───────────────────────────────────────────

  Scenario: Admin creates service API key
    Given I am an organization admin
    When I select "Service" key type
    And I fill in name "CI/CD Pipeline"
    And I click "Create secret key"
    Then a service API key is created with userId = null
    And the key has full organization access (no user ceiling)
    And the permissions section is not shown (service keys are always "All")

  Scenario: Multiple service keys can coexist
    Given I am an organization admin
    When I create service keys named "CI Pipeline" and "Staging Deploy"
    Then both keys appear in the table
    And the CREATED BY column shows "Service" for both

  Scenario: Non-admin cannot create service API key
    Given I am a member (not admin)
    When I call apiKey.create with keyType = "service"
    Then the request is rejected with a permission error

  Scenario: Service key survives user removal
    Given a service API key exists
    When the admin who created it is removed from the organization
    Then the service API key still authenticates

  Scenario: Non-admin can see but not edit or revoke service keys
    Given I am a member (not admin)
    And a service API key exists
    When I navigate to Settings > API Keys
    Then I see the service key in the table
    But the edit and revoke buttons are disabled or hidden for it

  # ── Legacy project key backward compatibility ──────────────────

  Scenario: Legacy project key (Project.apiKey) continues to work
    Given a project has the legacy apiKey string attribute set
    When I authenticate with the legacy sk-lw-{projectKey} token (no underscore)
    Then authentication succeeds as a legacy project key
    And the request is scoped to that project

  Scenario: Legacy project key is never deleted by new API key operations
    When I create, update, or revoke API keys via the new system
    Then the Project.apiKey string attribute is never modified

  # ── Edit API key ───────────────────────────────────────────────

  Scenario: Edit personal API key name
    Given I have an API key named "CI Pipeline"
    When I click the edit icon on "CI Pipeline"
    Then an edit drawer opens pre-filled with the current name and permissions
    When I change the name to "Production CI"
    And I click Save
    Then the table shows the key with name "Production CI"
    And the token value has not changed

  Scenario: Edit personal API key permissions
    Given I have an API key with "All" permissions
    When I open the edit drawer and select "Restricted"
    And I set "Project Alpha" to "Viewer"
    And I click Save
    Then the key's permissions are updated to "Restricted"
    And the role bindings reflect the new Viewer-on-Alpha scope

  Scenario: Admin can edit another user's personal key
    Given I am an organization admin
    And "bob@example.com" has a personal API key
    When I edit Bob's key name
    Then the update succeeds

  Scenario: Non-admin cannot edit another user's key
    Given I am a member (not admin)
    When I call apiKey.update on another user's key
    Then the update is rejected with a not-owned error

  Scenario: Cannot edit a revoked API key
    Given an API key has been revoked
    When I call apiKey.update on it
    Then the update is rejected with an already-revoked error

  Scenario: Service key can only be edited by admin
    Given a service API key exists
    And I am a member (not admin)
    When I call apiKey.update on the service key
    Then the update is rejected with a not-owned error

  # ── Revoke ─────────────────────────────────────────────────────

  Scenario: Owner revokes their own API key
    Given I have a personal API key
    When I click the revoke icon and confirm
    Then the key is soft-deleted (revokedAt set)
    And the key no longer appears in the active list
    And authenticating with the token fails

  Scenario: Admin revokes another user's API key
    Given I am an organization admin
    And "bob@example.com" has a personal API key
    When I revoke Bob's key
    Then the revocation succeeds

  Scenario: Admin revokes a service API key
    Given I am an organization admin
    And a service API key exists
    When I revoke the service key
    Then the revocation succeeds

  # ── Token format and authentication ────────────────────────────

  @unit
  Scenario: New API keys are minted with sk-lw- prefix
    When I create a new API key
    Then the token starts with "sk-lw-"
    And the token format is sk-lw-{lookupId}_{secret}

  @unit
  Scenario: Old pat-lw- tokens still authenticate
    Given an API key was created with the old pat-lw- prefix
    When I authenticate with the pat-lw- token
    Then authentication succeeds

  @unit
  Scenario: Token type detection distinguishes API keys from legacy project keys
    Given a token "sk-lw-abc123_secretpart" (has underscore)
    Then it is classified as "apiKey"
    Given a token "sk-lw-oldprojectkey" (no underscore)
    Then it is classified as "legacyProjectKey"

  # ── Audit logging ──────────────────────────────────────────────

  Scenario: API key creation is audit logged
    When I create an API key
    Then an audit log entry is recorded with action "apiKey.create"
    And the entry includes the key name, permission mode, and key type

  Scenario: API key update is audit logged
    When I update an API key's name or permissions
    Then an audit log entry is recorded with action "apiKey.update"

  Scenario: API key revocation is audit logged
    When I revoke an API key
    Then an audit log entry is recorded with action "apiKey.revoke"
    And the entry includes the revoked key's ID

  Scenario: API key authentication is logged on use
    When a request is authenticated via an API key
    Then the lastUsedAt timestamp is updated on the key
    And the API key ID is available in the request context for downstream logging
