/**
 * The browser's own credentials and the browser's own tRPC wire, for every
 * caller in this suite that has to act as a signed-in user rather than as an
 * API key.
 *
 * Three credentials are in play across the suite and mixing them is the easiest
 * mistake here:
 *
 * | Surface | Credential |
 * |---|---|
 * | `langy.*`, `experiments.saveEvaluationsV3`, `experiments.getEvaluationsV3BySlug`, `POST /api/experiments/execute` | the session cookie below |
 * | `GET/PUT /api/experiments/:slug/workbench-state`, `GET /api/experiments/runs*`, `POST /api/experiments` | `X-Auth-Token` (workbench-rest.ts) |
 * | `POST /api/langy/ui/actions` | the agent worker's own session key, never the suite's |
 *
 * Wire format (POST body `{"json": input}`, response
 * `{"result":{"data":{"json": output}}}`) was confirmed directly against a live
 * haven stack; see README.md for how to point this at a different stack.
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
 * Clears the cache on rejection: otherwise a single transient sign-in
 * failure (a momentary network blip, the app mid-restart) would permanently
 * poison every remaining test in the run, since `??=` only checks for
 * null/undefined at assignment time and a rejected promise is neither.
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
        console.log(
          `[scenario] sign-in rate-limited (429), waiting 20s (attempt ${attempt})`,
        );
        await new Promise((resolve) => setTimeout(resolve, 20_000));
      }
      if (!res.ok) {
        throw new Error(
          `Langy test sign-in failed: ${res.status} ${await res.text()}`,
        );
      }
      const setCookie = res.headers.get("set-cookie") ?? "";
      // better-auth only applies the __Secure- prefix on HTTPS origins, so a
      // plain-http local stack sets the bare cookie name. Accept both.
      const match = /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(
        setCookie,
      );
      if (!match) {
        throw new Error(
          "Langy test sign-in: no better-auth session cookie in response",
        );
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
 *
 * The tRPC error envelope nests the domain code at `data.error.code` (see the
 * langy_turn_in_progress payload:
 * `{"json":{"data":{"error":{"code":"langy_turn_in_progress"}}}}`). The old
 * `data.domainError.code` path never matched anything, which silently disabled
 * the turn-lock retry.
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
   * Generous on purpose for a turn: under a queue backlog the turn mutation
   * has been measured completing server-side at 135s, and a full
   * failure-analysis turn has been measured working past 180s. Aborting a
   * still-working turn destroys the run (the judge grades a one-token reply),
   * and retrying is worse: the retry races the accepted first attempt into
   * langy_turn_in_progress.
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
