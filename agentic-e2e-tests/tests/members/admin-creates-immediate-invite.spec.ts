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
  withEnterpriseLicense,
} from "./steps";

/**
 * Feature: Invitation Approval Workflow
 * Source: specs/members/update-pending-invitation.feature
 *
 * Scenario: Admin creates an immediate invite (lines 19-24)
 */
test.describe("Invitation Approval - Admin Creates Immediate Invite", () => {
  // Member-invitation requires an org plan with maxMembers>=2. A no-license
  // self-hosted org resolves to FREE_PLAN (maxMembers=1), so createInviteRequest
  // 403s. withEnterpriseLicense() activates a test ENTERPRISE license
  // (maxMembers=100) before each test and removes it after, scoping the raised
  // cap to this suite. See tests/license.fixture.ts. (#1802)
  withEnterpriseLicense();
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
