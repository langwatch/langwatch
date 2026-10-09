import { type APIRequestContext, expect } from "@playwright/test";

/** One recorded request at a tenant (services/idpsim/activity.go). */
export interface IdpsimEvent {
  at: string;
  kind: string;
  outcome: "ok" | "refused";
  client?: string;
  subject?: string;
  detail: string;
}

export interface IdpsimApp {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

/** The simulator's haven route: the overlay's LANGWATCH_IDPSIM_URL, never a port. */
export function idpsimBaseUrl(): string {
  const url = process.env.LANGWATCH_IDPSIM_URL;
  if (!url) {
    throw new Error(
      "LANGWATCH_IDPSIM_URL is unset: export it from `haven env` (haven) or the CI job",
    );
  }
  return url.replace(/\/+$/, "");
}

export function tenantUrl({ tenant }: { tenant: number }): string {
  return `${idpsimBaseUrl()}/t/${tenant}`;
}

async function control<T>({
  request,
  method,
  path,
  body,
}: {
  request: APIRequestContext;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
}): Promise<T> {
  const response = await request.fetch(`${idpsimBaseUrl()}/control${path}`, { method, data: body });
  if (!response.ok()) {
    throw new Error(
      `idpsim ${method} ${path} answered ${response.status()}: ${await response.text()}`,
    );
  }
  return response.json();
}

/** Registers a relying party, which turns secret and redirect enforcement on for its client. */
export async function registerApp({
  request,
  tenant,
  name,
  redirectUris = [],
  entityId,
  acsUrl,
}: {
  request: APIRequestContext;
  tenant: number;
  name: string;
  redirectUris?: string[];
  entityId?: string;
  acsUrl?: string;
}): Promise<IdpsimApp> {
  const app = await control<IdpsimApp>({
    request,
    method: "POST",
    path: `/t/${tenant}/apps`,
    body: { name, redirectUris, entityId, acsUrl },
  });
  return app;
}

export async function addUser({
  request,
  tenant,
  email,
}: {
  request: APIRequestContext;
  tenant: number;
  email: string;
}): Promise<void> {
  await control({ request, method: "POST", path: `/t/${tenant}/users`, body: { email } });
}

/** Publishes a TXT record on the simulator's verification DNS. */
export async function publishTxt({
  request,
  domain,
  values,
}: {
  request: APIRequestContext;
  domain: string;
  values: string[];
}): Promise<void> {
  await control({ request, method: "PUT", path: "/dns/txt", body: { domain, values } });
}

export async function samlMetadata({
  request,
  tenant,
}: {
  request: APIRequestContext;
  tenant: number;
}): Promise<string> {
  const response = await request.get(`${tenantUrl({ tenant })}/saml/metadata`);
  expect(response.ok()).toBe(true);
  return response.text();
}

export async function activity({
  request,
  tenant,
}: {
  request: APIRequestContext;
  tenant: number;
}): Promise<IdpsimEvent[]> {
  const feed = await control<{ events: IdpsimEvent[] | null }>({
    request,
    method: "GET",
    path: `/t/${tenant}/activity`,
  });
  return feed.events ?? [];
}

/** Waits until the tenant recorded a successful step of `kind` that matches. */
export async function expectReachedIdp({
  request,
  tenant,
  kind,
  client,
  subject,
}: {
  request: APIRequestContext;
  tenant: number;
  kind: string;
  client?: string;
  subject?: string;
}): Promise<void> {
  await expect
    .poll(async () =>
      (await activity({ request, tenant })).some(
        (event) =>
          event.kind === kind &&
          event.outcome === "ok" &&
          (client === undefined || event.client === client) &&
          (subject === undefined || event.subject?.toLowerCase() === subject.toLowerCase()),
      ),
    )
    .toBe(true);
}

/* Fault controls, for the refusal journeys (SL3); the happy paths never call them. */

export async function armTamper({
  request,
  tenant,
  mode,
}: {
  request: APIRequestContext;
  tenant: number;
  mode: string;
}): Promise<void> {
  await control({ request, method: "POST", path: `/t/${tenant}/tamper`, body: { mode } });
}

export async function setSkew({
  request,
  tenant,
  skewSeconds,
}: {
  request: APIRequestContext;
  tenant: number;
  skewSeconds: number;
}): Promise<void> {
  await control({ request, method: "POST", path: `/t/${tenant}/config`, body: { skewSeconds } });
}

export async function setUserActive({
  request,
  tenant,
  user,
  active,
}: {
  request: APIRequestContext;
  tenant: number;
  user: string;
  active: boolean;
}): Promise<void> {
  await control({
    request,
    method: "POST",
    path: `/t/${tenant}/user-active`,
    body: { user, active },
  });
}

export async function unsolicitedSamlResponse({
  request,
  tenant,
  acsUrl,
  email,
  relayState,
}: {
  request: APIRequestContext;
  tenant: number;
  acsUrl: string;
  email: string;
  relayState?: string;
}): Promise<{ url: string; samlResponse: string; relayState: string }> {
  const post = await control<{ url: string; samlResponse: string; relayState: string }>({
    request,
    method: "POST",
    path: `/t/${tenant}/saml/unsolicited`,
    body: { acsUrl, email, relayState },
  });
  return post;
}
