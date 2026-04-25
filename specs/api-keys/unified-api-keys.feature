@integration
Feature: Unified API Keys page
  As a LangWatch user
  I want a single API Keys table showing all my keys
  So that I can manage PATs and service keys in one place without switching tabs

  Background:
    Given I am signed in as an admin user
    And I have a project with an API key

  # ── Unified table ──────────────────────────────────────────────

  Scenario: Single table replaces tabs
    When I navigate to Settings > API Keys
    Then I see a single "API Keys" heading with no tab switcher
    And a "+ Create new secret key" button in the header
    And one table with columns: NAME, STATUS, SECRET KEY, CREATED, LAST USED, CREATED BY, PERMISSIONS

  Scenario: PAT rows display in unified table
    Given I have created a PAT named "CI Pipeline" with "All" permissions
    When I navigate to Settings > API Keys
    Then the table contains a row with:
      | NAME        | CI Pipeline  |
      | STATUS      | Active       |
      | SECRET KEY  | sk-...XXXX   |
      | PERMISSIONS | All          |
    And the row has an edit icon button and a revoke icon button

  Scenario: Service API key row displays in unified table
    When I navigate to Settings > API Keys
    Then the table contains a service key row with:
      | NAME        | Project API Key |
      | STATUS      | Active          |
      | SECRET KEY  | sk-...XXXX      |
      | CREATED BY  | Service         |
      | PERMISSIONS | All             |
    And the service key row has a regenerate button but no edit button

  Scenario: Expired PAT shows expired status
    Given I have a PAT that has passed its expiration date
    When I navigate to Settings > API Keys
    Then that PAT row shows STATUS "Expired"

  Scenario: Permissions column shows permission mode
    Given I have a PAT created with "Restricted" permissions
    And I have a PAT created with "Read only" permissions
    And I have a PAT created with "All" permissions
    When I navigate to Settings > API Keys
    Then the PERMISSIONS column shows "Restricted", "Read only", and "All" respectively

  Scenario: All keys display with sk- prefix
    Given I have created a PAT
    When I navigate to Settings > API Keys
    Then the PAT row shows SECRET KEY starting with "sk-"
    And the service key row also shows SECRET KEY starting with "sk-"

  # ── "Owned by" in create drawer ────────────────────────────────

  Scenario: Create drawer shows "Owned by" toggle
    When I click "+ Create new secret key"
    Then the create drawer opens with an "Owned by" toggle: "You" and "Service account"

  Scenario: Admin sees "Other user" option in "Owned by" toggle
    Given I am an organization admin
    When I click "+ Create new secret key"
    Then the "Owned by" toggle includes a third option: "Other user"

  Scenario: Create key for myself (default)
    When I select "You" in the "Owned by" toggle
    And I fill in name "My CI Key"
    And I select "All" permissions
    And I click "Create secret key"
    Then a new PAT is created assigned to me
    And the token is displayed once for copying

  Scenario: Create service key
    When I select "Service account" in the "Owned by" toggle
    Then the form shows "Service Key Name" and "Project" selector
    And no permissions section (service keys have full project access)

  Scenario: Create key for another user (admin only)
    Given I am an organization admin
    When I select "Other user" in the "Owned by" toggle
    Then a user picker appears
    When I select user "alice@example.com"
    And I fill in name "Alice CI Key"
    And I select "All" permissions
    And I click "Create secret key"
    Then a new PAT is created with userId = Alice
    And the ceiling is based on Alice's permissions, not the admin's

  # ── Restricted permissions: project-level ──────────────────────

  Scenario: Restricted mode shows list of projects with role selectors
    When I select "Restricted" in the permission toggle
    Then I see a flat list of all projects in the organization
    And each project has a role selector: Admin | Member | Viewer | None
    And all projects default to "None"

  Scenario: Restricted mode respects user ceiling per project
    Given my role on "Project Alpha" is Member
    When I select "Restricted" and look at "Project Alpha"
    Then the role selector shows: Member | Viewer | None
    And "Admin" is not available (exceeds my ceiling)

  # ── Edit PAT permissions ───────────────────────────────────────

  Scenario: Open edit drawer for a PAT
    Given I have a PAT named "CI Pipeline"
    When I click the edit icon on the "CI Pipeline" row
    Then an edit drawer opens with:
      | field       | value        |
      | Name        | CI Pipeline  |
      | Permissions | current mode |
    And the drawer has Cancel and Save buttons

  Scenario: Update PAT name
    Given the edit drawer is open for PAT "CI Pipeline"
    When I change the name to "Production CI"
    And I click Save
    Then the drawer closes
    And the table shows the PAT with name "Production CI"
    And the PAT token value has not changed

  Scenario: Update PAT permissions from All to Restricted
    Given the edit drawer is open for a PAT with "All" permissions
    When I select "Restricted" in the permission toggle
    And I set "Project Alpha" to "Viewer"
    And I click Save
    Then the table shows PERMISSIONS as "Restricted"
    And the PAT's effective permissions are updated

  Scenario: Update PAT permissions from Restricted to Read only
    Given the edit drawer is open for a PAT with "Restricted" permissions
    When I select "Read only" in the permission toggle
    And I click Save
    Then the table shows PERMISSIONS as "Read only"
    And all bindings are set to VIEWER role

  Scenario: Cannot edit service API key permissions
    When I navigate to Settings > API Keys
    Then the service key row does not have an edit icon button

  # ── Admin overview ─────────────────────────────────────────────

  Scenario: Admin sees all API keys in the organization
    Given I am an organization admin
    And another user "bob@example.com" has created a PAT
    When I navigate to Settings > API Keys
    Then I see both my keys and Bob's keys in the table
    And Bob's keys show "bob@example.com" in the CREATED BY column

  Scenario: Admin can revoke another user's PAT
    Given I am an organization admin
    And "bob@example.com" has a PAT named "Bob CI"
    When I click the revoke icon on "Bob CI"
    And I confirm revocation
    Then the PAT is revoked

  Scenario: Non-admin sees only their own keys
    Given I am a member (not admin)
    When I navigate to Settings > API Keys
    Then I see only my own PATs and the project service key

  # ── Backend: update mutation ───────────────────────────────────

  @unit
  Scenario: Update PAT name and description
    Given a PAT exists owned by the current user
    When I call personalAccessToken.update with a new name
    Then the PAT record is updated with the new name
    And the PAT token and lookupId remain unchanged

  @unit
  Scenario: Update PAT bindings within ceiling
    Given a PAT exists with ADMIN bindings
    And the user has ADMIN role
    When I call personalAccessToken.update with VIEWER bindings
    Then the old role bindings are replaced with new VIEWER bindings

  @unit
  Scenario: Update PAT bindings rejects above ceiling
    Given a PAT exists
    And the user has MEMBER role
    When I call personalAccessToken.update with ADMIN bindings
    Then the update is rejected with a ceiling violation error

  @unit
  Scenario: Cannot update another user's PAT (non-admin)
    Given a PAT exists owned by a different user
    And I am not an admin
    When I call personalAccessToken.update
    Then the update is rejected with a not-found error

  @unit
  Scenario: Admin can update another user's PAT
    Given a PAT exists owned by a different user
    And I am an organization admin
    When I call personalAccessToken.update with a new name
    Then the PAT record is updated

  # ── Token prefix ───────────────────────────────────────────────

  @unit
  Scenario: New PATs are minted with sk-lw- prefix
    When I create a new PAT
    Then the token starts with "sk-lw-"
    And the token format is sk-lw-{lookupId}_{secret}

  @unit
  Scenario: Existing pat-lw- tokens still authenticate
    Given a PAT was created with the old pat-lw- prefix
    When I authenticate with the pat-lw- token
    Then authentication succeeds

  @unit
  Scenario: New sk-lw- PATs authenticate correctly
    Given a PAT was created with the new sk-lw- prefix
    When I authenticate with the sk-lw- token
    Then authentication succeeds
    And the token is distinguished from legacy project keys by structure

  # ── Permission mode persistence ────────────────────────────────

  @unit
  Scenario: Permission mode stored on PAT
    When I create a PAT with "Restricted" permission mode
    Then the PAT record stores permissionMode as "restricted"
    And the edit drawer pre-selects "Restricted" when opened

  # ── Assign to user ─────────────────────────────────────────────

  @unit
  Scenario: Admin creates PAT for another user
    Given I am an organization admin
    When I create a PAT with assignedToUserId = "alice-id"
    Then the PAT userId is set to "alice-id"
    And the PAT createdByUserId is set to my userId
    And ceiling validation uses Alice's permissions

  @unit
  Scenario: Non-admin cannot assign PAT to another user
    Given I am a member (not admin)
    When I create a PAT with assignedToUserId = "bob-id"
    Then the create is rejected with a permission error
