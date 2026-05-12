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

  # KEPT @unimplemented: this scenario depends on
  # enforceLimitByOrganization being added to LicenseEnforcementService
  # (see file-level NOTE above). The notification end-to-end flow for
  # member invites cannot be tested until the wiring exists.
  @unimplemented
  Scenario: Member invite triggers notification when limit reached
    Given the organization has reached the maximum number of full members
    When a user sends an invite for a full member
    Then the invite is rejected
    And a Slack notification is sent to the ops team

  # KEPT @unimplemented: same blocker as preceding scenario.
  @unimplemented
  Scenario: Lite member invite triggers notification when limit reached
    Given the organization has reached the maximum number of lite members
    When a user sends an invite for a lite member
    Then the invite is rejected
    And a Slack notification is sent to the ops team

