/**
 * Feature: Forgot / reset password on credential (email-mode) sign-in
 * Source: specs/auth/password-reset.feature
 *
 * Bug-bash finding covered:
 *   #8 A completed password reset shows "Continue" (which signs the device
 *      in) and an "Add a passkey" action that starts the ceremony in place.
 *
 * CI has no mail provider, so `/auth/forgot-password` itself renders the
 * "cannot send email" card rather than its form (see `signin-basics.test.ts`'s
 * header for the same coupling). The request endpoint still writes its token
 * before it ever tries to send mail — better-auth's own `requestPasswordReset`
 * handler calls `runInBackgroundOrAwait` around `sendResetPassword`, so a
 * down mailer never blocks the response — so this calls that endpoint
 * directly and reads the token back out of where better-auth actually keeps
 * it: Redis, its secondary storage, keyed by the account's id (`redis.ts`).
 */
import { expect, test } from "@playwright/test";
import { findUserIdByEmail } from "./db";
import { closeRedis, findPasswordResetToken } from "./redis";
import { addVirtualAuthenticator, removeVirtualAuthenticator } from "./webauthn";
import {
  betterAuthRequestHeaders,
  FRONT_DOOR_PASSWORD,
  generateFrontDoorEmail,
  givenARegisteredAccount,
  whenISignOut,
} from "./steps";

test.use({ storageState: { cookies: [], origins: [] } });

test.afterAll(async () => {
  await closeRedis();
});

async function requestResetToken(
  page: import("@playwright/test").Page,
  email: string,
): Promise<string> {
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
      throw new Error(
        `No password-reset token appeared in Redis for ${email} within 10s`,
      );
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
  test("a completed reset shows Continue and lets me add a passkey in place", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("reset");
    const oldPassword = FRONT_DOOR_PASSWORD;
    const newPassword = "FrontDoorTestNew456!";
    await givenARegisteredAccount(page, { email, password: oldPassword });

    const token = await requestResetToken(page, email);

    const authenticator = await addVirtualAuthenticator(page);
    try {
      await page.goto(`/auth/reset-password?token=${encodeURIComponent(token)}`);
      await expect(
        page.getByRole("heading", { name: "Choose a new password" }),
      ).toBeVisible();

      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page
        .getByLabel("Confirm password", { exact: true })
        .fill(newPassword);
      await page
        .getByRole("button", { name: "Reset password", exact: true })
        .click();

      await expect(
        page.getByRole("heading", { name: "Password updated" }),
      ).toBeVisible({ timeout: 10000 });

      // "Continue" — signs the device in. The reset endpoint's after-hook
      // already opened the session; this is a plain navigation, not a second
      // credential check.
      const continueLink = page.getByTestId("reset-sign-in");
      await expect(continueLink).toHaveText("Continue");

      // "Add a passkey" starts the ceremony IN PLACE, on this same card —
      // no navigation to settings first.
      await page.getByTestId("reset-add-passkey").click();
      await expect(
        page.getByTestId("reset-passkey-ceremony-title"),
      ).toBeVisible();
      await expect(page.getByTestId("reset-passkey-added")).toBeVisible({
        timeout: 15000,
      });

      // The way on is still there throughout, exactly as the spec requires.
      await expect(continueLink).toBeVisible();
      await continueLink.click();
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
        timeout: 15000,
      });

      // The old password no longer works and the new one does — the last
      // half of the always-manual scenario this test now automates.
      await whenISignOut(page);
      await page.goto("/auth/signin");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByTestId("routed-identifier")).toContainText(email);
      await page.getByLabel("Password", { exact: true }).fill(oldPassword);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page.getByTestId("signin-failure")).toBeVisible({
        timeout: 10000,
      });

      await page.getByLabel("Password", { exact: true }).fill(newPassword);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 15000 });
    } finally {
      await removeVirtualAuthenticator(authenticator);
    }
  });
});
