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
  // Member-invitation requires an org plan with maxMembers>=2. auth.setup.ts
  // activates a test ENTERPRISE license (maxMembers=100) for the org so these
  // run in self-hosted CI, where a no-license org otherwise resolves to
  // FREE_PLAN (maxMembers=1) and createInviteRequest 403s. See
  // tests/license.fixture.ts. (#1811)
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
