/**
 * The join-your-team takeover, as the thing under test rather than as
 * something other suites have to get past.
 *
 * `JoinYourTeamTakeover` arrived with D12 and is mounted in
 * `DashboardPageBody`, so it opens over every dashboard page for somebody
 * whose verified domain already has organizations. Ten unrelated suites
 * discovered that before this file did — it is cover-sized and `aria-modal`,
 * so while it is up the rest of the page is not in the accessibility tree at
 * all, and every `getByRole` elsewhere failed as "element(s) not found". The
 * fix for those was to answer it; this is the half that checks it is worth
 * answering.
 *
 * Each test BUILDS ITS OWN DOMAIN NEIGHBOUR rather than leaning on an
 * organization some earlier spec happened to leave on `@langwatch.ai`.
 * Depending on what ran first is exactly how the takeover reached those other
 * suites, and a test that reproduces the cause is not a regression test for
 * it.
 *
 * Corresponds to specs/identity/join-requests.feature and
 * specs/identity/join-before-create.feature.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  FRONT_DOOR_PASSWORD,
  generateFrontDoorEmail,
  givenARegisteredAccount,
  givenMyAccountHasAWorkspace,
  whenISignInWithPassword,
  whenISignOut,
} from "./steps";

/**
 * Signed out, like every other spec in this directory. The chromium project
 * carries `auth.setup.ts`'s stored session, and these tests sign their own
 * accounts in through the real screens — with the shared session in place
 * `/auth/signin` simply redirects to the dashboard and there is no address
 * field to type into.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Puts an organization on this suite's domain, owned by somebody who is not
 * the account under test, and leaves the browser signed out.
 *
 * Returns nothing on purpose: what matters to the caller is that the domain
 * now HAS a neighbour, not which one.
 */
async function givenAColleagueAlreadyHasAWorkspace(page: Page): Promise<void> {
  const colleague = generateFrontDoorEmail("join-colleague");
  await givenARegisteredAccount(page, {
    email: colleague,
    password: FRONT_DOOR_PASSWORD,
  });
  await whenISignInWithPassword(page, {
    email: colleague,
    password: FRONT_DOOR_PASSWORD,
  });
  await givenMyAccountHasAWorkspace(page);
  await whenISignOut(page);
}

/**
 * Takes the security nudge out of the way server-side, so the takeover is the
 * only modal these tests have to reason about.
 *
 * Both modals open on their own query and either can paint first, so answering
 * them through the screen is a race — the same one that left a click waiting
 * fifteen seconds on a covered button in `whenIDeclineWhatTheShellOffersFirst`.
 * `auth.setup.ts` settles it for the shared session exactly this way, and a
 * test whose SUBJECT is the other modal has the same reason to.
 */
async function givenTheSecurityNudgeIsOutOfTheWay(page: Page): Promise<void> {
  const response = await page.request.post(
    "/api/trpc/user.dismissSecureAccountNudge?batch=1",
    { data: { "0": { json: {} } } },
  );
  if (!response.ok()) {
    throw new Error(
      `dismissSecureAccountNudge failed: ${response.status()} ${(
        await response.text()
      ).slice(0, 300)}`,
    );
  }
  await page.reload();
}

test.describe("Join your team", () => {
  // Two accounts through the real sign-in screen, and the CI runner's
  // per-step tax is what the whole-test budget is spent on rather than
  // anything this test waits for.
  test.slow();

  /** @scenario An existing user is offered their colleagues once, and can dismiss it */
  test("offers the domain's organizations, refuses to be clicked past, and remembers the refusal", async ({
    page,
  }) => {
    await givenAColleagueAlreadyHasAWorkspace(page);

    const newcomer = generateFrontDoorEmail("join-newcomer");
    await givenARegisteredAccount(page, {
      email: newcomer,
      password: FRONT_DOOR_PASSWORD,
    });
    await whenISignInWithPassword(page, {
      email: newcomer,
      password: FRONT_DOOR_PASSWORD,
    });
    await givenTheSecurityNudgeIsOutOfTheWay(page);

    const takeover = page.getByTestId("join-team-takeover");
    await expect(takeover).toBeVisible({ timeout: 15000 });
    await expect(takeover).toContainText("Your colleagues are already here");

    // Joining LEADS: the organization is offered as the action, and creating
    // one of your own is the way past rather than a second button.
    await expect(
      takeover.getByRole("button", { name: /^Ask to join / }).first(),
    ).toBeVisible();

    // ESCAPE IS NOT AN ANSWER. `closeOnEscape={false}` is set for one stated
    // reason — treating a keypress as a decision is how somebody ends up asked
    // again tomorrow having believed they had decided — and it is a one-line
    // regression in any dialog refactor.
    await page.keyboard.press("Escape");
    await expect(takeover).toBeVisible();

    // Nor is there an X to click instead. `Takeover` deliberately renders no
    // `Dialog.CloseTrigger`, unlike the nudge beside it: the way past is the
    // labelled action that records the refusal, and a corner button would be
    // a way out that records nothing.
    //
    // (`closeOnInteractOutside={false}` is not asserted here. The dialog is
    // `size="cover"`, so there is no backdrop left to click — a click at any
    // coordinate lands inside the content, and an assertion that it stays
    // open would pass whatever that prop said.)
    await expect(
      takeover.getByRole("button", { name: /^close$/i }),
    ).toHaveCount(0);

    // THE WAY PAST IS NAMED FOR THE SURFACE IT IS ON. This account holds no
    // organization yet, so it meets the takeover on the onboarding screen,
    // where declining means "carry on and make one" — not the dashboard's
    // "keep working on my own", which would be a sentence about work that
    // does not exist yet. The label is a prop (`dismissLabel`) precisely so
    // the two can differ, and asserting the wrong one is how this test first
    // failed.
    const wayPast = takeover.getByRole("button", {
      name: /Create a new organization instead/,
    });
    await expect(wayPast).toBeVisible();
    await wayPast.click();
    await expect(takeover).not.toBeVisible();

    // REMEMBERED, which is the whole promise under the button — "We will not
    // ask about this domain again". A refusal that does not survive a reload
    // is the nag the copy says it is not.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("join-team-takeover")).toHaveCount(0);
  });

  /** @scenario Approval reaches somebody who created a workspace while waiting */
  test("asking to join hands over to an administrator rather than creating anything", async ({
    page,
  }) => {
    await givenAColleagueAlreadyHasAWorkspace(page);

    const asker = generateFrontDoorEmail("join-asker");
    await givenARegisteredAccount(page, {
      email: asker,
      password: FRONT_DOOR_PASSWORD,
    });
    await whenISignInWithPassword(page, {
      email: asker,
      password: FRONT_DOOR_PASSWORD,
    });
    await givenTheSecurityNudgeIsOutOfTheWay(page);

    const takeover = page.getByTestId("join-team-takeover");
    await expect(takeover).toBeVisible({ timeout: 15000 });
    await takeover
      .getByRole("button", { name: /^Ask to join / })
      .first()
      .click();

    // ASKING IS NOT JOINING. The same screen turns into the waiting half
    // instead of dropping them onto a dashboard that looks like nothing
    // happened — the moment the copy says people ask again, or give up and
    // make the second workspace this screen exists to prevent.
    const waiting = page.getByTestId("join-team-waiting");
    await expect(waiting).toBeVisible({ timeout: 15000 });
    await expect(waiting).toContainText("Waiting for an administrator");

    // And it is still the answer after a reload: a request that is not
    // remembered reads to the asker as one that was never made.
    await page.reload();
    await expect(page.getByTestId("join-team-waiting")).toBeVisible({
      timeout: 15000,
    });
  });
});
