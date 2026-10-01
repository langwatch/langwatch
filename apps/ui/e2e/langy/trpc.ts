/**
 * The browser's own credentials and tRPC wire, for a caller acting as a
 * signed-in user rather than an API key. See README.md "trpc.ts" for the
 * three credentials in play and the wire format.
 */

import { APP_BASE, CONFIG } from "./config";
import { openLocalAccountStore, seedCredentialAccount } from "./seed-account";

/** A tRPC call that came back with an error envelope. */
export interface TrpcCallError extends Error {
  /** The domain code nested at `data.error.code`, when the failure had one. */
  domainErrorCode?: string;
  /** The handled error's `meta`, which carries the version a refusal names. */
  domainErrorMeta?: Record<string, unknown>;
  status?: number;
}

let cachedCookie: Promise<string> | null = null;

/** Forget the cached session, so the next call signs in again. */
export function resetSessionCookie(): void {
  cachedCookie = null;
}

/**
 * Seeds an account a scenario can sign in with (see README.md "trpc.ts").
 * `useAccount` still has to point at the new credentials for the session
 * helper below to use them.
 */
export async function signUpAccount({
  name,
  email,
  password,
}: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  const store = await openLocalAccountStore({ appBase: APP_BASE });
  await seedCredentialAccount({ name, email, password, store });
}

/** Retries a timed-out fetch or a rate-limited reply (README.md "trpc.ts"). */
async function signInOnce(): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${APP_BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: APP_BASE },
        body: JSON.stringify({
          email: CONFIG.ADMIN_EMAIL,
          password: CONFIG.ADMIN_PASSWORD,
        }),
        // A loaded stack answers the sign-in in tens of seconds (README.md "trpc.ts").
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (
        attempt < 3 &&
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        console.log(`[scenario] sign-in timed out, retrying (attempt ${attempt})`);
        continue;
      }
      throw error;
    }
    // A burst of runs can land on the auth rate limiter (README.md "trpc.ts").
    if (res.status !== 429 || attempt >= 6) return res;
    console.log(`[scenario] sign-in rate-limited (429), waiting 20s (attempt ${attempt})`);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
}

/**
 * Signs in once per test process and caches the session cookie, clearing
 * the cache on rejection (see README.md "trpc.ts" for why `??=` alone is
 * not enough here).
 */
export function getSessionCookie(): Promise<string> {
  cachedCookie ??= (async () => {
    try {
      const res = await signInOnce();
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
 * The error envelope, read the way the app reads it — the domain code at
 * `data.error.code` (see README.md "trpc.ts" for the path this replaced).
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
  /** Generous on purpose for a turn — see README.md "trpc.ts" for why. */
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
