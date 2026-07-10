import { test } from "@playwright/test";
import {
  givenIAmOnTheMembersPage,
  whenIRejectInvitationFor,
  thenISeePendingApprovalFor,
  thenISeeSuccessToast,
  thenEmailIsNotVisible,
  seedWaitingApprovalInvite,
  getOrgAndTeamIds,
  generateUniqueEmail,
} from "./steps";

/**
 * Feature: Invitation Approval Workflow
 * Source: specs/members/update-pending-invitation.feature
 *
 * Scenario: Admin rejects an invitation request (lines 36-42)
 */
test.describe("Invitation Approval - Admin Rejects Request", () => {
  // fixme(#1811): the member-invitation flow needs an org plan with maxMembers>=2,
  // but free-tier self-hosted CI has no license, so the plan resolves to FREE_PLAN
  // (maxMembers=1) — the org owner alone is already at the cap and
  // createInviteRequest 403s "maximum number of team members" (verified via
  // licenseEnforcement.checkLimit: current=1, max=1). Re-enable once the CI test
  // org is provisioned a license/subscription that raises the member cap.
  test.fixme();
  /**
   * Scenario: Admin rejects an invitation request
   * Source: update-pending-invitation.feature lines 36-42
   *
   * Workflow test: seeds a WAITING_APPROVAL invite, then rejects it.
   */
  test("admin rejects a pending invitation request", async ({ page }) => {
    const email = generateUniqueEmail("reject");

    // Seed: create a WAITING_APPROVAL invite via API
    const { organizationId, teamId } = await getOrgAndTeamIds(page);
    await seedWaitingApprovalInvite({ page, email, organizationId, teamId });

    // Navigate and verify the invite appears in Invites with Pending Approval badge
    await givenIAmOnTheMembersPage(page);
    await thenISeePendingApprovalFor(page, email);

    // Reject and verify it's removed
    await whenIRejectInvitationFor(page, email);
    await thenISeeSuccessToast(page, "Invitation rejected");
    await thenEmailIsNotVisible(page, email);
  });
});
