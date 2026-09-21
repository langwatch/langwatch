"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { looksLikeSsoConnectionId } from "@langwatch/identity";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { promotePendingMethod } from "~/features/auth/logic/lastUsedMethod";
import { readHandledError } from "~/features/errors/logic/readHandledError";
import { auth0BridgeConnectionOf } from "~/utils/auth0-bridge";

/**
 * Client-side auth wrapper exposing a NextAuth-compatible API surface over
 * BetterAuth. Consumers import `useSession`, `signIn`, `signOut`, `getSession`
 * from this module instead of `next-auth/react` during the migration.
 *
 * The adapter normalizes BetterAuth's `{ session, user }` response shape into
 * the flat Session type that the rest of the app expects.
 */
/**
 * The passkey plugin is declared unconditionally, and the METHOD SET decides
 * whether anyone is offered one: the server registers its half only when
 * the passkey plugin is mounted, and the sign-in router never names a passkey
 * unless the same env says so. Gating the client half too would mean a second
 * place for the two to disagree, and the failure would be a button that
 * exists calling an endpoint that does not.
 *
 * The two-factor half is declared the same way and for the same reason: the
 * server registers it only when `MFA_ENROLLMENT_OPEN` is on, and every screen
 * that offers a setup reads the derived `MFA_ENROLLMENT_OPEN` off the public
 * env first. One place decides, so a button that exists calling an endpoint
 * that does not cannot happen here either.
 *
 * The single sign-on half is unconditional because its server half is: the
 * plugin answers for providers in a table, and with no rows it answers "no
 * such provider". What it buys is `signIn.sso({ providerId })`, which is how
 * an administrator proves the connection they just registered carries a real
 * sign-in — naming the connection outright rather than waiting for the
 * per-organization routing flag that decides where everybody ELSE is sent.
 */
const client = createAuthClient({
  plugins: [passkeyClient(), twoFactorClient(), ssoClient()],
});

export const authClient = client;

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
    session?: { expiresAt?: string | Date };
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
    expires:
      expiresAt instanceof Date
        ? expiresAt.toISOString()
        : typeof expiresAt === "string"
          ? expiresAt
          : new Date().toISOString(),
  };
};

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface UseSessionOptions {
  required?: boolean;
  onUnauthenticated?: () => void;
}

/**
 * Fetches the impersonation-aware session from our custom endpoint.
 *
 * BetterAuth's built-in `client.useSession()` calls `/api/auth/get-session`
 * which returns the raw admin session — no impersonation rewrite. Our
 * `/api/auth/session` endpoint runs through `getServerAuthSession` which
 * reads the session's `{actor, subject}` claims and rewrites `session.user`
 * to the subject's identity (D06). This mirrors how NextAuth's `useSession`
 * worked — both server and client saw the same impersonation-aware session.
 */
// Module-level session cache — survives component unmount/remount so
// navigating between pages doesn't flash <LoadingScreen /> while the
// session is re-fetched. The first successful fetch populates this;
// subsequent mounts of useSession() start with the cached value.
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
      // A session is the only proof a federated hand-off actually worked, and
      // this is the one place every landing passes through.
      //
      // It cannot live on the sign-in screen. A federated dial hands better-auth
      // `callbackURL ?? "/"`, so the provider's callback returns the browser to
      // the app root — that screen is never mounted again, its effect never
      // runs, and the parked method never became the badge. Password and
      // passkey were unaffected because they record themselves directly, which
      // is why this only ever looked broken for the social providers.
      //
      // A no-op when nothing is parked, so it costs a landing nothing.
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

  const status: SessionStatus = isPending
    ? "loading"
    : data
      ? "authenticated"
      : "unauthenticated";

  useEffect(() => {
    if (
      options?.required &&
      status === "unauthenticated" &&
      options.onUnauthenticated
    ) {
      options.onUnauthenticated();
    }
  }, [options?.required, options?.onUnauthenticated, status]);

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

/**
 * Whether a sign-in answered with a two-factor challenge instead of a session.
 *
 * Read off the body rather than inferred from an absent cookie: the flag is
 * the two-factor plugin's own contract for this state, and a cookie the
 * browser will not show us cannot tell a challenge apart from a sign-in that
 * quietly failed to set one.
 */
function isTwoStepChallenge(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
  );
}

type SignInOptions = {
  email?: string;
  password?: string;
  callbackUrl?: string;
  redirect?: boolean;
  loginHint?: string;
};

type SignInResult = {
  error?: string;
  code?: string;
  status?: number;
  ok?: boolean;
  /** The remaining rate-limit window, when supplied by the server. */
  retryAfterSeconds?: number;
  /** A correct password still needs a second factor; no session exists yet. */
  twoStepRequired?: boolean;
};

export const signIn = async (
  provider: string,
  options?: SignInOptions,
): Promise<SignInResult | undefined> => {
  // Same-origin guard on the post-login redirect target.
  const callbackURL = options?.callbackUrl
    ? safeRedirectTarget(options.callbackUrl)
    : undefined;
  const shouldRedirect = options?.redirect !== false;

  if (provider === "credentials" || provider === "email") {
    return signInWithCredentials(options, callbackURL, shouldRedirect);
  }

  // Organization connections are registered with the SSO plugin.
  if (looksLikeSsoConnectionId(provider)) {
    const result = await client.signIn.sso({
      providerId: provider,
      callbackURL: callbackURL ?? "/",
    });
    if (result.error) {
      return {
        error: result.error.message ?? "OAuthSignin",
        code: result.error.code,
        status: result.error.status,
        ok: false,
      };
    }
    if (
      shouldRedirect &&
      result.data &&
      typeof result.data === "object" &&
      "url" in result.data
    ) {
      const url = (result.data as { url?: string }).url;
      if (url) {
        navigate(url);
      }
    }
    return { ok: true };
  }

  // Auth0 bridge buttons choose a connection; Azure uses BetterAuth's provider id.
  const bridgeConnection = auth0BridgeConnectionOf(provider);
  const mappedProvider =
    bridgeConnection !== null
      ? "auth0"
      : provider === "azure-ad"
        ? "microsoft"
        : provider;
  const result = await client.signIn.social({
    provider: mappedProvider as "google",
    callbackURL,
    disableRedirect: !shouldRedirect,
    ...(options?.loginHint ? { loginHint: options.loginHint } : {}),
    ...(bridgeConnection !== null
      ? { additionalParams: { connection: bridgeConnection } }
      : {}),
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
  if (
    shouldRedirect &&
    result.data &&
    typeof result.data === "object" &&
    "url" in result.data
  ) {
    const url = (result.data as { url?: string }).url;
    if (url) {
      navigate(url);
    }
  }
  return { ok: true };
};

async function signInWithCredentials(
  options: SignInOptions | undefined,
  callbackURL: string | undefined,
  shouldRedirect: boolean,
): Promise<SignInResult> {
  // Retry timing is carried by the response header, not the auth result.
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
    // Application refusals carry their code in the handled-error payload.
    const handled = readHandledError(result.error);
    return {
      error: result.error.message ?? "CredentialsSignin",
      code: handled?.code ?? result.error.code,
      status: result.error.status,
      retryAfterSeconds,
      ok: false,
    };
  }
  if (isTwoStepChallenge(result.data)) {
    return { ok: false, twoStepRequired: true };
  }
  if (shouldRedirect) {
    navigate(callbackURL ?? "/");
  }
  return { ok: true };
}

/**
 * Browser navigation. Exported as its own export so tests can spy on it
 * without having to redefine `window.location` (jsdom makes that hard).
 * Production callers go through `signIn`/`signOut` which invoke this.
 */
export const navigate = (href: string): void => {
  if (typeof window !== "undefined") {
    window.location.href = href;
  }
};

/**
 * True if `url` resolves to the same origin as `origin` (default:
 * `window.location.origin`). Used to guard against open redirects — a
 * protocol-relative value like `//evil.com` or a cross-origin absolute URL
 * resolves to a different origin and returns false. Invalid URLs (e.g.
 * `javascript:...`) also return false rather than throwing.
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
 * Same-origin redirect guard. Blocks open-redirect attempts like
 * `?callbackUrl=https://evil.com`, `?callbackUrl=//evil.com`, or the
 * backslash variant `?callbackUrl=/\evil.com` (the WHATWG URL parser treats
 * a leading `/\`, `\/`, or `\\` as authority-introducing for special
 * schemes, same as `//`) by rejecting anything that isn't a same-origin
 * destination. Always resolves through `new URL()` rather than a string
 * prefix check, so there is exactly one place that decides what counts as
 * "same origin" — no fast path that a parser quirk can slip past.
 *
 * Exported for unit testing. `origin` defaults to `window.location.origin`
 * in the browser runtime and is passed explicitly by tests.
 */
export const safeRedirectTarget = (
  callbackUrl: string | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string => {
  if (!callbackUrl || !isSameOrigin(callbackUrl, origin)) return "/";
  const url = new URL(callbackUrl, origin);
  return url.pathname + url.search + url.hash;
};

export const signOut = async (opts?: {
  callbackUrl?: string;
  redirect?: boolean;
}): Promise<void> => {
  // Clear module-level session cache so the next useSession mount
  // doesn't serve stale data after logout.
  _cachedSession = null;

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
  // Full navigation applies the cleared cookies before reaching the signed-out page.
  navigate("/api/auth/logout");
};

/**
 * Link an OAuth account to the currently signed-in user. This is distinct
 * from `signIn(provider)` — which creates/switches sessions. Linking routes
 * through BetterAuth's `/link-social`, which enforces same-email matching via
 * `accountLinking.allowDifferentEmails !== true`, blocking the "sign in while
 * logged in and silently switch sessions" regression that a naive
 * `signIn(provider)` call exhibited.
 *
 * ONE endpoint, since better-auth 1.7. Generic-oauth providers used to link
 * through the plugin's own `/oauth2/link` and everything else through
 * `/link-social`; the plugin no longer mounts endpoints at all, because it
 * registers each configured provider as a first-class social provider. So the
 * fork is gone and an Okta account links exactly the way a GitHub one does.
 *
 * The caller passes the same provider id used in `NEXTAUTH_PROVIDER` and we
 * map `azure-ad` → `microsoft` internally so the UI doesn't need to know the
 * BetterAuth internal naming.
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
 * Browser-only session fetch. Calls BetterAuth's React client which uses
 * `document.cookie` for session token retrieval. **Do not call this from
 * server-side code (getServerSideProps, API routes, etc.) — it has no
 * access to the request context and will always return null on the
 * server.** Server-side callers must use `getServerAuthSession` from
 * `~/server/auth` instead, which reads cookies from request headers via
 * `auth.api.getSession`.
 */
export const getSession = async (): Promise<CompatSession | null> => {
  if (typeof window === "undefined") {
    throw new Error(
      "auth-client getSession() called from server context — use getServerAuthSession from ~/server/auth instead",
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
  refetchInterval?: number;
  /** NextAuth-compat — ignored by BetterAuth's push-based client. */
  refetchOnWindowFocus?: boolean;
}): ReactElement => {
  return <>{children}</>;
};

export type { CompatSession as Session };
