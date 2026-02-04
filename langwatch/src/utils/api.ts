/**
 * This is the client-side entrypoint for your tRPC API. It is used to create the `api` object which
 * contains the Next.js App-wrapper, as well as your type-safe React Query hooks.
 *
 * We also create a few inference helpers for input and output types.
 */
import {
  httpBatchLink,
  httpLink,
  loggerLink,
  splitLink,
  TRPCClientError,
} from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import { MutationCache } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import superjson from "superjson";
import type { AppRouter } from "~/server/api/root";
import { sseLink } from "./sseLink";
import {
  extractLimitExceededInfo,
  markAsHandledByLicenseHandler,
} from "./trpcError";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";

const getBaseUrl = () => {
  if (typeof window !== "undefined") return window.location.origin; // browser should use origin for full URLs
  if (process.env.BASE_HOST) return `https://${process.env.BASE_HOST}`; // SSR should use base host
  return `http://localhost:${process.env.PORT ?? 5560}`; // dev SSR should use localhost
};

const MAX_RETRIES = 4;
const HTTP_STATUS_TO_NOT_RETRY = [400, 401, 403, 404, 431];

/** A set of type-safe react-query hooks for your tRPC API. */
export const api = createTRPCNext<AppRouter>({
  config() {
    return {
      /**
       * Transformer used for data de-serialization from the server.
       *
       * @see https://trpc.io/docs/data-transformers
       */
      transformer: superjson,

      /**
       * Links used to determine request flow from client to server.
       *
       * @see https://trpc.io/docs/links
       */
      links: [
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === "development" ||
            (opts.direction === "down" && opts.result instanceof Error),
        }),
        // Split subscriptions to SSE link, everything else to HTTP
        splitLink({
          condition(op) {
            return op.type === "subscription";
          },
          true: sseLink({
            url: getBaseUrl(),
            transformPath: (path) => `/api/sse/${path}`,
            maxReconnectAttempts: 5,
            reconnectDelay: 1000,
          }),
          false: splitLink({
            condition(op) {
              // check for context property `skipBatch`
              return op.context.skipBatch === true;
            },
            // when condition is true, use normal request
            true: httpLink({
              url: `${getBaseUrl()}/api/trpc`,
            }),
            // when condition is false, use batching
            false: httpBatchLink({
              url: `${getBaseUrl()}/api/trpc`,
              // Split batches if URL would exceed this length to avoid 431 errors
              maxURLLength: 4000,
            }),
          }),
        }),
      ],

      queryClientConfig: {
        /**
         * Global mutation error handler for license limit enforcement.
         *
         * This handler intercepts all tRPC mutation errors and:
         * 1. Checks if the error is a LIMIT_EXCEEDED FORBIDDEN error
         * 2. If so, opens the upgrade modal with limit details
         * 3. Marks the error via WeakSet so component-level handlers can skip it
         *
         * Components using `onError` callbacks should check `isHandledByGlobalLicenseHandler(error)`
         * to avoid showing duplicate error UI (toast + modal) for license errors.
         *
         * @see isHandledByGlobalLicenseHandler in trpcError.ts
         * @see extractLimitExceededInfo in trpcError.ts
         */
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, _mutation) => {
            const limitInfo = extractLimitExceededInfo(error);
            if (limitInfo) {
              // Mark as handled so component-level handlers can skip it
              if (error instanceof Error) {
                markAsHandledByLicenseHandler(error);
              }

              useUpgradeModalStore
                .getState()
                .open(limitInfo.limitType, limitInfo.current, limitInfo.max);
            }
            // Non-license errors bubble up to component-level handlers
          },
        }),
        defaultOptions: {
          mutations: {
            networkMode: "always",
          },
          queries: {
            networkMode:
              process.env.NODE_ENV !== "production" ? "always" : "online",
            retry(failureCount, error) {
              if (failureCount >= MAX_RETRIES) {
                return false;
              }

              if (
                error instanceof TRPCClientError &&
                HTTP_STATUS_TO_NOT_RETRY.includes(error.data?.httpStatus ?? 0)
              ) {
                return false;
              }

              return true;
            },
          },
        },
      },
    };
  },
  /**
   * Whether tRPC should await queries when server rendering pages.
   *
   * @see https://trpc.io/docs/nextjs#ssr-boolean-default-false
   */
  ssr: false,
});

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
