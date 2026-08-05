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
  withEnterpriseLicense,
} from "./steps";

/**
 * Feature: Invitation Approval Workflow
 * Source: specs/members/update-pending-invitation.feature
 *
 * Scenario: Admin approves an invitation request (lines 27-33)
 */
test.describe("Invitation Approval - Admin Approves Request", () => {
  // Member-invitation requires an org plan with maxMembers>=2. A no-license
  // self-hosted org resolves to FREE_PLAN (maxMembers=1), so createInviteRequest
  // 403s. withEnterpriseLicense() activates a test ENTERPRISE license
  // (maxMembers=100) before each test and removes it after, scoping the raised
  // cap to this suite. See tests/license.fixture.ts. (#1802)
  withEnterpriseLicense();
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
