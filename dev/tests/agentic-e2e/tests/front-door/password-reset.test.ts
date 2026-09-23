import type * as testModule from "@playwright/test";

import { findUserIdByEmail } from "./db";
/**
 * Feature: Forgot/reset password on credential sign-in
 * (specs/auth/password-reset.feature). Bug-bash #8: a completed reset
 * shows "Continue" (signs in) and an "Add a passkey" action in place.
 */
import { expect, test } from "./fixtures";
import { closeRedis, findPasswordResetToken } from "./redis";
import {
  betterAuthRequestHeaders,
  FRONT_DOOR_PASSWORD,
  generateFrontDoorEmail,
  givenARegisteredAccount,
  whenISignOut,
} from "./steps";
import { addVirtualAuthenticator, removeVirtualAuthenticator } from "./webauthn";

test.use({ storageState: { cookies: [], origins: [] } });

test.afterAll(async () => {
  await closeRedis();
});

async function requestResetToken(page: testModule.Page, email: string): Promise<string> {
  const userId = await findUserIdByEmail(email);
  if (!userId) {
    throw new Error(`No account in Postgres for ${email} to request a reset for`);
  }
  const response = await page.request.post("/api/auth/request-password-reset", {
    headers: betterAuthRequestHeaders(),
    data: { email, redirectTo: "/auth/reset-password" },
  });
  if (!response.ok()) {
    throw new Error(
      `request-password-reset failed: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }

  const deadline = Date.now() + 10000;
  for (;;) {
    const token = await findPasswordResetToken(userId);
    if (token) return token;
    if (Date.now() > deadline) {
      throw new Error(`No password-reset token appeared in Redis for ${email} within 10s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.describe("Password reset completion", () => {
  /**
   * Scenario: Submitting a valid new password with a token resets it and
   * signs me in
   * Source: password-reset.feature lines 101-106
   *
   * Scenario: A completed reset offers a passkey rather than assuming one
   * Source: password-reset.feature lines 186-191
   *
   * Scenario: Accepting the offer adds the passkey on this screen
   * Source: password-reset.feature lines 200-206
   *
   * Scenario: A user who forgot their password resets it and signs in with
   * the new one
   * Source: password-reset.feature lines 223-228 (retagged from
   * `@e2e @unimplemented` — see the feature-file diff in this change; this is
   * the DB-token harness its own comment said did not exist yet)
   */
  // @scenario "Submitting a valid new password with a token resets it and signs me in"
  // @scenario "A completed reset offers a passkey rather than assuming one"
  // @scenario "Accepting the offer adds the passkey on this screen"
  // @scenario "A user who forgot their password resets it and signs in with the new one"
  test("a completed reset shows Continue and lets me add a passkey in place", async ({ page }) => {
    const email = generateFrontDoorEmail("reset");
    const oldPassword = FRONT_DOOR_PASSWORD;
    const newPassword = "FrontDoorTestNew456!";
    await givenARegisteredAccount(page, { email, password: oldPassword });

    const token = await requestResetToken(page, email);

    const authenticator = await addVirtualAuthenticator(page);
    try {
      await page.goto(`/auth/reset-password?token=${encodeURIComponent(token)}`);
      await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm password", { exact: true }).fill(newPassword);
      await page.getByRole("button", { name: "Reset password", exact: true }).click();

      await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible({
        timeout: 10000,
      });

      // "Continue" — signs the device in. The reset endpoint's after-hook
      // already opened the session; this is a plain navigation, not a second
      // credential check.
      const continueLink = page.getByTestId("reset-sign-in");
      await expect(continueLink).toHaveText("Continue");

      // "Add a passkey" starts the ceremony IN PLACE, on this same card —
      // no navigation to settings first.
      await page.getByTestId("reset-add-passkey").click();
      await expect(page.getByTestId("reset-passkey-ceremony-title")).toBeVisible();
      await expect(page.getByTestId("reset-passkey-added")).toBeVisible({
        timeout: 15000,
      });

      // The way on is still there throughout, exactly as the spec requires.
      await expect(continueLink).toBeVisible();
      await continueLink.click();
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
        timeout: 15000,
      });

      // Checked at the credential endpoint, not the sign-in screen: this
      // account now holds a passkey, so the screen ASKS for it instead of
      // showing a password box. The endpoint is what both passwords are
      // actually checked against, whichever door leads to it.
      await whenISignOut(page);
      const withOld = await page.request.post("/api/auth/sign-in/email", {
        headers: betterAuthRequestHeaders(),
        data: { email, password: oldPassword },
      });
      expect(withOld.ok(), "the old password is refused").toBe(false);
      const withNew = await page.request.post("/api/auth/sign-in/email", {
        headers: betterAuthRequestHeaders(),
        data: { email, password: newPassword },
      });
      expect(
        withNew.ok(),
        `the new password signs in: ${withNew.status()} ${(await withNew.text()).slice(0, 200)}`,
      ).toBe(true);
    } finally {
      await removeVirtualAuthenticator(authenticator);
    }
  });
});
