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
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { z } from "zod";
import { getProjectSlug } from "../helpers";
import { confirmAddressOf, findSignUpVerificationToken } from "./db";

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
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
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
 * Reads the confirmation link's token straight out of Postgres, the way a
 * person would read it from their inbox. Polls briefly: the token row can lag
 * the response that issued it by a beat under load.
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

const signUpVerificationBodySchema = z.array(
  z.object({
    result: z.object({
      data: z.object({
        json: z.union([
          z.object({ sent: z.literal(false), addressProof: z.string().min(1) }),
          z.object({ sent: z.literal(true) }),
        ]),
      }),
    }),
  }),
);

const confirmedAddressSchema = z.object({
  addressProof: z.string().min(1),
  email: z.string().email(),
});

/**
 * An address proof for `email` through the same public endpoints as the
 * sign-up UI. An installation with no email answers with an unconfirmed proof
 * directly; otherwise the mailed link's token is read from Postgres and
 * exchanged for its single-use proof.
 */
export async function requestSignUpAddressProof(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.post(
    "/api/trpc/auth.requestSignUpVerification?batch=1",
    { data: { "0": { json: { email } } } },
  );
  const body: unknown = await response.json().catch(() => null);
  const parsed = signUpVerificationBodySchema.safeParse(body);
  if (!response.ok() || !parsed.success) {
    throw new Error(
      `requestSignUpVerification failed for ${email}: ${response.status()} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const answer = parsed.data[0]!.result.data.json;
  if (!answer.sent) return answer.addressProof;

  const token = await findSignUpTokenFor(email);
  const confirmationResponse = await request.post(
    "/api/auth/sign-up/confirm-address",
    {
      data: { token },
      headers: betterAuthRequestHeaders(),
    },
  );
  const confirmationBody: unknown = await confirmationResponse
    .json()
    .catch(() => null);
  const confirmation = confirmedAddressSchema.safeParse(confirmationBody);
  if (
    !confirmationResponse.ok() ||
    !confirmation.success ||
    confirmation.data.email !== email
  ) {
    throw new Error(
      `confirm-address failed for ${email}: ${confirmationResponse.status()} ${JSON.stringify(confirmationBody).slice(0, 300)}`,
    );
  }

  return confirmation.data.addressProof;
}

/**
 * Registers `email` with `password` and leaves its address confirmed. CI has
 * no inbox, so the confirmation a link would carry is written directly.
 */
export async function registerConfirmedAccount(
  request: APIRequestContext,
  { email, password, name }: { email: string; password: string; name?: string },
): Promise<void> {
  const addressProof = await requestSignUpAddressProof(request, email);
  const response = await request.post("/api/trpc/user.register?batch=1", {
    data: {
      "0": {
        json: { addressProof, email, password, ...(name ? { name } : {}) },
      },
    },
  });
  if (!response.ok()) {
    throw new Error(
      `user.register failed for ${email}: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }
  await confirmAddressOf(email);
}

/**
 * Finishing sign-up signs the person straight in: the browser leaves
 * /auth/signup on its own (the "You're in" card is set in the same tick as the
 * redirect, so it is not a dependable observable), the session belongs to
 * `email`, and nothing on the way asked for a second credential.
 */
export async function thenIAmSignedInWithNoSecondPrompt(
  page: Page,
  email: string,
): Promise<void> {
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
 * onboarding path `tests/auth.setup.ts` uses, so a project page renders the
 * ordinary authenticated shell rather than an onboarding wizard.
 */
export async function givenMyAccountHasAWorkspace(page: Page): Promise<void> {
  const getAll = await page.request.get(
    "/api/trpc/organization.getAll?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );
  const data = (await getAll.json().catch(() => null)) as {
    "0"?: {
      result?: {
        data?: { json?: Array<{ teams?: Array<{ projects?: unknown[] }> }> };
      };
    };
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
  if (
    !response.ok() ||
    (result as { "0"?: { error?: unknown } })?.["0"]?.error
  ) {
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
  const projectSlug = await getProjectSlug(page);
  // A fresh sign-up can still be redirecting to "/", which interrupts a goto.
  await expect(async () => {
    await page.goto(`/${projectSlug}/messages`);
  }).toPass({ timeout: 15000 });
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
    timeout: 15000,
  });
  // A fresh account's first authenticated screen can open a modal — the
  // join-your-team takeover for a confirmed address whose domain already has
  // organizations, the "Sign in faster next time" offer for a password-made
  // account — and a modal's backdrop swallows the click on the user menu
  // behind it. Answer them the way a person in a hurry does, then carry on.
  await whenIDeclineWhatTheShellOffersFirst(page);
  await page
    .getByRole("button", { name: `Open user menu for ${email}` })
    .click();
  const group = page.getByText(new RegExp(`\\(${escapeRegExp(email)}\\)`));
  await expect(group).toBeVisible({ timeout: 10000 });
  await expect(group).not.toContainText("null");
  // The literal bug this guards: no name renders the email on both sides of
  // the parenthesis, e.g. "you@x.com (you@x.com)" — never "null (you@x.com)".
  await expect(group).toContainText(email);
}

/**
 * Declines whichever modal the app shell opens over a fresh account's first
 * screen, and does nothing when none does. Two exist today, and either can
 * arrive a beat after the page (each waits on its own query):
 *
 *   - the join-your-team takeover (`JoinYourTeamTakeover`, "Your colleagues
 *     are already here"), offered to a CONFIRMED address whose domain already
 *     has organizations — every account this suite confirms is
 *     `@langwatch.ai`, the same domain as `browser-test@langwatch.ai`'s org
 *     and every earlier front-door run's, so a link-confirmed account always
 *     gets it (the lookup answers only for verified addresses, which is why a
 *     `user.register` account, unverified, does not);
 *   - the passkey / two-step offer (`SecureAccountNudge`, "Sign in faster
 *     next time"), for a password-made account.
 *
 * Both are modals, so any step that needs to click through the shell has to
 * get past them first. Declined in turn, then checked once more, because
 * dismissing the takeover is what lets the nudge's turn come.
 */
export async function whenIDeclineWhatTheShellOffersFirst(
  page: Page,
): Promise<void> {
  const takeover = page.getByRole("dialog", {
    name: "Your colleagues are already here",
  });
  const nudge = page.getByTestId("secure-account-nudge");
  for (let round = 0; round < 3; round++) {
    try {
      await takeover.or(nudge).first().waitFor({
        state: "visible",
        timeout: 15000,
      });
    } catch {
      return;
    }

    // WHICHEVER IS ON TOP, decided fresh every round rather than once. Each
    // modal waits on its own query, so the nudge can paint first and the
    // takeover open over it a beat later — and committing to the nudge on
    // that first look left a click waiting fifteen seconds on a button the
    // takeover had covered. The takeover goes first whenever it is up,
    // because it is the one that covers the other.
    // THE CLICK MAY MISS, AND THAT IS ALLOWED. Between the look above and the
    // press below the modal can answer itself — its own query resolves to
    // "nothing to offer", or a dismissal already in flight lands — and a
    // press aimed at a button that has just gone is not a failure of
    // anything. What matters is only that the modal ENDS UP gone, which is
    // what the assertion after each press checks: a genuinely stuck modal
    // still fails there, loudly, rather than being swallowed here.
    if (await takeover.isVisible().catch(() => false)) {
      await takeover
        .getByRole("button", { name: /keep working on my own/ })
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await expect(takeover).not.toBeVisible();
      continue;
    }

    if (await nudge.isVisible().catch(() => false)) {
      // `exact`, because the takeover's way past is "Not now — keep working
      // on my own": a substring match here reaches across to the other modal
      // and answers the wrong question.
      await nudge
        .getByRole("button", { name: "Not now", exact: true })
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await expect(nudge).not.toBeVisible();
      continue;
    }

    return;
  }
}

/**
 * Declines ONLY the join-your-team takeover, leaving whatever is underneath it
 * standing.
 *
 * `whenIDeclineWhatTheShellOffersFirst` answers both modals, which is what a
 * step that just wants to reach the shell needs. A test whose SUBJECT is the
 * nudge cannot use it — it would dismiss the thing being asserted. The
 * takeover still has to go first, because it opens over the nudge and takes
 * the rest of the page out of the accessibility tree with it: a
 * `getByRole("button", { name: "Not now" })` matches by substring, so with the
 * takeover up the click lands on its "Not now — keep working on my own" and
 * the nudge is left open behind it.
 */
export async function whenIDeclineTheJoinTakeover(page: Page): Promise<void> {
  const takeover = page.getByRole("dialog", {
    name: "Your colleagues are already here",
  });
  try {
    await takeover.waitFor({ state: "visible", timeout: 15000 });
  } catch {
    return;
  }
  await takeover.getByRole("button", { name: /keep working on my own/ }).click();
  await expect(takeover).not.toBeVisible();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// Sign-in: address -> password, and around it
// =============================================================================

/**
 * Registers a fresh account directly (no UI) with a confirmed address.
 * No `name` is sent: omitting it is exactly the shape a passkey or front-door
 * sign-up leaves behind, which is what finding #6 needs.
 */
export async function givenARegisteredAccount(
  page: Page,
  {
    email,
    password = FRONT_DOOR_PASSWORD,
  }: { email: string; password?: string },
): Promise<void> {
  await registerConfirmedAccount(page.request, { email, password });
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
  {
    email,
    password = FRONT_DOOR_PASSWORD,
  }: { email: string; password?: string },
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
  {
    email,
    password,
    times,
  }: { email: string; password: string; times: number },
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await whenISignInWithPassword(page, { email, password });
    await expect(page.getByText(/rate limit|too many/i)).toHaveCount(0);
    await whenISignOut(page);
  }
}
