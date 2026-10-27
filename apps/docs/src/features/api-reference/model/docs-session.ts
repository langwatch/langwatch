import { z } from "zod/mini";

import { liveRequest, type RequestState } from "./codegen.ts";
import type { Operation, Scheme } from "./operation.ts";

/** The message type the app's consent page posts back to the docs (ADR-185). */
export const DOCS_SESSION_MESSAGE = "langwatch:docs-session";
/** How long the docs wait for the consent page before giving up. */
export const CONNECT_TIMEOUT_MS = 120_000;
/** The app's REST door a docs session key revokes itself through. */
export const REVOKE_PATH = "/api/docs-session";

export type DocsSession = {
  token: string;
  /** When the key ends on this page's monotonic clock (`performance.now()`), not the wall clock. */
  endsAt: number;
  project: { id: string; name: string };
  appOrigin: string;
};

const grantSchema = z.object({
  type: z.literal(DOCS_SESSION_MESSAGE),
  version: z.literal(1),
  state: z.string(),
  outcome: z.literal("granted"),
  token: z.string().check(z.minLength(16)),
  expiresAt: z.iso.datetime({ offset: true }),
  expiresIn: z.number().check(z.positive()),
  project: z.object({ id: z.string().check(z.minLength(1)), name: z.string() }),
});
const denialSchema = z.object({
  type: z.literal(DOCS_SESSION_MESSAGE),
  version: z.literal(1),
  state: z.string(),
  outcome: z.literal("denied"),
});

/** The app the playground connects to: the configured origin, or the page's own for "self". */
export function resolveAppOrigin({
  configured,
  pageOrigin,
}: {
  configured: string;
  pageOrigin: string;
}): string {
  if (!configured) return "";
  return configured === "self" ? pageOrigin : configured;
}

/** A single-use, 256-bit state value, base64url without padding (43 characters). */
export function newConnectState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** The consent page for this docs origin and state; the token never travels in a URL. */
export function connectUrl({
  appOrigin,
  docsOrigin,
  state,
}: {
  appOrigin: string;
  docsOrigin: string;
  state: string;
}): string {
  const url = new URL("/connect/docs", appOrigin);
  url.searchParams.set("origin", docsOrigin);
  url.searchParams.set("state", state);
  return url.href;
}

/**
 * The consent page's answer for this state, or null for anything else: a message of another
 * type, another state, or a malformed body. The caller has already checked origin and source.
 */
export function readConsentAnswer({
  data,
  state,
  appOrigin,
  receivedAt,
}: {
  data: unknown;
  state: string;
  appOrigin: string;
  /** `performance.now()` when the answer arrived; the key's lifetime counts from here. */
  receivedAt: number;
}): { outcome: "granted"; session: DocsSession } | { outcome: "denied" } | null {
  const denial = denialSchema.safeParse(data);
  if (denial.success) return denial.data.state === state ? { outcome: "denied" } : null;
  const grant = grantSchema.safeParse(data);
  if (!grant.success || grant.data.state !== state) return null;
  const { token, project, expiresIn } = grant.data;
  const endsAt = receivedAt + expiresIn * 1000;
  return { outcome: "granted", session: { token, endsAt, project, appOrigin } };
}

/** A docs session key is a project key: it can answer only operations that take `X-Auth-Token`. */
export function sessionCovers({ scheme }: { scheme?: Scheme }): boolean {
  return scheme?.type === "apiKey" && scheme.in === "header" && scheme.name === "X-Auth-Token";
}

/** The live request sent as the connected member: the app's API, the key as X-Auth-Token. */
export function connectedRequest({
  operation,
  state,
  session,
}: {
  operation: Operation;
  state: RequestState;
  session: DocsSession;
}) {
  const request = liveRequest({ operation, state, key: "" });
  const url = new URL(request.url);
  const target = new URL(`${url.pathname}${url.search}`, session.appOrigin);
  return {
    url: target.href,
    headers: { ...request.headers, "X-Auth-Token": session.token },
    body: request.body,
  };
}
