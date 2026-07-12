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
  // Member-invitation requires an org plan with maxMembers>=2. auth.setup.ts
  // activates a test ENTERPRISE license (maxMembers=100) for the org so these
  // run in self-hosted CI, where a no-license org otherwise resolves to
  // FREE_PLAN (maxMembers=1) and createInviteRequest 403s. See
  // tests/license.fixture.ts. (#1811)
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
