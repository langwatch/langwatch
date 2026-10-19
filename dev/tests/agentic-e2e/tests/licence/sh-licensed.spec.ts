import { requireDeploymentMode } from "../deployment-mode.ts";
import {
  generateUniqueEmail,
  givenIAmOnTheMembersPage,
  thenISeeSuccessToast,
  whenIClickAddMembers,
  whenIClickCreateInvites,
  whenIFillEmailWith,
} from "../members/steps";
import { expect, test } from "../test.ts";
import {
  LICENCE_FAMILY,
  givenLicenceIsInstalled,
  givenNoPastedLicence,
  thenEveryFeatureAnswers,
  thenNoPastedLicence,
  thenUploadIsRefused,
} from "./licence-family.ts";

/** Feature: Licence journeys on a self-hosted stack (specs/e2e/licence-journeys.feature). */
test.describe("Licence journeys on sh-licensed", () => {
  test.beforeEach(async ({ page }) => {
    requireDeploymentMode({ mode: "sh-licensed" });
    await givenNoPastedLicence({ page });
  });
  test.afterEach(async ({ page }) => {
    await givenNoPastedLicence({ page });
  });

  /** @scenario "A configured licence entitles the organization before anything is pasted" */
  test("a configured licence entitles the organization", async ({ page }) => {
    await thenEveryFeatureAnswers({ page });
  });

  /** @scenario "An administrator pastes a valid licence key on the licence page" */
  test("an administrator pastes a valid licence key", async ({ page }) => {
    await page.goto("/settings/license");
    await page.getByText("License key", { exact: true }).click();
    await page.getByTestId("license-key-input").fill(LICENCE_FAMILY.enterprise);
    await page.getByTestId("license-activate").click();
    await expect(page.getByText("Valid", { exact: true })).toBeVisible();
    await expect(page.getByTestId("license-plan")).toContainText("Enterprise");
  });

  /** @scenario "A licence with one payload byte changed is refused" */
  test("a tampered licence is refused", async ({ page }) => {
    await thenUploadIsRefused({
      page,
      licenseKey: LICENCE_FAMILY.tamperedByte,
      code: "license_key_invalid",
    });
    await thenNoPastedLicence({ page });
  });

  /** @scenario "A licence signed by a key the stack does not trust is refused" */
  test("a licence signed by another key is refused", async ({ page }) => {
    await thenUploadIsRefused({
      page,
      licenseKey: LICENCE_FAMILY.otherKey,
      code: "license_key_invalid",
    });
    await thenNoPastedLicence({ page });
  });

  /** @scenario "A licence whose plan was swapped after signing is refused" */
  test("a licence with a swapped plan is refused", async ({ page }) => {
    await thenUploadIsRefused({
      page,
      licenseKey: LICENCE_FAMILY.swappedPlan,
      code: "license_key_invalid",
    });
  });

  /** @scenario "Text that is not a licence is refused" */
  test("text that is not a licence is refused", async ({ page }) => {
    await thenUploadIsRefused({
      page,
      licenseKey: LICENCE_FAMILY.notALicence,
      code: "license_key_invalid",
    });
  });

  /** @scenario "An expired licence is refused on upload" */
  test("an expired licence is refused", async ({ page }) => {
    await thenUploadIsRefused({
      page,
      licenseKey: LICENCE_FAMILY.expired,
      code: "license_expired",
    });
    await thenNoPastedLicence({ page });
  });

  /** @scenario "An invite beyond a one-seat licence is refused, and the same invite succeeds with seats" */
  test("an invite beyond a one-seat licence is refused", async ({ page }) => {
    const email = generateUniqueEmail("licence-seat");
    await givenLicenceIsInstalled({ page, licenseKey: LICENCE_FAMILY.oneSeat });
    await givenIAmOnTheMembersPage(page);
    await whenIClickAddMembers(page);
    await whenIFillEmailWith(page, email);
    const refused = page.waitForResponse((response) => response.url().includes("createInvites"));
    await whenIClickCreateInvites(page);
    const status = (await refused).status();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);

    await givenLicenceIsInstalled({ page, licenseKey: LICENCE_FAMILY.enterprise });
    await givenIAmOnTheMembersPage(page);
    await whenIClickAddMembers(page);
    await whenIFillEmailWith(page, email);
    await whenIClickCreateInvites(page);
    await thenISeeSuccessToast(page, "Invite created successfully");
  });
});
