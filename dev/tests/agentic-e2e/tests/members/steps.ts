/**
 * Step definitions for Invitation Approval Workflow tests.
 * Source: specs/members/update-pending-invitation.feature
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
  // exact href. The org context comes from the
  // authenticated session, not the URL.
  //
  // The address is kept rather than updated to `/settings/directory` on
  // purpose: members became the first cut of Directory, and `members.tsx` is
  // now a `<Navigate>` that forwards the old address on. Arriving the way a
  // stale link does is what proves that forward still works, so this step
  // covers the redirect as well as the page it lands on.
  await page.goto(`/settings/members`);
  await expect(page.getByRole("heading", { name: "Organization Members" })).toBeVisible({
    timeout: 15000,
  });
}

// =============================================================================
// Add Members Dialog Steps
// =============================================================================

/**
 * Open the invite drawer from People and wait for it to appear.
 *
 * The trigger is called "Invite people" now, beside the inline invite box that
 * launches the same drawer (`PeopleSection` -> `PeopleHeader`). Only the
 * BUTTON was renamed: the drawer it opens still leads with "Add members",
 * which is what the wait below still keys on.
 */
export async function whenIClickAddMembers(page: Page) {
  await page.getByRole("button", { name: /Invite people/i }).click();
  // Wait for dialog - use last() for Chakra UI duplicate rendering
  await expect(page.getByRole("heading", { name: "Add members" }).last()).toBeVisible({
    timeout: 5000,
  });
}

/**
 * Fill the email input field in the Add Members dialog.
 */
export async function whenIFillEmailWith(page: Page, email: string) {
  // The Add-members dialog uses a single comma/space-separated email input whose
  // placeholder is an example list ("alice@example.com, bob@example.com"). Match
  // it by a stable substring.
  await page
    .getByPlaceholder(/alice@example\.com/i)
    .last()
    .fill(email);
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
  // Matched by role+name, not heading: the title renders two nested "Invite
  // Link" headings, so a heading locator throws (strict-mode multiple
  // match). Must close it — while open, it makes the Invites table inert.
  const dialog = page.getByRole("dialog", { name: "Invite Link" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /close/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  }
}

// =============================================================================
// Assertion Steps
// =============================================================================

/**
 * Assert that the invitation appears in Directory with its pending status.
 */
export async function thenISeeSentInviteFor(page: Page, email: string) {
  const row = page
    .getByTestId("people-list")
    .getByTestId("invite-row")
    .filter({ has: page.getByText(email, { exact: true }) });

  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row.getByTestId("invite-status")).toHaveText("Invited");
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
          json?: { id: string; teams?: { id: string }[] }[];
        };
      };
    };
  } | null;
  const org = (json?.["0"]?.result?.data?.json ?? [])[0];
  if (!org?.id || !org.teams?.[0]?.id) {
    throw new Error(
      `Could not extract org/team IDs (status ${response.status()}): ${JSON.stringify(json).slice(
        0,
        300,
      )}`,
    );
  }
  return { organizationId: org.id, teamId: org.teams[0].id };
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
 * Activates a test ENTERPRISE license (maxMembers=100). Trusted because
 * e2e-ci sets LANGWATCH_LICENSE_PUBLIC_KEY to the matching TEST_PUBLIC_KEY;
 * getActivePlan re-reads Postgres on every call, so no app restart needed.
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
      `license.upload failed: ${response.status()} ${JSON.stringify(result).slice(0, 500)}`,
    );
  }
}

/**
 * Restores FREE_PLAN so the shared singleton org doesn't leak ENTERPRISE
 * into other suites — throws at the point of cause, since silent failure
 * here would surface as a far-removed flake elsewhere.
 */
export async function removeEnterpriseLicense(page: Page): Promise<void> {
  const { organizationId } = await getOrgAndTeamIds(page);
  const response = await page.request.post("/api/trpc/license.remove?batch=1", {
    data: { "0": { json: { organizationId } } },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok() || result?.["0"]?.error) {
    throw new Error(
      `license.remove failed: ${response.status()} ${JSON.stringify(result).slice(0, 500)}`,
    );
  }
}

/**
 * Per-test hooks toggling an ENTERPRISE license. SAFE ONLY under
 * sequential execution (fullyParallel:false, workers:1) — the shared
 * singleton test org could otherwise be observed mid-window.
 */
export function withEnterpriseLicense(): void {
  test.beforeEach(async ({ page }) => {
    await activateEnterpriseLicense(page);
  });
  test.afterEach(async ({ page }) => {
    await removeEnterpriseLicense(page);
  });
}
