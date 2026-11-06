import { randomBytes } from "node:crypto";

import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

import { registerConfirmedAccount } from "../front-door/steps";
import { expect } from "../test.ts";

const PASSWORD = "CloudUpgrade123!";

export interface FreeOrganization {
  organizationId: string;
  teamId: string;
  domain: string;
  adminEmail: string;
}

/**
 * paymentsim's origin, read from the variable the app itself is pointed at: `haven env` exports
 * it on a haven stack, the CI job sets it. The checkout page is served from the same origin.
 */
export function paymentsimBaseUrl(): string {
  const url = process.env.STRIPE_API_BASE;
  if (!url) {
    throw new Error(
      "STRIPE_API_BASE is unset: export it from `haven env` (haven) or the CI job, so the journey knows paymentsim's address",
    );
  }
  return url.replace(/\/+$/, "");
}

/** A tRPC call in the request context's session; a refusal or an empty answer throws. */
async function call<T>({
  request,
  kind,
  path,
  input,
}: {
  request: APIRequestContext;
  kind: "query" | "mutation";
  path: string;
  input: unknown;
}): Promise<T> {
  const response =
    kind === "query"
      ? await request.get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
      : await request.post(`/api/trpc/${path}`, { data: input });
  const body: { result?: { data?: T }; error?: unknown } | null = await response
    .json()
    .catch(() => null);
  if (!response.ok() || body?.error) {
    throw new Error(
      `${path} refused (${response.status()}): ${JSON.stringify(body?.error ?? body).slice(0, 500)}`,
    );
  }
  const data = body?.result?.data;
  if (data === undefined) throw new Error(`${path} answered no data`);
  return data;
}

async function signInWithPassword({ page, email }: { page: Page; email: string }): Promise<void> {
  await page.goto("/auth/signin?callbackUrl=%2F");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/auth\/signin/);
  // The shell's offers would cover every later screen; auth.setup.ts dismisses the same two.
  await page.request.post("/api/trpc/user.dismissSecureAccountNudge", { data: {} });
  await page.request.post("/api/trpc/identity.joinRequests.dismissOffer", { data: {} });
}

/**
 * An administrator who signed up and created an organization, on its own domain so runs on a
 * long-lived stack never meet. A new Cloud organization starts on the Free plan.
 */
export async function givenAnAdministratorOfAFreeOrganization({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}): Promise<FreeOrganization> {
  const domain = `upgrade-${randomBytes(4).toString("hex")}.test`;
  const adminEmail = `admin@${domain}`;
  await registerConfirmedAccount(request, {
    name: "Upgrade Admin",
    email: adminEmail,
    password: PASSWORD,
  });
  await signInWithPassword({ page, email: adminEmail });
  const orgName = `Upgrade ${domain}`;
  await call({
    request: page.request,
    kind: "mutation",
    path: "onboarding.initializeOrganization",
    input: { orgName, projectName: "Upgrade Project", language: "other", framework: "other" },
  });
  const orgs = await call<{ id: string; name: string; teams?: { id: string }[] }[]>({
    request: page.request,
    kind: "query",
    path: "organization.getAll",
    input: {},
  });
  const org = orgs.find((candidate) => candidate.name === orgName);
  const teamId = org?.teams?.[0]?.id;
  if (!org || !teamId) throw new Error(`organization.getAll did not list ${orgName} with a team`);
  return { organizationId: org.id, teamId, domain, adminEmail };
}

/**
 * A second person invited by the administrator with the Member role, who signs up under the
 * invited address and accepts. Answers the Member's own signed-in page, in its own context.
 */
export async function givenAMemberJoinedByInvitation({
  admin,
  browser,
  baseURL,
  org,
}: {
  admin: Page;
  browser: Browser;
  baseURL: string | undefined;
  org: FreeOrganization;
}): Promise<{ member: Page; context: BrowserContext }> {
  const email = `member@${org.domain}`;
  const [issued] = await call<{ invite: { inviteCode: string } }[]>({
    request: admin.request,
    kind: "mutation",
    path: "invite.createInvites",
    input: {
      organizationId: org.organizationId,
      invites: [{ email, role: "MEMBER", teams: [{ teamId: org.teamId, role: "MEMBER" }] }],
    },
  });
  if (!issued) throw new Error(`no invitation was issued for ${email}`);

  const context = await browser.newContext({ baseURL });
  const member = await context.newPage();
  await member.emulateMedia({ reducedMotion: "reduce" });
  await registerConfirmedAccount(context.request, {
    name: "Upgrade Member",
    email,
    password: PASSWORD,
  });
  await signInWithPassword({ page: member, email });
  await call({
    request: member.request,
    kind: "mutation",
    path: "invite.acceptInvite",
    input: { inviteCode: issued.invite.inviteCode },
  });
  return { member, context };
}

/** The subscription page with the Free plan card loaded. */
export async function whenIOpenTheSubscriptionPageOnTheFreePlan({
  page,
}: {
  page: Page;
}): Promise<void> {
  await page.goto("/settings/subscription");
  await expect(page.getByTestId("current-plan-name")).toContainText("Free", { timeout: 30000 });
}

export async function whenIPressUpgradeToGrowth({ page }: { page: Page }): Promise<void> {
  await page.getByRole("button", { name: "Upgrade to Growth" }).click();
}

/** The browser left the app for paymentsim's hosted checkout page, which knows the session. */
export async function thenIAmOnTheCheckoutPage({ page }: { page: Page }): Promise<void> {
  const checkout = `${paymentsimBaseUrl()}/checkout/`;
  await page.waitForURL((url) => url.href.startsWith(checkout), { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "paymentsim checkout" })).toBeVisible();
}

/** Pays on the checkout page; paymentsim completes the session and sends the browser back. */
export async function whenIPayOnTheCheckoutPage({ page }: { page: Page }): Promise<void> {
  await page.getByRole("button", { name: "Pay" }).click();
}

/**
 * Back on the subscription page after the checkout. The plan changes once billing has processed
 * the provider's webhooks, which happens after the redirect, so the page is reloaded until then.
 */
export async function thenTheOrganizationIsOnGrowth({ page }: { page: Page }): Promise<void> {
  await page.waitForURL(
    (url) => url.pathname === "/settings/subscription" && url.searchParams.has("success"),
  );
  await expect(page.getByTestId("subscription-success")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("current-plan-name")).toContainText("Growth", { timeout: 5000 });
  }).toPass({ timeout: 90000, intervals: [2000, 5000] });
}
