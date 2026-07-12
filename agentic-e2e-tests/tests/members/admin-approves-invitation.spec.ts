import { test } from "@playwright/test";
import {
  givenIAmOnTheMembersPage,
  whenIApproveInvitationFor,
  thenISeeSentInviteFor,
  thenISeePendingApprovalFor,
  thenISeeSuccessToast,
  seedWaitingApprovalInvite,
  getOrgAndTeamIds,
  generateUniqueEmail,
} from "./steps";

/**
 * Feature: Invitation Approval Workflow
 * Source: specs/members/update-pending-invitation.feature
 *
 * Scenario: Admin approves an invitation request (lines 27-33)
 */
test.describe("Invitation Approval - Admin Approves Request", () => {
  // Member-invitation requires an org plan with maxMembers>=2. auth.setup.ts
  // activates a test ENTERPRISE license (maxMembers=100) for the org so these
  // run in self-hosted CI, where a no-license org otherwise resolves to
  // FREE_PLAN (maxMembers=1) and createInviteRequest 403s. See
  // tests/license.fixture.ts. (#1811)
  /**
   * Scenario: Admin approves an invitation request
   * Source: update-pending-invitation.feature lines 27-33
   *
   * Workflow test: seeds a WAITING_APPROVAL invite, then approves it.
   */
  test("admin approves a pending invitation request", async ({ page }) => {
    const email = generateUniqueEmail("waiting");

    // Seed: create a WAITING_APPROVAL invite via API
    const { organizationId, teamId } = await getOrgAndTeamIds(page);
    await seedWaitingApprovalInvite({ page, email, organizationId, teamId });

    // Navigate and verify the invite appears in Invites with Pending Approval badge
    await givenIAmOnTheMembersPage(page);
    await thenISeePendingApprovalFor(page, email);

    // Approve and verify it appears with the Invited badge
    await whenIApproveInvitationFor(page, email);
    await thenISeeSuccessToast(page, "Invitation approved");
    await thenISeeSentInviteFor(page, email);
  });
});
