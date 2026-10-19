import { randomBytes } from "node:crypto";

import type { APIRequestContext, Browser, Page } from "@playwright/test";

import { findUserIdByEmail } from "../front-door/db";
import { originGatedRequestHeaders, registerConfirmedAccount } from "../front-door/steps";
import { expect } from "../test.ts";
import {
  addUser,
  expectReachedIdp,
  idpsimBaseUrl,
  publishTxt,
  registerApp,
  samlMetadata,
  tenantUrl,
} from "./idpsim.ts";

/** Every journey uses tenant 1 with its own domain and its own registered application. */
export const TENANT = 1;
const PASSWORD = "SsoJourney123!";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface Organisation {
  domain: string;
  adminEmail: string;
  organizationId: string;
}

export interface Connection {
  connectionId: string;
  clientId: string | null;
}

/* The suite carries its own dependencies, so these few reads mirror the sso contract's shapes. */
type DomainProof = { proved: true } | { proved: false; record: { name: string; value: string } };

export function newDomain(): string {
  return `sl2-${randomBytes(4).toString("hex")}.test`;
}

export function appOrigin({ baseURL }: { baseURL: string | undefined }): string {
  if (!baseURL) throw new Error("the sso project needs a baseURL");
  return new URL(baseURL).origin;
}

/** A tRPC call in the page's session, answered as data or the refusal it carried. */
export async function trpc<T>({
  request,
  kind,
  path,
  input,
}: {
  request: APIRequestContext;
  kind: "query" | "mutation";
  path: string;
  input: unknown;
}): Promise<{ data: T | undefined; error: unknown; status: number }> {
  const response =
    kind === "query"
      ? await request.get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
      : await request.post(`/api/trpc/${path}`, { data: input });
  const body: { result?: { data?: T }; error?: unknown } | null = await response
    .json()
    .catch(() => null);
  const error = body?.error ?? (response.ok() ? null : (body ?? response.statusText()));
  return { data: body?.result?.data, error, status: response.status() };
}

async function call<T>(args: Parameters<typeof trpc>[0]): Promise<T> {
  const answer = await trpc<T>(args);
  if (answer.error) {
    throw new Error(
      `${args.path} refused (${answer.status}): ${JSON.stringify(answer.error).slice(0, 500)}`,
    );
  }
  return answer.data ?? Promise.reject(new Error(`${args.path} answered no data`));
}

export function withLoginHint({ url, email }: { url: string; email: string }): string {
  const hinted = new URL(url);
  hinted.searchParams.set("login_hint", email);
  return hinted.href;
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

/** An administrator with a confirmed local account, owning an organisation, in the directory. */
export async function givenAnAdministratorOwningAnOrganisation({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}): Promise<Organisation> {
  const domain = newDomain();
  const adminEmail = `admin@${domain}`;
  await addUser({ request, tenant: TENANT, email: adminEmail });
  await registerConfirmedAccount(request, {
    name: "SSO Admin",
    email: adminEmail,
    password: PASSWORD,
  });
  await signInWithPassword({ page, email: adminEmail });
  const orgName = `SSO ${domain}`;
  await call({
    request: page.request,
    kind: "mutation",
    path: "onboarding.initializeOrganization",
    input: { orgName, projectName: "SSO Project", language: "other", framework: "other" },
  });
  const orgs = await call<{ id: string; name: string }[]>({
    request: page.request,
    kind: "query",
    path: "organization.getAll",
    input: {},
  });
  const organizationId = orgs.find((org) => org.name === orgName)?.id;
  if (!organizationId) throw new Error(`organization.getAll did not list ${orgName}`);
  return { domain, adminEmail, organizationId };
}

export async function registerOidcConnection({
  page,
  baseURL,
  org,
}: {
  page: Page;
  baseURL: string | undefined;
  org: Organisation;
}): Promise<Connection> {
  const app = await registerApp({
    request: page.request,
    tenant: TENANT,
    name: `LangWatch ${org.domain}`,
    redirectUris: [`${appOrigin({ baseURL })}/api/auth/sso/callback/{connection}`],
  });
  const { connectionId } = await call<{ connectionId: string }>({
    request: page.request,
    kind: "mutation",
    path: "ssoSetup.register",
    input: {
      organizationId: org.organizationId,
      providerId: `oidc ${org.domain}`,
      idp: {
        protocol: "oidc",
        issuer: app.issuer,
        clientId: app.clientId,
        clientSecret: app.clientSecret,
      },
    },
  });
  return { connectionId, clientId: app.clientId };
}

export async function registerSamlConnection({
  page,
  baseURL,
  org,
}: {
  page: Page;
  baseURL: string | undefined;
  org: Organisation;
}): Promise<Connection> {
  const metadataXml = await samlMetadata({ request: page.request, tenant: TENANT });
  const { connectionId } = await call<{ connectionId: string }>({
    request: page.request,
    kind: "mutation",
    path: "ssoSetup.register",
    input: {
      organizationId: org.organizationId,
      providerId: `saml ${org.domain}`,
      idp: {
        protocol: "saml",
        entryPoint: `${tenantUrl({ tenant: TENANT })}/saml/sso`,
        entityId: null,
        metadataXml,
        certificate: null,
      },
    },
  });
  const auth = `${appOrigin({ baseURL })}/api/auth`;
  await registerApp({
    request: page.request,
    tenant: TENANT,
    name: `LangWatch SAML ${org.domain}`,
    entityId: `${auth}/sso/saml2/sp`,
    acsUrl: `${auth}/sso/saml2/sp/acs/${connectionId}`,
  });
  return { connectionId, clientId: null };
}

/** Claims the domain and proves it with LangWatch's TXT record, published at idpsim's DNS. */
export async function proveDomain({
  page,
  org,
  connection,
}: {
  page: Page;
  org: Organisation;
  connection: Connection;
}): Promise<void> {
  const input = {
    organizationId: org.organizationId,
    connectionId: connection.connectionId,
    domain: org.domain,
  };
  const claim = await call<{ waitsForReview: boolean }>({
    request: page.request,
    kind: "mutation",
    path: "ssoSetup.claimDomain",
    input,
  });
  if (claim.waitsForReview) {
    throw new Error(
      `the claim on ${org.domain} waits for operator review; the journey has no operator step`,
    );
  }
  const proof = await call<DomainProof>({
    request: page.request,
    kind: "mutation",
    path: "ssoSetup.proveDomain",
    input,
  });
  if (proof.proved) return;
  await publishTxt({
    request: page.request,
    domain: proof.record.name,
    values: [proof.record.value],
  });
  await expect
    .poll(async () => {
      const check = await trpc({
        request: page.request,
        kind: "mutation",
        path: "ssoSetup.checkDomainRecord",
        input,
      });
      return check.error === null;
    })
    .toBe(true);
}

/** The administrator's own round trip through the IdP, which go-live requires. */
export async function completeTestSignIn({
  page,
  baseURL,
  org,
  connection,
}: {
  page: Page;
  baseURL: string | undefined;
  org: Organisation;
  connection: Connection;
}): Promise<void> {
  const origin = appOrigin({ baseURL });
  const started = await page.request.post("/api/auth/sign-in/sso", {
    data: {
      providerId: connection.connectionId,
      callbackURL: `${origin}/settings?ssoTest=${encodeURIComponent(connection.connectionId)}`,
    },
    headers: originGatedRequestHeaders(),
  });
  const body: { url?: string } | null = await started.json().catch(() => null);
  if (!started.ok() || !body?.url) {
    throw new Error(`sign-in/sso did not start (${started.status()}): ${JSON.stringify(body)}`);
  }
  await page.goto(withLoginHint({ url: body.url, email: org.adminEmail }));
  await page.waitForURL((url) => url.origin === origin);
  await expectReachedIdp({
    request: page.request,
    tenant: TENANT,
    kind: connection.clientId ? "oidc.token" : "saml.sso",
    client: connection.clientId ?? undefined,
    subject: org.adminEmail,
  });
}

/** Names break-glass, admits arrivals and activates; activate names anything missing. */
export async function goLive({
  page,
  org,
  connection,
}: {
  page: Page;
  org: Organisation;
  connection: Connection;
}): Promise<void> {
  const { organizationId } = org;
  const { connectionId } = connection;
  const candidates = await call<{ userId: string; email: string | null }[]>({
    request: page.request,
    kind: "query",
    path: "ssoSetup.breakGlassCandidates",
    input: { organizationId },
  });
  const admin = candidates.find((candidate) => candidate.email === org.adminEmail) ?? candidates[0];
  if (!admin) throw new Error("no break-glass candidate offered");
  await call({
    request: page.request,
    kind: "mutation",
    path: "ssoSetup.grantBreakGlass",
    input: { organizationId, userId: admin.userId, expiresAtMs: Date.now() + WEEK_MS },
  });
  await call({
    request: page.request,
    kind: "mutation",
    path: "ssoSetup.setArrivals",
    input: { organizationId, connectionId, policy: "admit" },
  }).catch(rethrowUnlessNoData);
  await call({
    request: page.request,
    kind: "mutation",
    path: "ssoSetup.activate",
    input: { organizationId, connectionId },
  }).catch(rethrowUnlessNoData);
}

/* A void mutation answers no data; only a refusal is a failure. */
function rethrowUnlessNoData(error: unknown): void {
  if (error instanceof Error && error.message.endsWith("answered no data")) return;
  throw error;
}

/** The connection's state as the setup page reports it. */
export async function connectionState({
  page,
  org,
  connection,
}: {
  page: Page;
  org: Organisation;
  connection: Connection;
}): Promise<string | null> {
  const setup = await call<unknown>({
    request: page.request,
    kind: "query",
    path: "ssoSetup.getSetup",
    input: { organizationId: org.organizationId },
  });
  return stateOf({ value: setup, connectionId: connection.connectionId });
}

function stateOf({ value, connectionId }: { value: unknown; connectionId: string }): string | null {
  if (Array.isArray(value)) {
    return (
      value.map((item) => stateOf({ value: item, connectionId })).find((state) => state !== null) ??
      null
    );
  }
  if (typeof value !== "object" || value === null) return null;
  const record = Object.fromEntries(Object.entries(value));
  if (record.connectionId === connectionId && typeof record.state === "string") return record.state;
  return stateOf({ value: Object.values(record), connectionId });
}

/** A fresh browser, the identifier-first sign-in screen, and the IdP answering for `email`. */
export async function signInThroughSso({
  browser,
  baseURL,
  email,
}: {
  browser: Browser;
  baseURL: string | undefined;
  email: string;
}): Promise<Page> {
  const origin = appOrigin({ baseURL });
  const context = await browser.newContext({ baseURL: origin });
  const idp = idpsimBaseUrl();
  await context.route(
    (url) => url.href.startsWith(idp) && /\/(oauth\/authorize|saml\/sso)$/.test(url.pathname),
    (route) => route.continue({ url: withLoginHint({ url: route.request().url(), email }) }),
  );
  const page = await context.newPage();
  await page.goto("/auth/signin?callbackUrl=%2F");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL((url) => url.href.startsWith(idp));
  await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith("/auth/"));
  return page;
}

export async function sessionUser({
  page,
}: {
  page: Page;
}): Promise<{ id: string; email: string }> {
  const response = await page.request.get("/api/auth/get-session");
  const session: { user?: { id: string; email: string } } | null = await response
    .json()
    .catch(() => null);
  if (!session?.user) throw new Error(`no session after the sign-in (${response.status()})`);
  return session.user;
}

export async function givenAConfirmedLocalAccount({
  request,
  email,
}: {
  request: APIRequestContext;
  email: string;
}): Promise<string> {
  await registerConfirmedAccount(request, { name: "Local Member", email, password: PASSWORD });
  const userId = await findUserIdByEmail(email);
  if (!userId) throw new Error(`no local account for ${email}`);
  return userId;
}

export async function memberOf({
  page,
  organizationId,
}: {
  page: Page;
  organizationId: string;
}): Promise<boolean> {
  const orgs = await call<{ id: string }[]>({
    request: page.request,
    kind: "query",
    path: "organization.getAll",
    input: {},
  });
  return orgs.some((org) => org.id === organizationId);
}

/** Registers, proves, test-signs-in and activates an OIDC connection (S01, S07, S10). */
export async function givenALiveOidcConnection({
  page,
  request,
  baseURL,
}: {
  page: Page;
  request: APIRequestContext;
  baseURL: string | undefined;
}): Promise<{ org: Organisation; connection: Connection }> {
  const org = await givenAnAdministratorOwningAnOrganisation({ page, request });
  const connection = await registerOidcConnection({ page, baseURL, org });
  await proveDomain({ page, org, connection });
  await completeTestSignIn({ page, baseURL, org, connection });
  await goLive({ page, org, connection });
  return { org, connection };
}
