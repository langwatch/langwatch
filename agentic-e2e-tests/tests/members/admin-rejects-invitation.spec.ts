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
  withEnterpriseLicense,
} from "./steps";

/**
 * Feature: Invitation Approval Workflow
 * Source: specs/members/update-pending-invitation.feature
 *
 * Scenario: Admin rejects an invitation request (lines 36-42)
 */
test.describe("Invitation Approval - Admin Rejects Request", () => {
  // Member-invitation requires an org plan with maxMembers>=2. A no-license
  // self-hosted org resolves to FREE_PLAN (maxMembers=1), so createInviteRequest
  // 403s. withEnterpriseLicense() activates a test ENTERPRISE license
  // (maxMembers=100) before each test and removes it after, scoping the raised
  // cap to this suite. See tests/license.fixture.ts. (#1802)
  withEnterpriseLicense();
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
