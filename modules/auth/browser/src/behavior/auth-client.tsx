"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { clearPersistedUiQueries } from "@langwatch/browser-host/query-persistence";
import { clearReaderUiStorage, clearSessionUiStorage } from "@langwatch/browser-host/storage";
import { AUTH0_BRIDGE_METHODS, looksLikeSsoConnectionId } from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";
import { createAuthClient } from "better-auth/react";
import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { promotePendingMethod } from "../model/last-used-method.ts";
import { hardNavigate } from "./browser-navigation.ts";

/**
 * The passkey plugin is declared unconditionally, and the METHOD SET decides whether anyone is
 * offered one: the server registers its half only when `PASSKEYS_ENABLED` is on, and the
 * sign-in router never names a passkey unless the same env says so.
 */
const client = createAuthClient({ plugins: [passkeyClient()] });

export const authClient = client;

const ssoRefusalSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
  status: z.number().optional(),
});
const ssoRedirectSchema = z.object({ url: z.string().optional() });

interface CompatSession {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    pendingSsoSetup?: boolean;
    impersonator?: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  };
  expires: string;
}

const adaptSession = (data: unknown): CompatSession | null => {
  if (!data || typeof data !== "object") return null;
  const raw = data as {
    // Better Auth returns the raw session payload; the narrowing below owns its shape.
    session?: { expiresAt?: unknown };
    user?: Record<string, unknown>;
  };
  const user = raw.user;
  if (!user || typeof user !== "object" || typeof user.id !== "string") {
    return null;
  }
  const expiresAt = raw.session?.expiresAt;
  return {
    user: {
      id: user.id,
      name: (user.name as string | null | undefined) ?? null,
      email: (user.email as string | null | undefined) ?? null,
      image: (user.image as string | null | undefined) ?? null,
      pendingSsoSetup: (user.pendingSsoSetup as boolean | undefined) ?? false,
      impersonator: user.impersonator as CompatSession["user"]["impersonator"],
    },
    expires: expiresOf(expiresAt),
  };
};

function expiresOf(expiresAt: unknown): string {
  if (expiresAt instanceof Date) return expiresAt.toISOString();
  if (typeof expiresAt === "string") return expiresAt;
  return nowInstant().toString({ fractionalSecondDigits: 3 });
}

function sessionStatusOf({
  isPending,
  hasData,
}: {
  isPending: boolean;
  hasData: boolean;
}): SessionStatus {
  if (isPending) return "loading";
  return hasData ? "authenticated" : "unauthenticated";
}

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface UseSessionOptions {
  required?: boolean;
  onUnauthenticated?: () => void;
}

/**
 * Fetches the impersonation-aware session from our custom endpoint.
 */
// Module-level session cache — survives component unmount/remount so navigating between pages
// doesn't flash <LoadingScreen /> while the session is re-fetched.
let _cachedSession: CompatSession | null = null;
// Dedup in-flight fetches: multiple useSession() hooks mounting at the
// same time share a single /api/auth/session request instead of each
// firing their own.
let _inflight: Promise<CompatSession | null> | null = null;
// Subscribers: all mounted useSession() hooks that need to be notified
// when the shared fetch resolves.
const _subscribers = new Set<(session: CompatSession | null) => void>();

async function _fetchSessionShared(): Promise<CompatSession | null> {
  if (_inflight !== null) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/auth/session", { credentials: "include" });
      if (!res.ok) return _cachedSession;
      const json = await res.json();
      const session = adaptSession(json);
      _cachedSession = session;
      // Every landing passes through here, wherever a provider's callback put the browser, so
      // this is where a parked social method becomes the badge. A no-op when nothing is parked.
      if (session) promotePendingMethod();
      return session;
    } catch {
      return _cachedSession;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export const useSession = (
  options?: UseSessionOptions,
): {
  data: CompatSession | null;
  status: SessionStatus;
  update: () => Promise<void>;
} => {
  const [data, setData] = useState<CompatSession | null>(_cachedSession);
  const [isPending, setIsPending] = useState(_cachedSession === null);

  useEffect(() => {
    // Subscribe to shared fetch results so all hooks update together
    const handler = (session: CompatSession | null) => {
      setData(session);
      setIsPending(false);
    };
    _subscribers.add(handler);

    // If we already have cached data, skip fetching
    if (_cachedSession) {
      setData(_cachedSession);
      setIsPending(false);
    } else {
      void _fetchSessionShared().then((session) => {
        // Notify all subscribers (including this one)
        for (const sub of _subscribers) sub(session);
      });
    }

    return () => {
      _subscribers.delete(handler);
    };
  }, []);

  const status = sessionStatusOf({ isPending, hasData: Boolean(data) });

  const required = options?.required;
  const onUnauthenticated = options?.onUnauthenticated;
  useEffect(() => {
    if (required && status === "unauthenticated" && onUnauthenticated) {
      onUnauthenticated();
    }
  }, [required, onUnauthenticated, status]);

  const update = useCallback(async () => {
    // Force a fresh fetch (bypass inflight dedup) and notify all subscribers
    _inflight = null;
    const session = await _fetchSessionShared();
    for (const sub of _subscribers) sub(session);
  }, []);

  return {
    data,
    status,
    update,
  };
};

/** The two-factor plugin's own flag for a challenge in place of a session. */
function isTwoStepChallenge(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "twoFactorRedirect" in data &&
    data.twoFactorRedirect === true
  );
}

type SignInResult =
  | {
      error?: string;
      code?: string;
      status?: number;
      ok?: boolean;
      /**
       * Seconds to wait, when the refusal was a rate limit that said so. The
       * header carries the real remaining window, and a screen that has it can
       * say how long instead of guessing "a minute".
       */
      retryAfterSeconds?: number;
      /** A correct password still owes a second factor; no session exists yet. */
      twoStepRequired?: boolean;
    }
  | undefined;

async function signInWithPassword({
  options,
  target,
  shouldRedirect,
}: {
  options: { email?: string; password?: string } | undefined;
  /** Where the user goes on success; navigated to directly, never via better-auth. */
  target: string | undefined;
  shouldRedirect: boolean;
}): Promise<SignInResult> {
  // A target left by an abandoned provider sign-in must not outlive this one.
  clearReturnTo();
  // better-auth refuses some targets outright, and this path navigates to the
  // target itself, so it is only handed one it accepts and otherwise none.
  const callbackURL = target !== undefined && betterAuthAccepts(target) ? target : undefined;
  // The rate limiter's remaining window rides a response header, which the
  // result object does not carry. Read on the way past rather than inferred
  // from the status, so a screen either knows the real wait or knows it does
  // not know.
  let retryAfterSeconds: number | undefined;
  const result = await client.signIn.email({
    email: options?.email ?? "",
    password: options?.password ?? "",
    callbackURL,
    fetchOptions: {
      onError: (context: { response?: { headers?: Headers } }) => {
        const header = context.response?.headers?.get("X-Retry-After");
        const seconds = header === null ? Number.NaN : Number(header);
        if (Number.isFinite(seconds) && seconds > 0) {
          retryAfterSeconds = seconds;
        }
      },
    },
  });
  if (result.error) {
    // `code` is what the screens map to wording; `error` stays the message
    // for callers that only ever read it.
    return {
      error: result.error.message ?? "CredentialsSignin",
      code: result.error.code,
      status: result.error.status,
      retryAfterSeconds,
      ok: false,
    };
  }
  if (isTwoStepChallenge(result.data)) return { ok: false, twoStepRequired: true };
  // NextAuth compat: the caller expects signIn to navigate on success.
  // BetterAuth's signIn.email returns a JSON result and does NOT auto-
  // redirect the browser — the caller has to do it.
  if (shouldRedirect) {
    navigate(target ?? "/");
  }
  return { ok: true };
}

async function signInWithSso({
  providerId,
  target,
  shouldRedirect,
}: {
  providerId: string;
  target: string | undefined;
  shouldRedirect: boolean;
}): Promise<SignInResult> {
  const result = await client.$fetch("/sign-in/sso", {
    method: "POST",
    body: { providerId, callbackURL: parkAndHandOff(target) ?? "/" },
  });
  if (result.error) {
    const refusal = ssoRefusalSchema.safeParse(result.error).data;
    return {
      error: refusal?.message ?? "OAuthSignin",
      code: refusal?.code,
      status: refusal?.status,
      ok: false,
    };
  }
  const redirectUrl = ssoRedirectSchema.safeParse(result.data).data?.url;
  if (shouldRedirect && redirectUrl) navigate(redirectUrl);
  return { ok: true };
}

export const signIn = async (
  provider: string,
  options?: {
    email?: string;
    password?: string;
    callbackUrl?: string;
    redirect?: boolean;
    /** The address already typed, handed to the provider as the OIDC login hint. */
    loginHint?: string;
  },
): Promise<SignInResult> => {
  // Same-origin guard on the post-login redirect target.
  const target = options?.callbackUrl ? safeRedirectTarget(options.callbackUrl) : undefined;
  const shouldRedirect = options?.redirect !== false;

  if (provider === "credentials" || provider === "email") {
    return signInWithPassword({ options, target, shouldRedirect });
  }

  // An organization's connection is registered with the SSO plugin, not as a social provider.
  if (looksLikeSsoConnectionId(provider)) {
    return signInWithSso({ providerId: provider, target, shouldRedirect });
  }

  // Every other provider goes through signIn.social, social (google, github, gitlab, microsoft) and
  // generic-OAuth (see `PLAIN_OIDC_PROVIDERS` and the named entries beside it in
  // `ee/sso/providers.ts`) alike: the social plugin and the generic-oauth plugin both honor the
  // same providerId. BetterAuth handles the redirect to the provider URL itself when
  // `disableRedirect` is unset.
  const bridge = AUTH0_BRIDGE_METHODS.find(({ methodId }) => methodId === provider);
  const nativeProvider = provider === "azure-ad" ? "microsoft" : provider;
  const mappedProvider = bridge === undefined ? nativeProvider : "auth0";
  const result = await client.signIn.social({
    provider: mappedProvider as "google",
    callbackURL: parkAndHandOff(target),
    disableRedirect: !shouldRedirect,
    ...(options?.loginHint ? { loginHint: options.loginHint } : {}),
    ...(bridge === undefined ? {} : { additionalParams: { connection: bridge.connection } }),
  });
  if (result.error) {
    return {
      error: result.error.message ?? "OAuthSignin",
      code: result.error.code,
      status: result.error.status,
      ok: false,
    };
  }
  // For providers where BetterAuth returned a redirect URL but didn't
  // auto-navigate (some fetch modes), follow it ourselves.
  if (shouldRedirect && result.data && typeof result.data === "object" && "url" in result.data) {
    const url = (result.data as { url?: string }).url;
    if (url) {
      navigate(url);
    }
  }
  return { ok: true };
};

/**
 * Browser navigation. Exported as its own export so tests can spy on it
 * without having to redefine `window.location` (jsdom makes that hard).
 * Production callers go through `signIn`/`signOut` which invoke this.
 */
export const navigate = (href: string): void => {
  hardNavigate(href);
};

/**
 * True if `url` resolves to the same origin as `origin` (default: `window.location.origin`).
 * Used to guard against open redirects — a protocol-relative value like `//evil.com` or a
 * cross-origin absolute URL resolves to a different origin and returns false.
 */
export const isSameOrigin = (
  url: string,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): boolean => {
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
};

/**
 * Same-origin redirect guard.
 */
export const safeRedirectTarget = (
  callbackUrl: string | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string => {
  if (!callbackUrl || !isSameOrigin(callbackUrl, origin)) return "/";
  const url = new URL(callbackUrl, origin);
  const path = url.pathname + url.search + url.hash;
  // Dot segments normalise away after the same-origin check, so `/.//evil.com`
  // is same-origin yet leaves a path that browsers read as `//evil.com`.
  if (path.startsWith("//") || path.startsWith("/\\")) return "/";
  return path;
};

/**
 * Relative callbackURLs better-auth 1.7.1 accepts (`trusted-origins.mjs`); it
 * 403s any other with "Invalid callbackURL", and app paths with `:`, `#`, `~`,
 * `,` or `%` fall outside it. Re-check on every better-auth upgrade.
 */
const BETTER_AUTH_CALLBACK_PATTERN = /^\/(?!\/|\\|%2f|%5c)[\w.+/@-]*(?:\?[\w.+/=&%@-]*)?$/;

/** Landing page that reads the parked target back and continues to it. */
const AUTH_RESUME_PATH = "/auth/resume";

const RETURN_TO_STORAGE_KEY = "langwatch.auth.returnTo";

const betterAuthAccepts = (target: string): boolean => BETTER_AUTH_CALLBACK_PATTERN.test(target);

const clearReturnTo = (): void => {
  try {
    window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was parked.
  }
};

/**
 * Parks a refused target in sessionStorage (a query parameter would carry the
 * very characters it refuses). An accepted target clears the slot, so an
 * abandoned sign-in's value never hijacks a later landing.
 */
const parkReturnTo = (target: string): void => {
  if (betterAuthAccepts(target)) {
    clearReturnTo();
    return;
  }
  try {
    window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, target);
  } catch {
    // Storage unavailable: the resume page falls back to "/".
  }
};

/**
 * Parks `target` and returns the callbackURL for better-auth: the target when
 * it is accepted, otherwise the resume page. No target clears the slot and
 * hands over nothing, leaving better-auth to its own default.
 */
const parkAndHandOff = (target: string | undefined): string | undefined => {
  if (target === undefined) {
    clearReturnTo();
    return undefined;
  }
  parkReturnTo(target);
  return betterAuthAccepts(target) ? target : AUTH_RESUME_PATH;
};

/**
 * Reads and clears the target parked by `parkReturnTo`, "/" when there is
 * none. Re-guarded because storage is writable by any script on the origin.
 */
export const consumeStoredReturnTo = (): string => {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
    window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was parked.
  }
  return safeRedirectTarget(stored ?? undefined);
};

export const signOut = async (opts?: {
  callbackUrl?: string;
  redirect?: boolean;
}): Promise<void> => {
  // Clear module-level session cache so the next useSession mount
  // doesn't serve stale data after logout.
  _cachedSession = null;
  // The reads and preferences persisted to disk were this user's; the next one never sees them.
  clearReaderUiStorage();
  clearSessionUiStorage();
  await clearPersistedUiQueries();

  if (opts?.redirect === false) {
    // Programmatic logout without redirect. The caller is responsible for
    // updating the UI (e.g., calling session.update() or navigating).
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error("Logout failed");
    return;
  }
  // Navigate directly to the logout endpoint as a full page navigation. This guarantees the
  // Set-Cookie headers are applied by the browser (no fetch/AJAX race conditions). The endpoint
  // clears cookies and redirects to /auth/signin. We always go to /auth/signin (not /) because
  // / renders client-side and in Auth0 mode the signin page auto-fires signIn("auth0") which
  // silently re-authenticates via Google SSO before the user even sees the page.
  navigate("/api/auth/logout");
};

/**
 * Link an OAuth account to the currently signed-in user. This is distinct from
 * `signIn(provider)` — which creates/switches sessions.
 */
export const linkAccount = async (
  provider: string,
  options?: { callbackUrl?: string },
): Promise<{ error?: string; ok?: boolean }> => {
  const callbackURL = safeRedirectTarget(options?.callbackUrl) || "/";
  const mapped = provider === "azure-ad" ? "microsoft" : provider;

  const res = await fetch("/api/auth/link-social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ provider: mapped, callbackURL }),
  });
  if (!res.ok) {
    return { error: await res.text(), ok: false };
  }
  const data = (await res.json()) as { url?: string; redirect?: boolean };
  if (data.url && data.redirect !== false) {
    navigate(data.url);
  }
  return { ok: true };
};

/**
 * Browser-only session fetch. Calls BetterAuth's React client which uses `document.cookie` for
 * session token retrieval.
 */
export const getSession = async (): Promise<CompatSession | null> => {
  if (typeof window === "undefined") {
    throw new Error(
      "auth-client getSession() called from server context; use getServerAuthSession from ~/server/auth instead",
    );
  }
  const result = await client.getSession();
  return adaptSession(result.data);
};

/**
 * Drop-in replacement for NextAuth's SessionProvider. BetterAuth does not
 * require a provider — `useSession` fetches directly. This is a no-op
 * component so callers can keep their JSX unchanged during the migration.
 */
export const SessionProvider = ({
  children,
}: {
  children: ReactNode;
  session?: unknown;
  /** NextAuth-compat — ignored by BetterAuth's push-based client. */
  refetchOnWindowFocus?: boolean;
}): ReactElement => {
  return <>{children}</>;
};

export type { CompatSession as Session };
