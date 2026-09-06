Feature: Creating organization invitations
  As an organization admin
  I want to invite people, singly or in batches, with the right roles
  So that my team gets in without surprises

  # The invitation LIFECYCLE - states, expiry, identifier-aware acceptance,
  # one-click resend, revocation, the acceptance claims - lives in
  # specs/identity/resilient-invitations.feature (D11). This file keeps what
  # is specific to CREATING invitations from the members surface.
  #
  # Retired 2026-08-24 (D11, epic Q13): the member-approval workflow
  # (WAITING_APPROVAL - members requesting invitations for admins to
  # approve or reject) is deleted end to end; D12's join requests carry the
  # member-wants-a-colleague-in motivation from the joiner's side. Existing
  # WAITING_APPROVAL rows were migrated to REVOKED.

  # Exercised by the Playwright e2e specs under
  # tests/agentic-e2e/tests/members/*.spec.ts, which RUN and PASS in CI
  # (#1802) but sit outside check-feature-parity's scan, so the scenario
  # keeps @unimplemented (extending the checker is a follow-up).
  @e2e @unimplemented
  Scenario: Admin creates an immediate invite
    Given I am logged in as an "ADMIN"
    And I am on the members page
    When I invite "direct@example.com" with role "MEMBER"
    Then I see a success message "Invitations sent"
    And the invitation for "direct@example.com" appears in the "Invites" list with an "Invited" badge

  @integration
  Scenario: Admin batch invite creates all records before sending any emails
    Given I am authenticated as an "ADMIN" of the organization
    When I invite multiple users in a single batch
    Then all invite records are created atomically
    And emails are sent only after all records are persisted
