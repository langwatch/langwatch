/**
 * Step definitions for the identity front-door bug-bash pass.
 *
 * Sources:
 *   - specs/identity/signin-signup-screens.feature
 *   - specs/identity/passkeys.feature
 *   - specs/auth/password-reset.feature
 *   - specs/identity/identifier-model.feature (VerificationToken shape only)
 *
 * These screens are reached SIGNED OUT, unlike the rest of this package,
 * whose `chromium` project reuses `.auth/user.json`. Every `.test.ts` file in
 * this directory opts out with `test.use({ storageState: { cookies: [],
 * origins: [] } })` so it never inherits the shared `browser-test@langwatch.ai`
 * session.
 *
 * Every account these steps create uses a fresh, timestamped address
 * (`generateFrontDoorEmail`) so re-runs never collide with each other, with
 * `browser-test@langwatch.ai`, or with the per-address sign-in rate limit
 * (50 attempts / 15 minutes on `/sign-in/email` — see
 * `platform/app/src/server/better-auth/config/rate-limit.ts`).
 */
import { expect, type Page, test } from "@playwright/test";
import { findSignUpVerificationToken } from "./db";

export const FRONT_DOOR_PASSWORD = "FrontDoorTest123!";

/**
 * The headers every direct call to a better-auth endpoint needs. better-auth's
 * origin check (`api/middlewares/origin-check`) refuses any cookie-bearing
 * POST whose `Origin` (or `Referer`) is missing or untrusted, and Playwright's
 * `page.request` sends neither on its own — so a bare `page.request.post(
 * "/api/auth/...")` from a signed-in context is a silent 403, not a sign-out.
 * The app's own tRPC endpoints do not run this check, which is why
 * `user.register` and the onboarding calls below need nothing extra.
 */
export function betterAuthRequestHeaders(): Record<string, string> {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:5570";
  return { Origin: new URL(baseURL).origin };
}

/** A fresh address, so re-runs never collide with a prior run's account. */
export function generateFrontDoorEmail(prefix: string): string {
  return `front-door-${prefix}-${Date.now()}-${Math.floor(
    Math.random() * 10000,
  )}@langwatch.ai`;
}

// =============================================================================
// Sign-up: address -> credential -> "check your email"
// =============================================================================

/** Opens the sign-up screen's address step. */
export async function givenIAmOnTheSignUpScreen(page: Page): Promise<void> {
  await page.goto("/auth/signup");
  await expect(
    page.getByRole("heading", { name: "Create your LangWatch account" }),
  ).toBeVisible();
}

/** Types the address and reaches the credential step. */
export async function whenIEnterANewAddressToSignUpWith(
  page: Page,
  email: string,
): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("signup-identifier")).toContainText(email);
}

/**
 * Finishes sign-up with a password: types it twice, submits, and waits for
 * the "check your email" state. Does NOT sign anybody in — see
 * `signin-signup-screens.feature` "Sign-up creates the account but does not
 * let me in until I confirm".
 */
export async function whenIChooseAPasswordToFinishSigningUp(
  page: Page,
  password: string = FRONT_DOOR_PASSWORD,
): Promise<void> {
  await page.getByLabel("Password", { exact: true }).fill(password);
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByTestId("verification-sent")).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Finishes sign-up with a passkey instead of a password. Requires a virtual
 * authenticator already attached to `page` (see `webauthn.ts`) — the
 * ceremony this button starts is a REAL `navigator.credentials.create()`
 * call, verified over the real `@simplewebauthn` path on the server.
 */
export async function whenIChooseAPasskeyToFinishSigningUp(
  page: Page,
): Promise<void> {
  await page.getByTestId("passkey-sign-up").click();
}

/**
 * Reads the confirmation link's token straight out of Postgres — CI has no
 * mail provider, so there is no inbox to read it from (see `db.ts`'s header
 * for the full coupling). Polls briefly: the token row and the response that
 * put "check your email" on screen are two separate things, and the row can
 * lag the render by a beat under load.
 */
export async function findSignUpTokenFor(email: string): Promise<string> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const token = await findSignUpVerificationToken(email);
    if (token) return token;
    if (Date.now() > deadline) {
      throw new Error(
        `No sign-up verification token appeared in Postgres for ${email} within 10s`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Opens the confirmation link for `email` — read from Postgres, not from an
 * inbox (see `findSignUpTokenFor`) — the way a person clicking it would.
 */
export async function whenIOpenTheConfirmationLinkFor(
  page: Page,
  email: string,
): Promise<void> {
  const token = await findSignUpTokenFor(email);
  await page.goto(`/auth/signup?verify=${encodeURIComponent(token)}`);
}

/**
 * Bug-bash finding #1 / #11: opening the link signs the person straight in —
 * no passkey error, no second password prompt — and lands them past the
 * sign-up screen. Bound to "Opening the link is what signs me in for the
 * first time" (signin-signup-screens.feature).
 *
 * The screen's "You're in" handoff card (`signed-in-handoff`) is set in the
 * same tick as the `hardRedirect` that leaves the page
 * (`VerificationFirstSignUp.tsx`), so against a local prod build the browser
 * is often already on the next page before the card is ever painted. It is
 * not a dependable observable, and the component test already pins it. What
 * this step asserts instead is what the person actually gets: the browser
 * leaves /auth/signup on its own, the session behind it belongs to `email`,
 * and nothing on the way asked for a password or a passkey.
 */
export async function thenTheLinkSignsMeInWithNoSecondPrompt(
  page: Page,
  email: string,
): Promise<void> {
  // The handoff is a real `hardRedirect`, so the browser leaves /auth/signup
  // entirely rather than the screen quietly re-rendering in place. Had the
  // link opened no session, the screen would have stayed put and offered a
  // way in (`AccountIsReady` / `MethodChoice`) — so leaving IS the sign-in.
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signup"), {
    timeout: 15000,
  });
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/auth/get-session");
        if (!response.ok()) return null;
        const body = (await response.json().catch(() => null)) as {
          user?: { email?: string };
        } | null;
        return body?.user?.email ?? null;
      },
      { timeout: 10000 },
    )
    .toBe(email);
  // Wherever the redirect landed, it is not a credential prompt: no password
  // box, no passkey ceremony, no passkey refusal.
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("passkey-ceremony")).toHaveCount(0);
  await expect(
    page.getByText("Could not use a passkey", { exact: false }),
  ).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/auth\/sign(in|up)/);
}

// =============================================================================
// Display name (bug-bash finding #6)
// =============================================================================

/**
 * Provisions an org + project for the current session via the same API
 * onboarding path `tests/auth.setup.ts` uses, so `/settings` renders the
 * ordinary authenticated shell rather than an onboarding wizard.
 */
export async function givenMyAccountHasAWorkspace(page: Page): Promise<void> {
  const getAll = await page.request.get(
    "/api/trpc/organization.getAll?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );
  const data = (await getAll.json().catch(() => null)) as {
    "0"?: { result?: { data?: { json?: Array<{ teams?: Array<{ projects?: unknown[] }> }> } } };
  } | null;
  const orgs = data?.["0"]?.result?.data?.json ?? [];
  const hasProject = orgs.some((o) =>
    (o.teams ?? []).some((t) => (t.projects ?? []).length > 0),
  );
  if (hasProject) return;

  const response = await page.request.post(
    "/api/trpc/onboarding.initializeOrganization?batch=1",
    {
      data: {
        "0": {
          json: {
            orgName: "Front Door Test Org",
            projectName: "Front Door Test Project",
            language: "other",
            framework: "other",
          },
        },
      },
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok() || (result as { "0"?: { error?: unknown } })?.["0"]?.error) {
    throw new Error(
      `initializeOrganization failed: ${response.status()} ${JSON.stringify(result).slice(0, 300)}`,
    );
  }
}

/**
 * Bug-bash finding #6: an account with no display name is called by its
 * email, never the literal string "null" (`displayNameFor`,
 * `AppHeaderUserMenu.tsx`).
 */
export async function thenIAmCalledByMyEmailNeverNull(
  page: Page,
  email: string,
): Promise<void> {
  await page.goto("/settings");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
    timeout: 15000,
  });
  // A password-made account gets the "Sign in faster next time" offer on its
  // first authenticated screen (`SecureAccountNudge`, a modal dialog), and a
  // modal's backdrop swallows the click on the user menu behind it. Answer
  // it the way a person in a hurry does, then carry on.
  await whenIDeclineTheSecureAccountNudgeIfOffered(page);
  await page
    .getByRole("button", { name: /Open user menu/ })
    .click();
  const group = page.getByText(new RegExp(`\\(${escapeRegExp(email)}\\)`));
  await expect(group).toBeVisible({ timeout: 10000 });
  await expect(group).not.toContainText("null");
  // The literal bug this guards: no name renders the email on both sides of
  // the parenthesis, e.g. "you@x.com (you@x.com)" — never "null (you@x.com)".
  await expect(group).toContainText(email);
}

/**
 * Declines the passkey / two-step offer (`secure-account-nudge`) when it is
 * on screen, and does nothing when it is not. The offer is a modal, so any
 * step that needs to click through the app shell after a password sign-in
 * has to get past it first.
 */
export async function whenIDeclineTheSecureAccountNudgeIfOffered(
  page: Page,
): Promise<void> {
  const nudge = page.getByTestId("secure-account-nudge");
  const offered = await nudge
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!offered) return;
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(nudge).not.toBeVisible();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// Sign-in: address -> password, and around it
// =============================================================================

/**
 * Registers a fresh account directly (no UI), the way `auth.setup.ts` does.
 * No `name` is sent — `user.register`'s schema treats it as optional rather
 * than nullable (`z.string().min(1).optional()`, so an empty string would be
 * REFUSED, not accepted), and omitting it is exactly the shape a passkey or
 * front-door sign-up leaves behind, which is what finding #6 needs.
 */
export async function givenARegisteredAccount(
  page: Page,
  { email, password = FRONT_DOOR_PASSWORD }: { email: string; password?: string },
): Promise<void> {
  const response = await page.request.post("/api/trpc/user.register?batch=1", {
    data: {
      "0": { json: { email, password } },
    },
  });
  if (!response.ok()) {
    throw new Error(
      `user.register failed for ${email}: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }
}

/** Opens the sign-in screen's address step. */
export async function givenIAmOnTheSignInScreen(page: Page): Promise<void> {
  await page.goto("/auth/signin");
  await expect(
    page.getByRole("heading", { name: "Log in to LangWatch", exact: true }),
  ).toBeVisible();
}

/** Types the address and reaches the password step for a known account. */
export async function whenIEnterMyAddressToSignIn(
  page: Page,
  email: string,
): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("routed-identifier")).toContainText(email, {
    timeout: 10000,
  });
}

/** Submits the password and waits for the sign-in to land. */
export async function whenIEnterMyPasswordToSignIn(
  page: Page,
  password: string = FRONT_DOOR_PASSWORD,
): Promise<void> {
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 15000 });
}

/** The whole address -> password -> in journey, in one call. */
export async function whenISignInWithPassword(
  page: Page,
  { email, password = FRONT_DOOR_PASSWORD }: { email: string; password?: string },
): Promise<void> {
  await givenIAmOnTheSignInScreen(page);
  await whenIEnterMyAddressToSignIn(page, email);
  await whenIEnterMyPasswordToSignIn(page, password);
}

/**
 * Ends the session via better-auth's endpoint directly — no UI sign-out
 * control is needed for what these tests check, and going straight to the
 * endpoint keeps a sign-in/sign-out cycle to exactly the two requests the
 * rate limit actually counts.
 */
export async function whenISignOut(page: Page): Promise<void> {
  // An empty JSON body, because better-auth answers a bodiless POST with 415
  // (`Content-Type is required`) — `data: {}` is what makes Playwright send
  // `application/json`.
  const response = await page.request.post("/api/auth/sign-out", {
    headers: betterAuthRequestHeaders(),
    data: {},
  });
  if (!response.ok()) {
    throw new Error(
      `sign-out failed: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }
}

/**
 * Bug-bash finding #2: no error flash appears within a couple of seconds of
 * a successful sign-in landing. `role="alert"` is how this app's error
 * toasts and `HandledErrorAlert`s both render (see `components/ui/toaster.tsx`
 * and `features/errors`), so this is a single check across every failure
 * surface a stray refusal could have used.
 */
export async function thenNoErrorFlashAppears(page: Page): Promise<void> {
  await page.waitForTimeout(2000);
  await expect(page.getByRole("alert")).toHaveCount(0);
}

/**
 * Bug-bash finding #3: signing out and back in several times in a row never
 * hits the sign-in rate limit (50 attempts / 15 minutes on `/sign-in/email`,
 * see `config/rate-limit.ts`) or shows a refusal.
 */
export async function whenISignInAndOutSeveralTimes(
  page: Page,
  { email, password, times }: { email: string; password: string; times: number },
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await whenISignInWithPassword(page, { email, password });
    await expect(page.getByText(/rate limit|too many/i)).toHaveCount(0);
    await whenISignOut(page);
  }
}
