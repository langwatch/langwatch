@unit
Feature: Complete notification coverage for all limit enforcement paths

  As a LangWatch ops team member
  I want Slack notifications for every limit-blocked interaction
  So that no customer hitting a limit goes unnoticed regardless of enforcement path

  Background:
    Given an organization "Acme Corp" on the "Launch" plan

  # --- Backend: LicenseEnforcementService gains enforceLimitByOrganization ---
  # enforceLicenseLimit(ctx, projectId, limitType) requires a projectId.
  # Project and team creation don't have a projectId yet.
  # Add enforceLimitByOrganization(organizationId, limitType, user) to
  # LicenseEnforcementService. The existing enforceLicenseLimit middleware
  # resolves projectId -> organizationId then delegates to this method.
  # All limit checks go through the service, not direct Prisma calls.

  Scenario: Project creation triggers notification when limit reached
    Given the organization has reached the maximum number of projects
    When a user creates a new project
    Then the request is rejected with a FORBIDDEN error
    And a Slack notification is sent to the ops team

  Scenario: Team creation triggers notification when limit reached
    Given the organization has reached the maximum number of teams
    When a user creates a new team
    Then the request is rejected with a FORBIDDEN error
    And a Slack notification is sent to the ops team

  # --- Backend: unify member limit errors ---
  # InviteService.checkLicenseLimits throws LicenseLimitError (no current/max).
  # Replace with LimitExceededError so notifyResourceLimitReached has the data.
  # InviteService and LicenseLimitGuard use the repository pattern, not direct Prisma.

  Scenario: Member invite triggers notification when limit reached
    Given the organization has reached the maximum number of full members
    When a user sends an invite for a full member
    Then the invite is rejected
    And a Slack notification is sent to the ops team

  Scenario: Lite member invite triggers notification when limit reached
    Given the organization has reached the maximum number of lite members
    When a user sends an invite for a lite member
    Then the invite is rejected
    And a Slack notification is sent to the ops team

  Scenario: Member role change triggers notification when limit reached
    Given the organization has reached the maximum number of full members
    When a lite member role is changed to full member
    Then the role change is rejected
    And a Slack notification is sent to the ops team

  # --- UI-blocked interactions ---
  # Add reportLimitBlocked mutation on existing licenseEnforcementRouter.
  # It delegates to LicenseEnforcementService to re-verify server-side,
  # then calls notifyResourceLimitReached via getApp().usageLimits.
  # Accepts only { organizationId, limitType } — never trusts client values.
  # useLicenseEnforcement hook calls it fire-and-forget when checkAndProceed blocks.

  Scenario: UI-blocked interaction triggers notification via backend mutation
    Given the organization has reached the maximum number of workflows
    When the UI pre-check blocks a workflow creation
    Then a fire-and-forget notification request is sent to the backend
    And the backend re-verifies the limit server-side before notifying
    And a Slack notification is sent to the ops team

  Scenario: UI notification respects 24-hour cooldown
    Given a resource limit notification was already sent within the last 24 hours
    When the UI pre-check blocks a workflow creation
    And a notification request is sent to the backend
    Then no duplicate Slack notification is sent

  Scenario: UI notification does not trust client-provided values
    Given the organization has NOT reached any limits
    When a fabricated notification request is sent to the backend
    Then the backend verifies the limit is not actually reached
    And no Slack notification is sent

  Scenario: UI notification failure does not affect user experience
    Given the Slack webhook is unreachable
    When the UI pre-check blocks a workflow creation
    And a notification request is sent to the backend
    Then the upgrade modal still appears
    And the failure is captured for observability
