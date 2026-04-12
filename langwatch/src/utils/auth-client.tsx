"use client";

import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createAuthClient } from "better-auth/react";

/**
 * Client-side auth wrapper exposing a NextAuth-compatible API surface over
 * BetterAuth. Consumers import `useSession`, `signIn`, `signOut`, `getSession`
 * from this module instead of `next-auth/react` during the migration.
 *
 * The adapter normalizes BetterAuth's `{ session, user }` response shape into
 * the flat Session type that the rest of the app expects.
 */
const client = createAuthClient();

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
 * reads the `Session.impersonating` JSON column and rewrites `session.user`
 * to the impersonated identity. This mirrors how NextAuth's `useSession`
 * worked — both server and client saw the same impersonation-aware session.
 */
export const useSession = (
  options?: UseSessionOptions,
): {
  data: CompatSession | null;
  status: SessionStatus;
  update: () => Promise<void>;
} => {
  const [data, setData] = useState<CompatSession | null>(null);
  const [isPending, setIsPending] = useState(true);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { credentials: "include" });
      const json = await res.json();
      setData(adaptSession(json));
    } catch {
      setData(null);
    } finally {
      setIsPending(false);
    }
  }, []);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

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

  return {
    data,
    status,
    update: fetchSession,
  };
};

export const signIn = async (
  provider: string,
  options?: {
    email?: string;
    password?: string;
    callbackUrl?: string;
    redirect?: boolean;
  },
): Promise<{ error?: string; status?: number; ok?: boolean } | undefined> => {
  // Same-origin guard on the post-login redirect target.
  const callbackURL = options?.callbackUrl
    ? safeRedirectTarget(options.callbackUrl)
    : undefined;
  const shouldRedirect = options?.redirect !== false;

  if (provider === "credentials" || provider === "email") {
    const result = await client.signIn.email({
      email: options?.email ?? "",
      password: options?.password ?? "",
      callbackURL,
    });
    if (result.error) {
      return {
        error: result.error.message ?? "CredentialsSignin",
        status: result.error.status,
        ok: false,
      };
    }
    // NextAuth compat: the caller expects signIn to navigate on success.
    // BetterAuth's signIn.email returns a JSON result and does NOT auto-
    // redirect the browser — the caller has to do it.
    if (shouldRedirect) {
      navigate(callbackURL ?? "/");
    }
    return { ok: true };
  }

  // Social providers (google, github, gitlab, microsoft, etc.) and generic
  // OAuth (auth0, okta) flow through signIn.social — the social plugin and
  // the generic-oauth plugin both honor the same providerId. BetterAuth
  // handles the redirect to the provider URL itself when `disableRedirect`
  // is unset.
  //
  // Normalize `azure-ad` → `microsoft` (BetterAuth's internal provider id)
  // to match `linkAccount()` which does the same mapping. Also honor
  // `redirect: false` by passing `disableRedirect: true` so the caller can
  // handle navigation itself. Caught by CodeRabbit in PR review.
  const mappedProvider = provider === "azure-ad" ? "microsoft" : provider;
  const result = await client.signIn.social({
    provider: mappedProvider as "google",
    callbackURL,
    disableRedirect: !shouldRedirect,
  });
  if (result.error) {
    return {
      error: result.error.message ?? "OAuthSignin",
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
  if (typeof window !== "undefined") {
    window.location.href = href;
  }
};

/**
 * Same-origin redirect guard. Blocks open-redirect attempts like
 * `?callbackUrl=https://evil.com` by rejecting anything that isn't a
 * same-origin path. Relative paths (`/foo`) are always allowed.
 *
 * Exported for unit testing. `origin` defaults to `window.location.origin`
 * in the browser runtime and is passed explicitly by tests.
 */
export const safeRedirectTarget = (
  callbackUrl: string | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string => {
  if (!callbackUrl) return "/";
  if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) {
    return callbackUrl;
  }
  try {
    const url = new URL(callbackUrl, origin);
    if (url.origin === origin) {
      return url.pathname + url.search + url.hash;
    }
  } catch {
    // fall through to "/"
  }
  return "/";
};

export const signOut = async (opts?: {
  callbackUrl?: string;
  redirect?: boolean;
}): Promise<void> => {
  if (opts?.redirect === false) {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    return;
  }
  // Navigate directly to the logout endpoint as a full page navigation.
  // This guarantees the Set-Cookie headers are applied by the browser
  // (no fetch/AJAX race conditions). The endpoint clears cookies and
  // redirects to callbackUrl. This mirrors how NextAuth's signOut worked.
  const callbackUrl = safeRedirectTarget(opts?.callbackUrl);
  navigate(`/api/auth/logout?callbackUrl=${encodeURIComponent(callbackUrl)}`);
};

const SOCIAL_PROVIDERS = new Set([
  "google",
  "github",
  "gitlab",
  "microsoft",
  "azure-ad",
]);

/**
 * Link an OAuth account to the currently signed-in user. This is distinct
 * from `signIn(provider)` — which creates/switches sessions. Linking routes
 * through BetterAuth's `/link-social` (for social providers) or
 * `/oauth2/link` (for generic-oauth providers like auth0/okta), both of
 * which enforce same-email matching via
 * `accountLinking.allowDifferentEmails !== true`, blocking the
 * "sign in while logged in and silently switch sessions" regression that a
 * naive `signIn(provider)` call exhibited.
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

  if (SOCIAL_PROVIDERS.has(provider)) {
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
  }

  // Generic-oauth providers (auth0, okta) — plugin endpoint.
  const res = await fetch("/api/auth/oauth2/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ providerId: provider, callbackURL }),
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
