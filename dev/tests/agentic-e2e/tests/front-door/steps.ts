/**
 * Step definitions for the identity front-door bug-bash pass. Reached
 * SIGNED OUT — unlike the rest of this package's `.auth/user.json` reuse —
 * via `test.use({ storageState: { cookies: [], origins: [] } })` per spec.
 */
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { z } from "zod";

import { getProjectSlug } from "../helpers";
import { confirmAddressOf, findSignUpVerificationToken } from "./db";

export const FRONT_DOOR_PASSWORD = "FrontDoorTest123!";

/**
 * Origin headers for the origin-gated endpoints: `/api/auth/*`, `auth.requestSignUpVerification`
 * and `user.register`. `page.request` sends no `Origin`/`Referer`, so a bare POST there is a 403.
 */
export function originGatedRequestHeaders(): Record<string, string> {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:5570";
  return { Origin: new URL(baseURL).origin };
}

/** A fresh address, so re-runs never collide with a prior run's account. */
export function generateFrontDoorEmail(prefix: string): string {
  return `front-door-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@langwatch.ai`;
}

// =============================================================================
// Sign-up: address -> credential -> "check your email"
// =============================================================================

/** Opens the sign-up screen's address step. */
export async function givenIAmOnTheSignUpScreen(page: Page): Promise<void> {
  await page.goto("/auth/signup");
  await expect(page.getByRole("heading", { name: "Create your LangWatch account" })).toBeVisible();
}

/** Types the address and reaches the credential step. */
export async function whenIEnterANewAddressToSignUpWith(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("signup-identifier")).toContainText(email);
}

/**
 * Finishes sign-up with a password and waits for "check your email". Does
 * NOT sign anybody in — see signin-signup-screens.feature's "does not let
 * me in until I confirm".
 */
export async function whenIChooseAPasswordToFinishSigningUp(
  page: Page,
  password: string = FRONT_DOOR_PASSWORD,
): Promise<void> {
  await page.getByLabel("Password", { exact: true }).fill(password);
  await expect(page.getByLabel("Confirm password", { exact: true })).toBeVisible();
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByTestId("verification-sent")).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Finishes sign-up with a passkey; needs a virtual authenticator already
 * attached to `page` (see `webauthn.ts`) — this is a REAL
 * `navigator.credentials.create()` ceremony, verified server-side.
 */
export async function whenIChooseAPasskeyToFinishSigningUp(page: Page): Promise<void> {
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
      throw new Error(`No sign-up verification token appeared in Postgres for ${email} within 10s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const signUpVerificationBodySchema = z.object({
  result: z.object({
    data: z.union([
      z.object({ sent: z.literal(false), addressProof: z.string().min(1) }),
      z.object({ sent: z.literal(true) }),
    ]),
  }),
});

const confirmedAddressSchema = z.object({
  result: z.object({
    data: z.object({ addressProof: z.string().min(1), email: z.string().email() }),
  }),
});

/**
 * An address proof for `email` through the same public endpoints as the sign-up UI. An
 * installation with no email answers with an unconfirmed proof directly; otherwise the mailed
 * link's token is read from Postgres and exchanged for its single-use proof.
 */
export async function requestSignUpAddressProof(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.post("/api/trpc/auth.requestSignUpVerification", {
    headers: originGatedRequestHeaders(),
    data: { email },
  });
  const body: unknown = await response.json().catch(() => null);
  const parsed = signUpVerificationBodySchema.safeParse(body);
  if (!response.ok() || !parsed.success) {
    throw new Error(
      `requestSignUpVerification failed for ${email}: ${response.status()} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const answer = parsed.data.result.data;
  if (!answer.sent) return answer.addressProof;

  const token = await findSignUpTokenFor(email);
  const confirmationResponse = await request.post("/api/trpc/auth.completeSignUpVerification", {
    data: { token },
  });
  const confirmationBody: unknown = await confirmationResponse.json().catch(() => null);
  const confirmation = confirmedAddressSchema.safeParse(confirmationBody);
  const confirmed = confirmation.success ? confirmation.data.result.data : null;
  if (!confirmationResponse.ok() || !confirmed || confirmed.email !== email) {
    throw new Error(
      `completeSignUpVerification failed for ${email}: ${confirmationResponse.status()} ${JSON.stringify(confirmationBody).slice(0, 300)}`,
    );
  }

  return confirmed.addressProof;
}

/**
 * Opens the confirmation link for `email` — read from Postgres, not from an
 * inbox (see `findSignUpTokenFor`) — the way a person clicking it would.
 */
export async function whenIOpenTheConfirmationLinkFor(page: Page, email: string): Promise<void> {
  const token = await findSignUpTokenFor(email);
  await page.goto(`/auth/signup?verify=${encodeURIComponent(token)}`);
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
  const response = await request.post("/api/trpc/user.register", {
    headers: originGatedRequestHeaders(),
    data: { addressProof, email, password, ...(name ? { name } : {}) },
  });
  if (!response.ok()) {
    throw new Error(
      `user.register failed for ${email}: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }
  await confirmAddressOf(email);
}

/**
 * Finishing sign-up signs the person straight in: the browser leaves /auth/signup on its own (the
 * "You're in" card is set in the redirect's tick, so it is not observable), the session belongs to
 * `email`, and nothing on the way asked for a second credential.
 */
export async function thenIAmSignedInWithNoSecondPrompt(page: Page, email: string): Promise<void> {
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
  await expect(page.getByText("Could not use a passkey", { exact: false })).toHaveCount(0);
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
    "/api/trpc/organization.getAll?input=" + encodeURIComponent(JSON.stringify({})),
  );
  const data = (await getAll.json().catch(() => null)) as {
    result?: {
      data?: { teams?: { projects?: unknown[] }[] }[];
    };
  } | null;
  const orgs = data?.result?.data ?? [];
  const hasProject = orgs.some((o) => (o.teams ?? []).some((t) => (t.projects ?? []).length > 0));
  if (hasProject) return;

  const response = await page.request.post("/api/trpc/onboarding.initializeOrganization", {
    data: {
      orgName: "Front Door Test Org",
      projectName: "Front Door Test Project",
      language: "other",
      framework: "other",
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok() || (result as { error?: unknown } | null)?.error) {
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
export async function thenIAmCalledByMyEmailNeverNull(page: Page, email: string): Promise<void> {
  const projectSlug = await getProjectSlug(page);
  // A fresh sign-up can still be redirecting to "/", which interrupts a goto.
  await expect(async () => {
    await page.goto(`/${projectSlug}/messages`);
    expect(new URL(page.url()).pathname).toBe(`/${projectSlug}/messages`);
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
  await page.getByRole("button", { name: `Open user menu for ${email}` }).click();
  // The menu's account line: the email alone for a nameless account, never
  // "null (you@x.com)" or empty parentheses around it.
  const group = page.getByRole("menu").getByText(email, { exact: true });
  await expect(group).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("menu")).not.toContainText("null");
}

/**
 * Declines whichever modal opens first: the join-your-team takeover
 * (confirmed same-domain address) or the passkey nudge (password account).
 * Loops twice — dismissing one is what lets the other's turn come.
 */
export async function whenIDeclineWhatTheShellOffersFirst(page: Page): Promise<void> {
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

    // Whichever modal is on top, decided every round; the takeover first since it covers the nudge.
    // A click may miss as a modal closes itself; the assertion after each press catches a stuck
    // one.
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
 * Declines ONLY the join-your-team takeover, for tests whose subject is the nudge. The takeover
 * goes first: `getByRole` matches by substring, so its "Not now" would steal the click.
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

// =============================================================================
// Sign-in: address -> password, and around it
// =============================================================================

/**
 * Registers a fresh account directly (no UI) with a confirmed address. No `name` is sent:
 * omitting it is exactly the shape a passkey or front-door sign-up leaves behind (finding #6).
 */
export async function givenARegisteredAccount(
  page: Page,
  { email, password = FRONT_DOOR_PASSWORD }: { email: string; password?: string },
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
export async function whenIEnterMyAddressToSignIn(page: Page, email: string): Promise<void> {
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
 * Ends the session via better-auth's endpoint directly — keeps a
 * sign-in/sign-out cycle to exactly the two requests the rate limit counts.
 */
export async function whenISignOut(page: Page): Promise<void> {
  // An empty JSON body, because better-auth answers a bodiless POST with 415
  // (`Content-Type is required`) — `data: {}` is what makes Playwright send
  // `application/json`.
  const response = await page.request.post("/api/auth/sign-out", {
    headers: originGatedRequestHeaders(),
    data: {},
  });
  if (!response.ok()) {
    throw new Error(
      `sign-out failed: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }
}

/**
 * Bug-bash #2: no error flash within a couple seconds of a successful
 * sign-in. `role="alert"` covers both toasts and `HandledErrorAlert`, so
 * this is one check across every failure surface a refusal could use.
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
