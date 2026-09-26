/**
 * Feature: The first-party sign-in and sign-up screens
 * Source: specs/identity/signin-signup-screens.feature
 *
 * CI is an installation with no email provider, so sign-up there asks for a
 * password straight away and leaves the address unconfirmed. The mailed-link
 * flow is covered by the component and integration suites.
 *
 * Named `.test.ts` so `check-feature-parity.ts` picks up the `@scenario`
 * annotations below; Playwright's default `testMatch` covers both suffixes.
 */
import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { closeDb, isAddressConfirmed } from "./db";
import {
  FRONT_DOOR_PASSWORD,
  generateFrontDoorEmail,
  givenIAmOnTheSignUpScreen,
  givenMyAccountHasAWorkspace,
  thenIAmCalledByMyEmailNeverNull,
  thenIAmSignedInWithNoSecondPrompt,
} from "./steps";

// Reached signed out: never inherit the shared browser-test@langwatch.ai
// session this package's other suites reuse.
test.use({ storageState: { cookies: [], origins: [] } });

test.afterAll(async () => {
  await closeDb();
});

test.describe("Sign-up without email", () => {
  async function whenIStartSignUpWith(page: Page, email: string) {
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }

  async function whenIChooseAPassword(page: Page): Promise<void> {
    await page
      .getByLabel("Password", { exact: true })
      .fill(FRONT_DOOR_PASSWORD);
    await page
      .getByLabel("Confirm password", { exact: true })
      .fill(FRONT_DOOR_PASSWORD);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
  }

  // @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed"
  test("asks for a password straight away and leaves the address unconfirmed", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("no-email");

    await givenIAmOnTheSignUpScreen(page);
    await whenIStartSignUpWith(page, email);
    await expect(page.getByTestId("unconfirmed-address")).toContainText(email);
    await expect(page.getByTestId("passkey-sign-up")).toHaveCount(0);
    await whenIChooseAPassword(page);
    await thenIAmSignedInWithNoSecondPrompt(page, email);
    expect(await isAddressConfirmed(email)).toBe(false);
  });

  /**
   * Bug-bash finding #6: sign-up never asks for a name, so a fresh account is
   * exactly the shape `displayNameFor` exists to handle.
   */
  // @scenario "An account with no display name is called by its email, never null"
  test("an account with no display name is called by its email, never 'null'", async ({
    page,
  }) => {
    const email = generateFrontDoorEmail("noname");

    await givenIAmOnTheSignUpScreen(page);
    await whenIStartSignUpWith(page, email);
    await expect(page.getByTestId("unconfirmed-address")).toContainText(email);
    await whenIChooseAPassword(page);
    await thenIAmSignedInWithNoSecondPrompt(page, email);

    await givenMyAccountHasAWorkspace(page);
    await thenIAmCalledByMyEmailNeverNull(page, email);
  });
});
