/**
 * Feature: Passkeys (specs/identity/passkeys.feature). Bug-bash #4/#5/#9,
 * sharing one test in sequence — adding the passkey (#4) is the only way
 * to get an account whose sign-in #5 and #9 can then observe.
 */
import { expect, test } from "./fixtures";
import {
  addVirtualAuthenticator,
  removeVirtualAuthenticator,
} from "./webauthn";
import {
  FRONT_DOOR_PASSWORD,
  generateFrontDoorEmail,
  givenARegisteredAccount,
  givenMyAccountHasAWorkspace,
  whenIDeclineTheJoinTakeover,
  whenISignInWithPassword,
  whenISignOut,
} from "./steps";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Passkeys", () => {
  /**
   * Scenario: Registering a passkey from settings adds a way in
   * Source: passkeys.feature lines 66-70 (retagged from @unimplemented — see
   * the feature-file diff in this change)
   *
   * Scenario: The passkey offer follows a password, not a federated sign-in
   * Source: passkeys.feature lines 125-130
   *
   * Scenario: The passkey relying party is the deployment's public address
   * Source: passkeys.feature lines 400-404
   */
  // @scenario "Registering a passkey from settings adds a way in"
  // @scenario "The passkey offer follows a password, not a federated sign-in"
  // @scenario "The passkey relying party is the deployment's public address"
  test("adding a passkey in settings, the post-password offer, and the relying party", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("passkey");
    const password = FRONT_DOOR_PASSWORD;
    await givenARegisteredAccount(page, { email, password });

    const authenticator = await addVirtualAuthenticator(page);
    try {
      // ── #5 (positive half): the nudge appears after a PASSWORD sign-in ──
      await whenISignInWithPassword(page, { email, password });
      await givenMyAccountHasAWorkspace(page);
      await page.goto("/settings");

      // This account's address is confirmed and `@langwatch.ai`, so the shell
      // also offers it the organizations already on that domain — and that
      // takeover opens OVER the nudge. It has to be answered first or the
      // "Not now" below lands on it instead (substring match), leaving the
      // nudge standing and failing the assertion after it.
      await whenIDeclineTheJoinTakeover(page);

      const nudge = page.getByTestId("secure-account-nudge");
      await expect(nudge).toBeVisible({ timeout: 10000 });
      // Nothing else could have earned a passkey yet, so the deployment must
      // be offering one — the title says "Sign in faster next time" rather
      // than the two-step-only "Secure your account" wording.
      await expect(nudge).toContainText("Sign in faster next time");
      await nudge.getByRole("button", { name: "Not now", exact: true }).click();
      await expect(nudge).not.toBeVisible();

      // ── #4: adding a passkey from settings ──
      await page.goto("/settings/security");
      await expect(page.getByTestId("passkeys-settings-section")).toBeVisible();
      await page.getByTestId("create-passkey").click();
      await expect(page.getByTestId("passkey-ceremony-dialog")).toBeVisible();
      await expect(page.getByTestId("passkey-ceremony-dialog")).not.toBeVisible(
        {
          timeout: 15000,
        },
      );
      await expect(page.getByTestId("passkey-card")).toBeVisible();

      // ── #9 + #5 (negative half): sign back in WITH the passkey ──
      await whenISignOut(page);
      await page.goto("/auth/signin");
      await page.getByLabel("Email", { exact: true }).fill(email);

      const optionsResponse = page.waitForResponse((response) =>
        response
          .url()
          .includes("/api/auth/passkey/generate-authenticate-options"),
      );
      // An account that holds a passkey is ASKED for it, not offered a
      // button (signin-signup-screens.feature "An account with a passkey is
      // asked for it, not offered a button") — submitting the address is the
      // gesture the ceremony answers, so the ceremony starts on its own.
      await page.getByRole("button", { name: "Continue", exact: true }).click();

      const response = await optionsResponse;
      const body = (await response.json()) as { rpId?: string };
      expect(body.rpId).toBe(new URL(page.url()).hostname);

      await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), {
        timeout: 15000,
      });

      // The nudge must NOT reappear: `signedInWith` recorded on this session
      // is "passkey", and `SecureAccountNudge` reads exactly that
      // (`if (nudge.data.signedInWith !== "password") return null;`).
      await page.waitForTimeout(2000);
      await expect(page.getByTestId("secure-account-nudge")).toHaveCount(0);
    } finally {
      await removeVirtualAuthenticator(authenticator);
    }
  });
});
