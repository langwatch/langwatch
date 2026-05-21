Feature: API Key Scope and Fine-Grained Permissions
  As a LangWatch user
  I want to separately define WHERE an API key operates (scope) and WHAT it can do (permissions)
  So that I can create keys with the exact access level needed

  Supersedes in unified-api-keys.feature:
    - "Restricted permission mode limits key to selected projects"
    - "Read only mode sets all bindings to Viewer"
    - "Restricted mode respects user ceiling per project"
    - "Edit personal API key permissions"

  Background:
    Given I am signed in as a user in an organization
    And the organization has teams and projects

  # ── Drawer layout ───────────────────────────────────────────

  @integration @unimplemented
  Scenario: Create drawer fields appear in order: Name, Description, Scope, Permissions
    When I open the create API key drawer
    Then the fields appear in order: Name, Description, Scope, Permissions
    And Scope and Permissions are separate sections

  # ── Scope selector (ScopeChipPicker with quick-pick pills) ──

  @integration @unimplemented
  Scenario: Scope defaults to current project via quick-pick pill
    When I open the create API key drawer
    Then the "This project" pill is selected by default
    And the key will be scoped to the current project context

  @integration @unimplemented
  Scenario: Scope quick-picks show Organization, This team, This project, Multiple
    When I open the create API key drawer
    Then I see pill buttons: Organization, This team, This project, Multiple
    And each pill has an icon: building for organization, users for team, folder for project

  @integration @unimplemented
  Scenario: Selecting Organization pill scopes key to the organization
    When I click the "Organization" pill
    Then the key is stored with scopeType ORGANIZATION and scopeId of the current org

  @integration @unimplemented
  Scenario: Selecting Multiple pill reveals multi-select dropdown
    When I click the "Multiple" pill
    Then a dropdown appears listing all accessible teams and projects
    And I can select multiple scopes for the key

  @integration @unimplemented
  Scenario: Scope selector reuses ScopeChipPicker from model providers
    When I open the scope selector
    Then it renders the same ScopeChipPicker component as the model provider form
    And quick-pick pills match the model provider scope section exactly

  # ── Permission modes ───────────────────────────────────────

  @integration @unimplemented
  Scenario: Permission section shows "All" and "Restricted" toggle with counter
    When I open the create API key drawer
    Then the Permissions section shows an "All" and "Restricted" segment toggle
    And "All" is selected by default
    And when "Restricted" is selected a counter shows "0 selected permissions"

  @integration @unimplemented
  Scenario: "All" mode grants full permissions at the selected scope
    When "All" permission mode is selected
    Then no fine-grained permission list is shown
    And the key gets full access within the selected scope

  @integration @unimplemented
  Scenario: "Restricted" mode shows resource list with None/Read/Write selectors
    When I select "Restricted" in the permissions toggle
    Then I see a bordered list of all permission categories
    And each row shows the resource name on the left and a None/Read/Write menu on the right
    And all resources default to "None"

  # ── Fine-grained permission categories ─────────────────────

  @unit
  Scenario: Permission categories include all platform resources
    Given the permission registry
    When I list the available categories
    Then the categories include:
      | category    | access levels |
      | Traces      | read, write   |
      | Cost        | read          |
      | Scenarios   | read, write   |
      | Annotations | read, write   |
      | Analytics   | read, write   |
      | Evaluations | read, write   |
      | Datasets    | read, write   |
      | Triggers    | read, write   |
      | Workflows   | read, write   |
      | Prompts     | read, write   |
      | Secrets     | read, write   |
      | Audit Log   | read          |
      | Team        | read, write   |
      | Project     | read, write   |

  # Deferred: Gateway permissions (virtualKeys, gatewayBudgets, gatewayProviders,
  # gatewayGuardrails, gatewayCacheRules, gatewayUsage) inherit from the scope's
  # built-in role. Fine-grained gateway control will be added when the gateway UI
  # supports per-key configuration.

  @unit
  Scenario: "read" access maps to view permission
    Given a category "Traces" with "read" selected
    When I compute the backend permissions
    Then the result includes "traces:view"

  @unit
  Scenario: "write" access includes all mutating permissions for that resource
    Given the permission registry
    When I compute "write" permissions for each category
    Then the exact backend permissions are:
      | category    | permissions                                                    |
      | Traces      | traces:view, traces:create, traces:update, traces:share        |
      | Cost        | cost:view                                                      |
      | Scenarios   | scenarios:view, scenarios:manage                               |
      | Annotations | annotations:view, annotations:manage                           |
      | Analytics   | analytics:view, analytics:manage                               |
      | Evaluations | evaluations:view, evaluations:manage                           |
      | Datasets    | datasets:view, datasets:manage                                 |
      | Triggers    | triggers:view, triggers:manage                                 |
      | Workflows   | workflows:view, workflows:manage                               |
      | Prompts     | prompts:view, prompts:manage                                   |
      | Secrets     | secrets:view, secrets:manage                                   |
      | Audit Log   | auditLog:view                                                  |
      | Team        | team:view, team:manage                                         |
      | Project     | project:view, project:create, project:update, project:delete, project:manage |

  @unit
  Scenario: Selecting no categories produces an empty permission set
    Given all categories set to "none"
    When I compute the backend permissions
    Then the result is an empty array

  @unit
  Scenario: selectionsFromPermissions round-trips with computePermissionsFromSelections
    Given a set of category selections with mixed read and write levels
    When I compute permissions and then reverse the mapping
    Then the round-tripped selections match the original

  # ── Ceiling enforcement (disabled permissions) ──────────────

  @integration @unimplemented
  Scenario: Permissions user does not hold appear disabled with lock icon
    Given my role is Member on the current project
    When I select "Restricted" in the permissions toggle
    Then resources I have access to show enabled None/Read/Write menus
    And resources beyond my role show a lock icon and disabled menu
    And hovering the lock shows a tooltip explaining the restriction

  @integration @unimplemented
  Scenario: Viewer sees only None and Read options in menus
    Given my role is Viewer on the current project
    When I select "Restricted" in the permissions toggle
    Then each resource menu offers only "None" and "Read"
    And "Write" is not available in any menu

  @integration @unimplemented
  Scenario: Admin sees None, Read, and Write options for all resources
    Given my role is Admin on the current project
    When I select "Restricted" in the permissions toggle
    Then each resource menu offers "None", "Read", and "Write"

  @unit
  Scenario: "All" mode is bounded by user ceiling
    Given my role is Member on the current project
    When I select "All" permission mode and create the key
    Then the key gets MEMBER-level access, not ADMIN
    And the key cannot perform admin-only operations

  @integration @unimplemented
  Scenario: Changing scope recalculates ceiling and resets out-of-bounds selections
    Given my role is Admin on "Project Alpha" and Viewer on "Team Beta"
    When I select "Restricted" and set Traces to "Write" on Project Alpha
    And I change the scope to "Team Beta"
    Then Traces resets to "None" because Write exceeds my Viewer ceiling on Team Beta

  @integration @unimplemented
  Scenario: Service key bypasses creator ceiling
    Given I am an organization admin
    When I create a service key with "Restricted" permissions
    Then all resource menus offer None, Read, and Write regardless of my personal role

  # ── Create flow ─────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Creating key with default settings produces project-scoped full-access key
    When I open the create drawer
    And I fill in only the name
    And I click "Create secret key"
    Then the key is created with scope "This Project" and permission mode "All"
    And a single ADMIN role binding is created at the current project

  @integration @unimplemented
  Scenario: Creating key with restricted permissions stores a CustomRole
    When I select "Restricted" and set Traces to "Read" and Annotations to "Write"
    And I click "Create secret key"
    Then the key is created with a CustomRole containing ["annotations:manage", "annotations:view", "traces:view"]
    And the role binding uses role CUSTOM with that CustomRole

  @integration @unimplemented
  Scenario: At least one permission must be selected for restricted keys
    When I select "Restricted" but leave all resources at "None"
    And I click "Create secret key"
    Then the Create button is disabled
    And no key is created

  # ── Edit flow ───────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Edit drawer pre-populates scope from existing binding
    Given I have an API key scoped to a team
    When I open the edit drawer
    Then the "This team" pill is selected in the scope picker

  @integration @unimplemented
  Scenario: Edit drawer pre-populates fine-grained permissions from CustomRole
    Given I have a restricted API key with permissions ["traces:view", "datasets:view", "datasets:manage"]
    When I open the edit drawer
    Then "Restricted" is selected
    And Traces shows "Read" in its menu
    And Datasets shows "Write" in its menu
    And other resources show "None"

  @integration @unimplemented
  Scenario: Changing scope on edit updates the role binding
    Given I have an API key scoped to "This Project"
    When I open the edit drawer and change scope to "This Team"
    And I click Save
    Then the role binding scope changes from PROJECT to TEAM

  @integration @unimplemented
  Scenario: Changing from All to Restricted on edit starts with all permissions at max level
    Given I have an API key with "All" permissions
    When I open the edit drawer and switch to "Restricted"
    Then all resource menus start at their maximum allowed level (Write or Read)
    And I can downgrade individual resources to None

  # ── Table display ───────────────────────────────────────────

  @integration @unimplemented
  Scenario: Table shows scope badge and permission summary
    Given I have API keys with different scopes and permissions
    When I view the API keys table
    Then each key shows a scope badge (Organization/Team/Project with colored chip)
    And the permissions column shows "All" or a count of granted categories

  @unit
  Scenario: permissionsSummary formats "All" for full-access keys
    Given a key with permissionMode "all"
    When I compute the permissions summary
    Then the result is "All"

  @unit
  Scenario: permissionsSummary counts granted categories for restricted keys
    Given a key with 3 permission categories granted
    When I compute the permissions summary
    Then the result is "3 of 14 permissions"

  @unit
  Scenario: scopeLabel formats project scope correctly
    Given a role binding with scopeType PROJECT and scopeId matching "My Project"
    When I compute the scope label
    Then the result is "Project: My Project"

  @unit
  Scenario: scopeLabel formats organization scope correctly
    Given a role binding with scopeType ORGANIZATION
    When I compute the scope label
    Then the result is "Organization"

  # ── Backward compatibility ──────────────────────────────────

  @integration @unimplemented
  Scenario: Existing keys with ADMIN bindings display as "All" permissions
    Given an API key was created with the old UI having ADMIN role bindings
    When I view the API keys table
    Then the permissions column shows "All"

  @integration @unimplemented
  Scenario: Existing keys with VIEWER bindings display as restricted read-only
    Given an API key has VIEWER role bindings from the old UI
    When I open the edit drawer
    Then it shows "Restricted" with all resources set to "Read"

  @integration @unimplemented
  Scenario: Existing keys with MEMBER bindings display as restricted with member-level permissions
    Given an API key has MEMBER role bindings from the old UI
    When I open the edit drawer
    Then it shows "Restricted" with member-level resources at their appropriate levels
    And admin-only resources show "None"

  @integration @unimplemented
  Scenario: Existing readonly keys display as restricted with read permissions
    Given an API key was created with the old "readonly" permission mode
    When I open the edit drawer
    Then it shows "Restricted" with all resources set to "Read"

  @integration @unimplemented
  Scenario: Existing multi-scope keys display all scopes in picker
    Given an API key has role bindings at multiple scopes from the old UI
    When I open the edit drawer
    Then the scope picker shows all existing scope bindings

  # ── Backend validation ──────────────────────────────────────

  @unit
  Scenario: Service rejects permissions above creator ceiling
    Given a Member user tries to create a key with "secrets:manage"
    When the create request is processed
    Then the service returns a permission denied error
    And no key is created

  @unit
  Scenario: Service validates scope belongs to organization
    Given a user tries to create a key scoped to a project in another organization
    When the create request is processed
    Then the service returns a scope violation error

  @unit
  Scenario: Service stores CustomRole permissions as sorted array
    Given a user creates a restricted key with permissions in arbitrary order
    When the key is persisted
    Then the CustomRole permissions array is sorted alphabetically

  # ── CustomRole creation (restricted flow) ──────────────────

  @unit
  Scenario: Creating a restricted key creates a CustomRole and links it to bindings
    When I create a restricted key with permissions ["traces:view", "annotations:manage"]
    Then the router creates a CustomRole with those permissions
    And each CUSTOM role binding receives that CustomRole's id

  @unit
  Scenario: Updating a key from All to Restricted upserts a CustomRole
    Given an API key with "All" permissions
    When I switch it to "Restricted" with specific permissions and save
    Then the router upserts a CustomRole for this key
    And the bindings are recreated with the CustomRole id

  @unit
  Scenario: Restricted key with camelCase permissions saves without error
    When I create a restricted key with permissions including "auditLog:view"
    Then the CustomRole is created successfully
    And the permission schema accepts the camelCase resource name

  @unit
  Scenario: All computed permission strings pass the CustomRole schema
    Given every permission category at its maximum access level
    When I compute the backend permissions for each category
    Then every permission string matches the CustomRole schema regex
