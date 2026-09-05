/**
 * The browser's own credentials and the browser's own tRPC wire, for every caller in
 * this suite that has to act as a signed-in user rather than as an API key.
 */

import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_BASE } from "./config";

/** A tRPC call that came back with an error envelope. */
export interface TrpcCallError extends Error {
  /** The domain code nested at `data.error.code`, when the failure had one. */
  domainErrorCode?: string;
  /** The handled error's `meta`, which carries the version a refusal names. */
  domainErrorMeta?: Record<string, unknown>;
  status?: number;
}

let cachedCookie: Promise<string> | null = null;

/**
 * Sign in once (per test process) and cache the better-auth session cookie.
 */
export function getSessionCookie(): Promise<string> {
  cachedCookie ??= (async () => {
    try {
      let res: Response;
      for (let attempt = 1; ; attempt++) {
        res = await fetch(`${APP_BASE}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: APP_BASE },
          body: JSON.stringify({
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        // Every vitest run signs in once, so a burst of runs (a suite driven
        // in chunks) can land on the auth rate limiter. That is the runner
        // being throttled, not a scenario failing: wait out the window.
        if (res.status !== 429 || attempt >= 6) break;
        console.log(`[scenario] sign-in rate-limited (429), waiting 20s (attempt ${attempt})`);
        await new Promise((resolve) => setTimeout(resolve, 20_000));
      }
      if (!res.ok) {
        throw new Error(`Langy test sign-in failed: ${res.status} ${await res.text()}`);
      }
      const setCookie = res.headers.get("set-cookie") ?? "";
      // better-auth only applies the __Secure- prefix on HTTPS origins, so a
      // plain-http local stack sets the bare cookie name. Accept both.
      const match = /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(setCookie);
      if (!match) {
        throw new Error("Langy test sign-in: no better-auth session cookie in response");
      }
      return match[0];
    } catch (error) {
      cachedCookie = null;
      throw error;
    }
  })();
  return cachedCookie;
}

/**
 * The error envelope, read the way the app reads it.
 */
function toCallError({
  path,
  status,
  body,
}: {
  path: string;
  status: number;
  body: any;
}): TrpcCallError {
  const handled = body?.error?.json?.data?.error ?? {};
  const legacy = body?.error?.json?.data?.domainError ?? {};
  const error = new Error(
    `Langy ${path} -> ${status}: ${JSON.stringify(body?.error ?? body)}`,
  ) as TrpcCallError;
  error.domainErrorCode = handled.code ?? legacy.code;
  error.domainErrorMeta = handled.meta ?? legacy.meta;
  error.status = status;
  return error;
}

/**
 * `Origin` travels on every call alongside the cookie: without it the CSRF
 * protection rejects the request before the procedure ever runs.
 */
function sessionHeaders(cookie: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: APP_BASE,
  };
}

export async function trpcMutate<T>({
  cookie,
  path,
  input,
  timeoutMs = 300_000,
}: {
  cookie: string;
  path: string;
  input: unknown;
  /**
   * Generous on purpose for a turn: under a queue backlog the turn mutation has been
   * measured completing server-side at 135s, and a full failure-analysis turn has been
   * measured working past 180s.
   */
  timeoutMs?: number;
}): Promise<T> {
  const res = await fetch(`${APP_BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: sessionHeaders(cookie),
    body: JSON.stringify({ json: input }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw toCallError({ path, status: res.status, body });
  }
  return body.result.data.json as T;
}

/** The query half of the same wire: `GET ?input=<urlencoded {"json":input}>`. */
export async function trpcQuery<T>({
  cookie,
  path,
  input,
  timeoutMs = 60_000,
}: {
  cookie: string;
  path: string;
  input: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const res = await fetch(`${APP_BASE}/api/trpc/${path}?input=${encoded}`, {
    method: "GET",
    headers: sessionHeaders(cookie),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw toCallError({ path, status: res.status, body });
  }
  return body.result.data.json as T;
}
