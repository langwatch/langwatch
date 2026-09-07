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
import { expect, type Page, test } from "@playwright/test";
import { addVirtualAuthenticator, removeVirtualAuthenticator } from "./webauthn";
import {
  FRONT_DOOR_PASSWORD,
  findSignUpTokenFor,
  generateFrontDoorEmail,
  givenIAmOnTheSignUpScreen,
  givenMyAccountHasAWorkspace,
  thenIAmCalledByMyEmailNeverNull,
  thenTheLinkSignsMeInWithNoSecondPrompt,
  whenIOpenTheConfirmationLinkFor,
} from "./steps";

// Reached signed out — never inherit the shared browser-test@langwatch.ai
// session this package's other suites reuse.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Sign-up confirmation", () => {
  async function whenIRequestSignUpVerification(
    page: Page,
    email: string,
  ): Promise<void> {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByTestId("verification-sent")).toBeVisible();
  }

  async function whenIChooseAPasswordAfterProof(page: Page): Promise<void> {
    await page.getByLabel("Password", { exact: true }).fill(FRONT_DOOR_PASSWORD);
    await page
      .getByLabel("Confirm password", { exact: true })
      .fill(FRONT_DOOR_PASSWORD);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
  }

  /**
   * Scenario: Opening the link unlocks credential choice
   * Source: signin-signup-screens.feature lines 243-249
   */
  // @scenario "Opening the link unlocks credential choice"
  test("opening the confirmation link unlocks password choice before a session", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("confirm");

    await givenIAmOnTheSignUpScreen(page);
    await whenIRequestSignUpVerification(page, email);
    await whenIOpenTheConfirmationLinkFor(page, email);
    await expect(page.getByTestId("verified-address")).toContainText(email);
    await whenIChooseAPasswordAfterProof(page);
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
    await whenIRequestSignUpVerification(page, email);
    await whenIOpenTheConfirmationLinkFor(page, email);
    await expect(page.getByTestId("verified-address")).toContainText(email);
    await whenIChooseAPasswordAfterProof(page);
    await thenTheLinkSignsMeInWithNoSecondPrompt(page, email);

    await givenMyAccountHasAWorkspace(page);
    await thenIAmCalledByMyEmailNeverNull(page, email);
  });

  /**
   * Scenario: Signing up with a passkey consumes the verified address proof
   * Source: signin-signup-screens.feature lines 274-279
   *
   * The proof is obtained before the passkey ceremony. The confirmed branch
   * passes that proof to the real WebAuthn registration and opens the session
   * only after the account and credential are created.
   */
  // @scenario "Signing up with a passkey consumes the verified address proof"
  test("a verified address can be finished with a passkey and signs in", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("passkey-signup");
    const authenticator = await addVirtualAuthenticator(page);

    try {
      await givenIAmOnTheSignUpScreen(page);
      await whenIRequestSignUpVerification(page, email);
      await whenIOpenTheConfirmationLinkFor(page, email);
      await expect(page.getByTestId("verified-address")).toContainText(email);
      await expect(page.getByTestId("passkey-sign-up")).toBeVisible();
      await page.getByTestId("passkey-sign-up").click();
      await expect(
        page.getByText("Could not create a passkey", { exact: false }),
      ).toHaveCount(0);
      await thenTheLinkSignsMeInWithNoSecondPrompt(page, email);
    } finally {
      await removeVirtualAuthenticator(authenticator);
    }
  });
});
