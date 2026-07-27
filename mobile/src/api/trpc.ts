import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";

import { sessionStore } from "@/auth/sessionStore";

// The router type comes straight from the app. Every `trpc.ops.*` call below is
// typed off the real procedure — its input, its output and its errors — so a
// server-side change that would break a screen breaks `pnpm typecheck` instead.
// Type-only, so none of the server ever reaches the bundle.
import type { MobileRouter } from "~/server/api/mobile-root";

export const trpc = createTRPCReact<MobileRouter>();

export const MOBILE_TRPC_PATH = "/api/mobile/trpc";

/**
 * Attach the bearer token, refreshing first when it has expired, and on a 401
 * force one refresh and retry.
 *
 * Once, not in a loop: a second 401 after a fresh token means the credential is
 * genuinely rejected, and retrying would just spin. `onUnauthorized` is how the
 * app hears about that and returns to the sign-in screen.
 */
export function createAuthedFetch(onUnauthorized: () => void): typeof fetch {
  return async (input, init) => {
    const session = await sessionStore.valid();
    if (!session) {
      onUnauthorized();
      throw new Error("Signed out");
    }

    const send = (token: string) =>
      fetch(input, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          authorization: `Bearer ${token}`,
        },
      });

    const response = await send(session.accessToken);
    if (response.status !== 401) return response;

    const refreshed = await sessionStore.valid({ force: true });
    if (!refreshed) {
      onUnauthorized();
      return response;
    }

    const retried = await send(refreshed.accessToken);
    if (retried.status === 401) onUnauthorized();
    return retried;
  };
}

export function createTrpcClient({
  instance,
  onUnauthorized,
}: {
  instance: string;
  onUnauthorized: () => void;
}) {
  return trpc.createClient({
    // superjson, matching `transformer: superjson` on the server. Without it the
    // client would hand screens the raw envelope instead of the data.
    transformer: superjson,
    links: [
      httpBatchLink({
        url: `${instance}${MOBILE_TRPC_PATH}`,
        fetch: createAuthedFetch(onUnauthorized),
      }),
    ],
  });
}

/**
 * What a screen should say when a query fails, and whether offering a retry
 * could possibly help. A retry button that cannot help is worse than none.
 */
export function describeError(error: unknown): {
  title: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: string } | null)?.code;
    switch (code) {
      case "UNAUTHORIZED":
        return {
          title: "Signed out",
          message: "Your session has ended. Sign in again.",
          retryable: false,
        };
      case "FORBIDDEN":
        return {
          title: "No ops access",
          message: "This account is not a platform operator on this instance.",
          retryable: false,
        };
      case "PRECONDITION_FAILED":
        return {
          title: "Ops is not running here",
          message:
            "This instance is running without the ops module, so there is nothing to show.",
          retryable: false,
        };
      case "NOT_FOUND":
        return {
          title: "Not found",
          message: "That is no longer there.",
          retryable: false,
        };
      default:
        return {
          title: "Could not load",
          message: error.message,
          retryable: true,
        };
    }
  }

  return {
    title: "Could not load",
    message:
      error instanceof Error
        ? `Could not reach the instance. ${error.message}`
        : "Could not reach the instance.",
    retryable: true,
  };
}
