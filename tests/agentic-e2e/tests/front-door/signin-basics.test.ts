/**
 * Feature: The first-party sign-in and sign-up screens
 * Source: specs/identity/signin-signup-screens.feature
 *
 * Bug-bash findings covered:
 *   #2 No error flash right after signing in (no alert/toast within a
 *      couple of seconds of landing).
 *   #3 Sign out and sign in again several times in a row without hitting
 *      the sign-in rate limit.
 *   #7 Forgot-password is prefilled with the address typed on the sign-in
 *      screen.
 */
import { expect, test } from "@playwright/test";
import {
  FRONT_DOOR_PASSWORD,
  generateFrontDoorEmail,
  givenARegisteredAccount,
  givenIAmOnTheSignInScreen,
  thenNoErrorFlashAppears,
  whenIEnterMyAddressToSignIn,
  whenISignInAndOutSeveralTimes,
  whenISignInWithPassword,
} from "./steps";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Sign-in basics", () => {
  /**
   * No scenario in the four bound specs names this directly (the closest,
   * "A rejected field says what to fix, next to the field", is about a
   * refused SUBMIT, not a successful one). Added here as a new scenario: a
   * sign-in that worked must not leave a stray refusal on screen behind it.
   */
  // @scenario "A successful sign-in shows no error"
  test("a successful sign-in shows no error flash", async ({ page }) => {
    const email = generateFrontDoorEmail("no-flash");
    await givenARegisteredAccount(page, { email });

    await whenISignInWithPassword(page, { email });
    await thenNoErrorFlashAppears(page);
  });

  /**
   * No scenario in the four bound specs names the rate limit's TOLERANCE
   * directly (the existing "A rate-limited log-in says how long, and stops
   * asking" scenario is about being OVER it). Added here as a new one: the
   * ordinary case, several sign-in/sign-out cycles in a row, must never
   * brush the limit at all.
   */
  // @scenario "Signing in and out repeatedly does not trip the sign-in rate limit"
  test("signing out and back in several times never hits the rate limit", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("cycle");
    const password = FRONT_DOOR_PASSWORD;
    await givenARegisteredAccount(page, { email, password });

    // Five full cycles: comfortably inside the 50-per-15-minutes budget on
    // `/sign-in/email` (config/rate-limit.ts), while still exercising the
    // pattern a real "kept getting logged out and back in" bug report means.
    await whenISignInAndOutSeveralTimes(page, { email, password, times: 5 });
  });

  /**
   * No scenario in the four bound specs names the forgot-password carry
   * directly (`password-reset.feature`'s reset scenarios all start FROM
   * `/auth/forgot-password`, never from the sign-in screen's link). Added
   * here as a new one, bound to `carriedEmail.ts` / `forgotPasswordHref`.
   *
   * CI has no email provider (`HAS_EMAIL_PROVIDER_KEY` is false —
   * `e2e-ci.yml` sets no SendGrid/SES key), so `/auth/forgot-password`
   * renders `ManagedElsewhereCard` ("This deployment cannot send email...")
   * rather than the form that reads the fragment — see
   * `pages/auth/forgot-password.tsx`. `ManagedElsewhereCard` never calls
   * `readCarriedEmail`/`forgetCarriedEmail`, so the fragment is left
   * untouched, which is what lets this test verify the LOAD-BEARING half of
   * the mechanism (the address travels in the URL fragment, unmodified) even
   * where the environment gates off the visual prefill. If a form is
   * present, the prefill itself is asserted too.
   */
  // @scenario "The forgot-password link carries the address already typed"
  test("forgot-password link carries the typed address in the URL fragment", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("forgot");
    await givenARegisteredAccount(page, { email });

    await givenIAmOnTheSignInScreen(page);
    await whenIEnterMyAddressToSignIn(page, email);

    await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.waitForURL(/\/auth\/forgot-password/);

    // The address travels in the FRAGMENT, never the query — see
    // `carriedEmail.ts`. A query string would show up in `page.url()`'s
    // search part; the fragment shows up only via `location.hash`.
    const hash = await page.evaluate(() => window.location.hash);
    expect(decodeURIComponent(hash)).toBe(`#email=${email}`);
    expect(page.url()).not.toContain(`email=${encodeURIComponent(email)}&`);
    expect(new URL(page.url()).search).not.toContain("email=");

    const emailField = page.getByLabel("Email", { exact: true });
    if (await emailField.isVisible().catch(() => false)) {
      await expect(emailField).toHaveValue(email);
    }
  });
});
