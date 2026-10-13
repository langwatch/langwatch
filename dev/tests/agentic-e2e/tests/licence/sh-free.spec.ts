import { requireDeploymentMode } from "../deployment-mode.ts";
import { test } from "../test.ts";
import {
  LICENCE_FAMILY,
  givenNoPastedLicence,
  thenEveryFeatureRefuses,
  thenUploadIsRefused,
} from "./licence-family.ts";

/** Feature: Licence journeys on a self-hosted stack (specs/e2e/licence-journeys.feature). */
test.describe("Licence journeys on sh-free", () => {
  test.beforeEach(async ({ page }) => {
    requireDeploymentMode({ mode: "sh-free" });
    await givenNoPastedLicence({ page });
  });

  /** @scenario "Every enterprise feature is mounted and refuses an organization without a licence" */
  test("every enterprise feature refuses without a licence", async ({ page }) => {
    await thenEveryFeatureRefuses({ page });
  });

  /** @scenario "A forged licence does not unlock an unlicensed stack" */
  test("a forged licence does not unlock the stack", async ({ page }) => {
    await thenUploadIsRefused({
      page,
      licenseKey: LICENCE_FAMILY.otherKey,
      code: "license_key_invalid",
    });
    await thenUploadIsRefused({
      page,
      licenseKey: LICENCE_FAMILY.raisedSeats,
      code: "license_key_invalid",
    });
    await thenEveryFeatureRefuses({ page });
  });
});
