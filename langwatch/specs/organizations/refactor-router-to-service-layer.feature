Feature: Organization router delegates to service and repository layers
  As a developer
  I want the organization tRPC router to delegate business logic to OrganizationService
  So that data access and business rules are separated from the transport layer

  Background:
    Given the organization module follows the app-layer pattern
    And OrganizationService is injected via getApp().organizations
    And OrganizationRepository defines the data access interface

  # --- Design decisions (from challenge review) ---
  # 1. Transaction atomicity: complex multi-step operations are single repository
  #    methods that use $transaction internally (unit-of-work pattern).
  # 2. Invite procedures: router calls InviteService directly, no OrganizationService
  #    intermediary. InviteService already owns this domain.
  # 3. Decryption: stays in the router as a presentation transform. Service returns
  #    raw (encrypted) records; router decrypts before sending to client.
  # 4. PlanProvider: injected into OrganizationService via constructor for testability.
  # 5. computeEffectiveTeamRoleUpdates: pure function stays in current location.

  # --- Org creation ---

  @integration
  Scenario: Creating an organization delegates to the service
    When a user calls createAndAssign with an org name
    Then OrganizationService.createAndAssign handles org, team, and membership creation atomically
    And the router returns the org and team identifiers
    And usage stats are scheduled for the new organization

  # --- Org queries ---

  @integration
  Scenario: Fetching all organizations delegates to the service
    When a user calls getAll
    Then OrganizationService.getAllForUser returns fully loaded organizations
    And the router decrypts encrypted fields before returning

  @integration
  Scenario: Fetching organization with members delegates to the service
    When a user calls getOrganizationWithMembersAndTheirTeams
    Then OrganizationService returns the organization with nested member and team data

  @integration
  Scenario: Fetching a single member delegates to the service
    When a user calls getMemberById
    Then OrganizationService returns the member with their team memberships

  @integration
  Scenario: Listing all organization members delegates to the service
    When a user calls getAllOrganizationMembers
    Then OrganizationService returns active users in the organization

  # --- Org updates ---

  @integration
  Scenario: Updating organization settings delegates to the service
    When a user calls update with new org settings
    Then OrganizationService.update persists the changes with encrypted fields
    And the router triggers elasticsearch migration when ES credentials change

  # --- Member management ---

  @integration
  Scenario: Removing a member delegates to the service
    When a user calls deleteMember for another user
    Then OrganizationService removes the org and team memberships atomically

  @integration
  Scenario: Updating a member role delegates to the service
    When a user calls updateMemberRole with a new role
    Then OrganizationService handles role change, license checks, and team role cascading in one transaction

  @integration
  Scenario: Updating a team member role delegates to the service
    When a user calls updateTeamMemberRole
    Then OrganizationService handles the team role update with admin guard atomically

  # --- Invites (router -> InviteService directly) ---

  @integration
  Scenario: Creating invites uses InviteService directly
    When a user calls createInvites
    Then the router validates input and delegates to InviteService
    And license limit errors are mapped to TRPCError

  @integration
  Scenario: Creating invite requests uses InviteService directly
    When a user calls createInviteRequest
    Then the router validates and delegates to InviteService

  @integration
  Scenario: Approving an invite uses InviteService directly
    When a user calls approveInvite
    Then the router re-validates limits and delegates to InviteService

  @integration
  Scenario: Accepting an invite uses InviteService directly
    When a user calls acceptInvite
    Then the router delegates membership creation to InviteService

  @integration
  Scenario: Deleting an invite delegates to the repository
    When a user calls deleteInvite
    Then OrganizationRepository removes the invite record

  @integration
  Scenario: Fetching pending invites delegates to the repository
    When a user calls getOrganizationPendingInvites
    Then OrganizationRepository returns non-expired pending invites

  # --- Audit logs ---

  @integration
  Scenario: Fetching audit logs delegates to the service
    When a user calls getAuditLogs
    Then OrganizationService returns paginated, enriched audit log entries

  # --- Architectural constraints ---

  @unit
  Scenario: Router contains no direct Prisma calls for non-invite procedures
    Given the refactored organization router
    Then non-invite procedure bodies do not reference ctx.prisma directly
    And all data access goes through OrganizationService or InviteService

  @unit
  Scenario: Existing integration tests continue to pass
    Given the existing organization integration tests
    When the test suite runs
    Then all tests pass without modification

  @unit
  Scenario: New service methods have unit tests
    Given the extended OrganizationService
    Then each new public method has a corresponding unit test
    And unit tests mock the repository interface
