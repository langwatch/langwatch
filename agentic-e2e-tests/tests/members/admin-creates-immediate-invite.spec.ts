import { test } from "@playwright/test";
import {
  givenIAmOnTheMembersPage,
  whenIClickAddMembers,
  whenIFillEmailWith,
  whenIClickCreateInvites,
  whenICloseInviteLinkDialog,
  thenISeeSentInviteFor,
  thenISeeSuccessToast,
  generateUniqueEmail,
} from "./steps";

/**
 * Feature: Invitation Approval Workflow
 * Source: specs/members/update-pending-invitation.feature
 *
 * Scenario: Admin creates an immediate invite (lines 19-24)
 */
test.describe("Invitation Approval - Admin Creates Immediate Invite", () => {
  // fixme(#1811): the member-invitation flow needs an org plan with maxMembers>=2,
  // but free-tier self-hosted CI has no license, so the plan resolves to FREE_PLAN
  // (maxMembers=1) — the org owner alone is already at the cap and
  // createInviteRequest 403s "maximum number of team members" (verified via
  // licenseEnforcement.checkLimit: current=1, max=1). Re-enable once the CI test
  // org is provisioned a license/subscription that raises the member cap.
  test.fixme();
  /**
   * Scenario: Admin creates an immediate invite
   * Source: update-pending-invitation.feature lines 19-24
   */
  test("admin invites a new member directly", async ({ page }) => {
    const email = generateUniqueEmail("direct");

    await givenIAmOnTheMembersPage(page);
    await whenIClickAddMembers(page);
    await whenIFillEmailWith(page, email);
    await whenIClickCreateInvites(page);
    await thenISeeSuccessToast(page, "Invite created successfully");
    await whenICloseInviteLinkDialog(page);
    await thenISeeSentInviteFor(page, email);
  });
});
