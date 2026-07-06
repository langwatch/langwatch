/**
 * Step definitions for Invitation Approval Workflow tests
 *
 * Source: specs/members/update-pending-invitation.feature
 *
 * Usage: Import and compose these steps in test files to create
 * readable tests that map directly to feature specifications.
 */
import { Page, expect } from "@playwright/test";


/**
 * Typed shape of the batched tRPC response from organization.getAll.
 * The batch API wraps results under a numeric string key ("0").
 */
type OrgGetAllBatchResponse = {
  "0"?: {
    result?: {
      data?: {
        json?: Array<{
          id: string;
          teams?: Array<{ id: string }>;
        }>;
      };
    };
  };
};

// =============================================================================
// Navigation Steps
// =============================================================================

/**
 * Navigate to the members settings page and wait for it to load.
 * Extracts the org slug from the Home link to build the URL.
 */
export async function givenIAmOnTheMembersPage(page: Page) {
  // The members page lives at /settings/members (src/pages/settings/members.tsx),
  // NOT under /{project}/settings/members — it has no [project] path segment.
  await page.goto(`/settings/members`);
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
  await page.getByPlaceholder("alice@example.com, bob@example.com").last().fill(email);
}

/**
 * Select an organization role from the role dropdown in the Add Members dialog.
 */
export async function whenISelectOrgRole(page: Page, role: string) {
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: role, exact: true }).click();
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
  let isVisible = false;
  try {
    await expect(inviteLinkHeading).toBeVisible({ timeout: 3000 });
    isVisible = true;
  } catch {
    isVisible = false;
  }

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
// Invitation Action Steps
// =============================================================================

/**
 * Approve the invitation for a given email in the Invites table.
 */
export async function whenIApproveInvitationFor(page: Page, email: string) {
  const row = page
    .getByRole("row")
    .filter({ hasText: email });
  await row.getByRole("button", { name: /approve/i }).click();
}

/**
 * Reject the invitation for a given email in the Invites table.
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
 * Assert that an email appears in the "Invites" list with an invited badge.
 */
export async function thenISeeSentInviteFor(page: Page, email: string) {
  const invitesHeading = page.getByRole("heading", { name: "Invites" });
  await expect(invitesHeading).toBeVisible({ timeout: 10000 });

  const invitesSection = invitesHeading.locator("..");
  const row = invitesSection.getByRole("row").filter({ hasText: email });

  await expect(row).toBeVisible({ timeout: 5000 });
  await expect(row.getByText("Invited")).toBeVisible({ timeout: 5000 });
}

/**
 * Assert that an email appears in the "Invites" list with a pending badge.
 */
export async function thenISeePendingApprovalFor(page: Page, email: string) {
  const invitesHeading = page.getByRole("heading", { name: "Invites" });
  await expect(invitesHeading).toBeVisible({ timeout: 10000 });

  const invitesSection = invitesHeading.locator("..");
  const row = invitesSection.getByRole("row").filter({ hasText: email });

  await expect(row).toBeVisible({ timeout: 5000 });
  await expect(row.getByText("Pending Approval")).toBeVisible({
    timeout: 5000,
  });
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
  // 15 s: CI mutation round-trips can be slow; toast appears only after the
  // server responds, and the default 5 s is too tight under load.
  await expect(page.getByText(titleText, { exact: false })).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Assert that the Invites section is NOT visible.
 */
export async function thenPendingApprovalSectionIsHidden(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Invites" })
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
  // Use page.request (same as getProjectSlug in helpers.ts) so this works
  // even before the browser has navigated anywhere — page.evaluate with a
  // relative URL fails on about:blank because there is no base URL.
  const response = await page.request.get(
    "/api/trpc/organization.getAll?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );

  const data = (await response.json().catch(() => null)) as OrgGetAllBatchResponse | null;
  const orgs = data?.["0"]?.result?.data?.json ?? [];

  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error(
      `No organizations found in organization.getAll (status ${response.status()})`,
    );
  }

  const org = orgs[0]!;
  const organizationId = org.id;
  const teamId = org.teams?.[0]?.id ?? "";

  if (!organizationId || !teamId) {
    throw new Error(
      `Could not extract org/team IDs: ${JSON.stringify(org)}`,
    );
  }

  return { organizationId, teamId };
}

/**
 * Purge all PENDING/WAITING_APPROVAL invites for the org before seeding.
 * Required because the CI DB persists across runs (SKIP_PRISMA_MIGRATE=true),
 * so accumulated invites count toward the free plan maxMembers=2 cap and
 * cause 403 FORBIDDEN on subsequent seeding calls.
 */
async function purgeExistingInvites({
  page,
  organizationId,
}: {
  page: Page;
  organizationId: string;
}) {
  const listResponse = await page.request.get(
    "/api/trpc/organization.getOrganizationPendingInvites?batch=1&input=" +
      encodeURIComponent(
        JSON.stringify({ "0": { json: { organizationId } } }),
      ),
  );
  if (!listResponse.ok()) return; // best-effort

  const data = (await listResponse.json().catch(() => null)) as
    | { "0": { result: { data: { json: { id: string }[] } } } }
    | null;
  const invites = data?.["0"]?.result?.data?.json ?? [];

  for (const invite of invites) {
    await page.request.post("/api/trpc/organization.deleteInvite", {
      data: { json: { inviteId: invite.id, organizationId } },
    });
  }
}

/**
 * Create a WAITING_APPROVAL invitation via tRPC API.
 */
export async function seedWaitingApprovalInvite({
  page,
  email,
  organizationId,
  teamId,
}: {
  page: Page;
  email: string;
  organizationId: string;
  teamId: string;
}) {
  // Purge accumulated invites first so we don't hit the free plan member cap.
  await purgeExistingInvites({ page, organizationId });

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
                  // customRoleId omitted — z.string().optional() accepts undefined, not null
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
