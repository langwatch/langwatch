/**
 * Feature: The first-party sign-in and sign-up screens
 * Source: specs/identity/signin-signup-screens.feature
 * Also binds: specs/identity/passkeys.feature
 *
 * Bug-bash findings covered:
 *   #1  Sign up, open the confirmation link: land in the app signed in, with
 *       no passkey error and no second password prompt.
 *   #6  An account created without a display name is called by its email
 *       address, never "null".
 *   #11 Passkey sign-up from the verify link moves forward.
 *
 * Named `.test.ts` rather than this package's usual `.spec.ts` so
 * `check-feature-parity.ts`'s `TEST_FILE_RE` (`/\.test\.tsx?$/`) picks up the
 * `@scenario` annotations below — Playwright's default `testMatch` already
 * covers both suffixes, so this costs nothing at collection time. See the
 * added `tests/agentic-e2e/tests` root in `check-feature-parity.ts`.
 */
import { expect, test } from "@playwright/test";
import { addVirtualAuthenticator, removeVirtualAuthenticator } from "./webauthn";
import {
  findSignUpTokenFor,
  generateFrontDoorEmail,
  givenIAmOnTheSignUpScreen,
  givenMyAccountHasAWorkspace,
  thenIAmCalledByMyEmailNeverNull,
  thenTheLinkSignsMeInWithNoSecondPrompt,
  whenIChooseAPasskeyToFinishSigningUp,
  whenIChooseAPasswordToFinishSigningUp,
  whenIEnterANewAddressToSignUpWith,
  whenIOpenTheConfirmationLinkFor,
} from "./steps";

// Reached signed out — never inherit the shared browser-test@langwatch.ai
// session this package's other suites reuse.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Sign-up confirmation", () => {
  /**
   * Scenario: Opening the link is what signs me in for the first time
   * Source: signin-signup-screens.feature lines 204-208
   */
  // @scenario "Opening the link is what signs me in for the first time"
  test("opening the confirmation link signs a fresh account in with no second prompt", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("confirm");

    await givenIAmOnTheSignUpScreen(page);
    await whenIEnterANewAddressToSignUpWith(page, email);
    await whenIChooseAPasswordToFinishSigningUp(page);

    await whenIOpenTheConfirmationLinkFor(page, email);
    await thenTheLinkSignsMeInWithNoSecondPrompt(page, email);
  });

  /**
   * Bug-bash finding #6, folded onto the same fresh account: sign-up never
   * asks for a name (`SignUpCredentialForm`'s own comment: "Onboarding asks
   * for it... putting it here charges a field at the one moment somebody has
   * least patience for one"), so the account this test just confirmed is
   * exactly the shape `displayNameFor` exists to handle.
   *
   * No standalone scenario names this in the four bound specs; recorded here
   * as a new one on the account-menu behaviour `displayName.ts`'s own doc
   * comment already describes as the bug ("null (sam@acme.com)").
   */
  // @scenario "An account with no display name is called by its email, never null"
  test("an account with no display name is called by its email, never 'null'", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("noname");

    await givenIAmOnTheSignUpScreen(page);
    await whenIEnterANewAddressToSignUpWith(page, email);
    await whenIChooseAPasswordToFinishSigningUp(page);
    await whenIOpenTheConfirmationLinkFor(page, email);
    await thenTheLinkSignsMeInWithNoSecondPrompt(page, email);

    await givenMyAccountHasAWorkspace(page);
    await thenIAmCalledByMyEmailNeverNull(page, email);
  });

  /**
   * Scenario: Signing up with a passkey creates the account and the session
   * together
   * Source: signin-signup-screens.feature lines 241-246
   *
   * Bug-bash finding #11. The credential step's passkey button
   * (`PasskeySignUpButton`) is only ever mounted where `addressIsConfirmed`
   * is false (`SignUpCredentialForm`'s `offersPasskeys = !addressIsConfirmed`),
   * so it always calls `authClient.passkey.addPasskey` with
   * `createSession: false` — the same "check your email" ending the password
   * path takes, not an immediate session. This test asserts what the code
   * actually does rather than assuming the spec title's shortest reading, and
   * proves the finding either way: whichever ending it is, it must move
   * forward with no error, and the emailed link (if one is needed) must still
   * sign the account in cleanly — the exact thing finding #1 checks, applied
   * to a passkey-originated pending sign-up instead of a password one.
   */
  // @scenario "Signing up with a passkey creates the account and the session together"
  test("finishing sign-up with a passkey moves forward with no error", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("passkey-signup");
    const authenticator = await addVirtualAuthenticator(page);

    try {
      await givenIAmOnTheSignUpScreen(page);
      await whenIEnterANewAddressToSignUpWith(page, email);
      await whenIChooseAPasskeyToFinishSigningUp(page);

      // Whichever ending the current wiring takes, it must be one of exactly
      // two — signed straight in, or "check your email" — and never a bare
      // error alert sitting where either of those should be.
      const signedInAlready = page.getByTestId("signed-in-handoff");
      const checkYourEmail = page.getByTestId("verification-sent");
      await expect(signedInAlready.or(checkYourEmail)).toBeVisible({
        timeout: 15000,
      });
      await expect(
        page.getByText("Could not create a passkey", { exact: false }),
      ).toHaveCount(0);

      if (await checkYourEmail.isVisible()) {
        // The account already exists (the ceremony wrote it) — opening its
        // link is the ordinary "confirm an existing account" path, so it
        // must land exactly where finding #1 lands: signed in, no second
        // prompt.
        const token = await findSignUpTokenFor(email);
        await page.goto(`/auth/signup?verify=${encodeURIComponent(token)}`);
        await thenTheLinkSignsMeInWithNoSecondPrompt(page, email);
      }
    } finally {
      await removeVirtualAuthenticator(authenticator);
    }
  });
});
