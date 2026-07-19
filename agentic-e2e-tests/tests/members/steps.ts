/**
 * Step definitions for Invitation Approval Workflow tests
 *
 * Source: specs/members/update-pending-invitation.feature
 *
 * Usage: Import and compose these steps in test files to create
 * readable tests that map directly to feature specifications.
 */
import { Page, expect, test } from "@playwright/test";

import { E2E_ENTERPRISE_LICENSE_KEY } from "../license.fixture";

// =============================================================================
// Navigation Steps
// =============================================================================

/**
 * Navigate to the members settings page and wait for it to load.
 * Extracts the org slug from the Home link to build the URL.
 */
export async function givenIAmOnTheMembersPage(page: Page) {
  // Members settings is org-scoped at /settings/members (resolved via the
  // session's active org), not project-prefixed — every app nav link uses this
  // exact href (see langwatch/src/routes.tsx). The org context comes from the
  // authenticated session, not the URL.
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
  // The Add-members dialog uses a single comma/space-separated email input whose
  // placeholder is an example list ("alice@example.com, bob@example.com") — see
  // langwatch/src/components/AddMembersForm.tsx. Match it by a stable substring.
  await page.getByPlaceholder(/alice@example\.com/i).last().fill(email);
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
  // The invite-link dialog appears when no email provider is configured. Match
  // it by role+name (a single element) rather than by heading: the title
  // renders two nested "Invite Link" headings (Dialog.Title > Heading), so a
  // heading locator is a strict-mode multiple match that throws. Closing it is
  // required — while open, the modal makes the underlying Invites table inert,
  // so the "Invited" row is not visible to later assertions.
  const dialog = page.getByRole("dialog", { name: "Invite Link" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /close/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
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
  await expect(page.getByText(titleText, { exact: false })).toBeVisible({
    timeout: 5000,
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
  // Use page.request (not page.evaluate(fetch(...))): the Playwright request
  // context resolves this relative URL against baseURL and carries the auth
  // cookies, whereas an in-page fetch on a blank/unnavigated page throws
  // "Failed to parse URL". Mirrors getProjectSlug and the batched tRPC shape.
  const response = await page.request.get(
    "/api/trpc/organization.getAll?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );
  const json = (await response.json().catch(() => null)) as {
    "0"?: {
      result?: {
        data?: {
          json?: Array<{ id: string; teams?: Array<{ id: string }> }>;
        };
      };
    };
  } | null;
  const org = (json?.["0"]?.result?.data?.json ?? [])[0];
  if (!org?.id || !org.teams?.[0]?.id) {
    throw new Error(
      `Could not extract org/team IDs (status ${response.status()}): ${JSON.stringify(
        json,
      ).slice(0, 300)}`,
    );
  }
  return { organizationId: org.id, teamId: org.teams[0].id };
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
              // Omit customRoleId entirely: the createInviteRequest schema types
              // it as z.string().optional() (organization.ts), so a literal null
              // fails validation with "Expected string, received null".
              teams: [
                {
                  teamId,
                  role: "MEMBER",
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

// =============================================================================
// License Scoping
// =============================================================================

/**
 * Activate a test ENTERPRISE license (maxMembers=100) for the current org.
 *
 * A no-license self-hosted deployment resolves to FREE_PLAN (maxMembers=1), so
 * the owner alone is at the cap and createInviteRequest 403s. The app trusts
 * this test-signed license because e2e-ci sets LANGWATCH_LICENSE_PUBLIC_KEY to
 * the matching TEST_PUBLIC_KEY; getActivePlan re-reads the org's license from
 * Postgres on every call, so activation takes effect with no app restart.
 */
export async function activateEnterpriseLicense(page: Page): Promise<void> {
  const { organizationId } = await getOrgAndTeamIds(page);
  const response = await page.request.post("/api/trpc/license.upload?batch=1", {
    data: {
      "0": { json: { organizationId, licenseKey: E2E_ENTERPRISE_LICENSE_KEY } },
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok() || result?.["0"]?.error) {
    throw new Error(
      `license.upload failed: ${response.status()} ${JSON.stringify(
        result,
      ).slice(0, 500)}`,
    );
  }
}

/**
 * Remove the org's license, restoring the plan to FREE_PLAN so the shared org
 * does not leak an ENTERPRISE cap into other suites (e.g.
 * settings/plans-comparison asserts the Free plan is current). Mirrors
 * activateEnterpriseLicense's error handling: under sequential execution a
 * SILENT failure here would strand the shared singleton org on ENTERPRISE for
 * the rest of the run and surface as a far-removed flake, so we throw at the
 * point of cause.
 *
 * NOTE: activation also create-if-absent provisions org-level retention-policy
 * rows (provisionMissingRetentionPolicies); removeLicense does not revert those.
 * Harmless today (no e2e spec asserts retention state) — it's the plan/cap that
 * is scoped, not every activation side effect.
 */
export async function removeEnterpriseLicense(page: Page): Promise<void> {
  const { organizationId } = await getOrgAndTeamIds(page);
  const response = await page.request.post("/api/trpc/license.remove?batch=1", {
    data: { "0": { json: { organizationId } } },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok() || result?.["0"]?.error) {
    throw new Error(
      `license.remove failed: ${response.status()} ${JSON.stringify(
        result,
      ).slice(0, 500)}`,
    );
  }
}

/**
 * Registers per-test hooks that activate an ENTERPRISE license before each test
 * and remove it after — scoping the raised member cap to the members suite so
 * the shared test org returns to FREE_PLAN for every other suite.
 *
 * SAFE ONLY under sequential execution (playwright.config.ts:
 * fullyParallel:false, workers:1). The test org is a shared singleton, so with
 * parallel workers a concurrent test could observe it mid-ENTERPRISE-window;
 * raising CI parallelism would require moving this to an isolated per-test org.
 */
export function withEnterpriseLicense(): void {
  test.beforeEach(async ({ page }) => {
    await activateEnterpriseLicense(page);
  });
  test.afterEach(async ({ page }) => {
    await removeEnterpriseLicense(page);
  });
}
