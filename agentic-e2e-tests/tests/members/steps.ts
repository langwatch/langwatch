/**
 * Step definitions for Invitation Approval Workflow tests
 *
 * Source: specs/members/update-pending-invitation.feature
 *
 * Usage: Import and compose these steps in test files to create
 * readable tests that map directly to feature specifications.
 */
import { Page, expect } from "@playwright/test";

// =============================================================================
// Navigation Steps
// =============================================================================

/**
 * Navigate to the members settings page and wait for it to load.
 * Extracts the org slug from the Home link to build the URL.
 */
export async function givenIAmOnTheMembersPage(page: Page) {
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/auth\//);

  // Extract org slug from the Home link
  const homeLink = page.getByRole("link", { name: "Home", exact: true });
  await expect(homeLink).toBeVisible({ timeout: 30000 });
  const href = await homeLink.getAttribute("href");
  const projectSlug = href?.replace(/^\//, "") || "";

  if (!projectSlug) {
    throw new Error("Could not extract project slug from Home link");
  }

  // Navigate to settings/members using the org context
  await page.goto(`/${projectSlug}/settings/members`);
  await expect(
    page.getByRole("heading", { name: "Organization Members" })
  ).toBeVisible({ timeout: 15000 });
}

// =============================================================================
// Add Members Dialog Steps
// =============================================================================

/**
 * Click the "Add members" button and wait for the dialog to appear.
 */
export async function whenIClickAddMembers(page: Page) {
  await page.getByRole("button", { name: /Add members/i }).click();
  // Wait for dialog - use last() for Chakra UI duplicate rendering
  await expect(
    page.getByRole("heading", { name: "Add members" }).last()
  ).toBeVisible({ timeout: 5000 });
}

/**
 * Fill the email input field in the Add Members dialog.
 */
export async function whenIFillEmailWith(page: Page, email: string) {
  await page.getByPlaceholder("Enter email address").last().fill(email);
}

/**
 * Click the submit button in the Add Members dialog.
 * Button reads "Create invites" when no email provider is configured.
 */
export async function whenIClickCreateInvites(page: Page) {
  await page
    .getByRole("button", { name: /Create invites|Send invites/i })
    .last()
    .click();
}

/**
 * Close the invite link dialog if it appears.
 * Shows when no email provider is configured after admin invite.
 */
export async function whenICloseInviteLinkDialog(page: Page) {
  const inviteLinkHeading = page.getByRole("heading", {
    name: "Invite Link",
  });
  const isVisible = await inviteLinkHeading
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  if (isVisible) {
    // Close the dialog
    await page
      .locator('[role="dialog"]')
      .last()
      .getByRole("button", { name: /close/i })
      .click();
    await expect(inviteLinkHeading).not.toBeVisible({ timeout: 3000 });
  }
}

// =============================================================================
// Pending Approval Action Steps
// =============================================================================

/**
 * Approve the invitation for a given email in the Pending Approval section.
 */
export async function whenIApproveInvitationFor(page: Page, email: string) {
  const row = page
    .getByRole("row")
    .filter({ hasText: email });
  await row.getByRole("button", { name: /approve/i }).click();
}

/**
 * Reject the invitation for a given email in the Pending Approval section.
 */
export async function whenIRejectInvitationFor(page: Page, email: string) {
  const row = page
    .getByRole("row")
    .filter({ hasText: email });
  await row.getByRole("button", { name: /reject/i }).click();
}

// =============================================================================
// Assertion Steps
// =============================================================================

/**
 * Assert that an email appears in the "Sent Invites" section.
 */
export async function thenISeeSentInviteFor(page: Page, email: string) {
  // Find the Sent Invites heading, then look for the email in the table below it
  const sentInvitesHeading = page.getByRole("heading", {
    name: "Sent Invites",
  });
  await expect(sentInvitesHeading).toBeVisible({ timeout: 10000 });

  // The email should appear in a row within the Sent Invites section
  await expect(page.getByText(email)).toBeVisible({ timeout: 5000 });
}

/**
 * Assert that an email appears in the "Pending Approval" section.
 */
export async function thenISeePendingApprovalFor(page: Page, email: string) {
  const pendingHeading = page.getByRole("heading", {
    name: "Pending Approval",
  });
  await expect(pendingHeading).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(email)).toBeVisible({ timeout: 5000 });
}

/**
 * Assert that an email does NOT appear anywhere on the page.
 */
export async function thenEmailIsNotVisible(page: Page, email: string) {
  await expect(page.getByText(email)).not.toBeVisible({ timeout: 5000 });
}

/**
 * Assert that a success toast with the given title text appears.
 */
export async function thenISeeSuccessToast(page: Page, titleText: string) {
  await expect(page.getByText(titleText, { exact: false })).toBeVisible({
    timeout: 5000,
  });
}

/**
 * Assert that the Pending Approval section is NOT visible.
 */
export async function thenPendingApprovalSectionIsHidden(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Pending Approval" })
  ).not.toBeVisible({ timeout: 5000 });
}

// =============================================================================
// Seeding Steps
// =============================================================================

/**
 * Extract the organization ID and team ID from the page context.
 * Navigates to the app and reads them from the page's state.
 */
export async function getOrgAndTeamIds(page: Page): Promise<{
  organizationId: string;
  teamId: string;
}> {
  // Navigate to the home page and extract org info from the URL/page state
  await page.goto("/");
  const homeLink = page.getByRole("link", { name: "Home", exact: true });
  await expect(homeLink).toBeVisible({ timeout: 30000 });

  // Use the settings API to get org data
  const orgData = await page.evaluate(async () => {
    const response = await fetch("/api/trpc/organization.getAll");
    const json = await response.json();
    // tRPC wraps the result
    const orgs = (json as any)?.result?.data?.json ?? (json as any)?.result?.data ?? [];
    if (orgs.length === 0) throw new Error("No organizations found");
    const org = orgs[0];
    return {
      organizationId: org.id,
      teamId: org.teams?.[0]?.id ?? "",
    };
  });

  if (!orgData.organizationId || !orgData.teamId) {
    throw new Error(
      `Could not extract org/team IDs: ${JSON.stringify(orgData)}`
    );
  }

  return orgData;
}

/**
 * Create a WAITING_APPROVAL invitation via tRPC API.
 */
export async function seedWaitingApprovalInvite(
  page: Page,
  email: string,
  organizationId: string,
  teamId: string
) {
  const response = await page.request.post(
    "/api/trpc/organization.createInviteRequest",
    {
      data: {
        json: {
          organizationId,
          invites: [
            {
              email: email.toLowerCase(),
              role: "MEMBER",
              teams: [
                {
                  teamId,
                  role: "MEMBER",
                  customRoleId: null,
                },
              ],
            },
          ],
        },
      },
    }
  );

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to seed invite for ${email}: ${response.status()} ${body}`);
  }
}

/**
 * Generate a unique email to avoid duplicate conflicts between test runs.
 */
export function generateUniqueEmail(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `${prefix}-${timestamp}-${random}@example.com`;
}
