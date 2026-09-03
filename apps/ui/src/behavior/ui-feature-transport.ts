/**
 * The browser transport a feature package's hooks run on: one tRPC client
 * per application, HTTP split by `skipBatch`, subscriptions same-origin SSE.
 * Rationale and pins: dev/docs/plans/ui-subscription-transport.md.
 */

import {
  type FeatureApiClient,
  type FeatureApiMap,
  type RouterFromMap,
} from "@langwatch/platform-api-client";
import type { AppRouter } from "@langwatch/platform-api/app-trpc/types";
import type { QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  getUntypedClient,
  httpBatchLink,
  httpLink,
  splitLink,
  type TRPCClient,
} from "@trpc/client";
import type { ComponentType, ReactNode } from "react";
import superjson from "superjson";
import { type SseEventSourceConstructor, sseSubscriptionLink } from "./ui-sse-subscription-link";

/** Same-origin, so the browser sends the session cookie without configuration. */
export const UI_TRPC_ENDPOINT = "/api/trpc";

/**
 * Where the platform serves a live procedure. The procedure path is appended
 * to it, so `langy.onTurnStream` is read at `/api/sse/langy.onTurnStream`.
 */
export const UI_SSE_ENDPOINT_PREFIX = "/api/sse/";

/**
 * `EventSource` takes no relative URL and must stay same-origin for the
 * session cookie to ride along, so this resolves the document's own origin
 * rather than taking one from a caller. Outside a browser it only has to parse.
 */
function subscriptionOrigin(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

/**
 * The batch link refuses a URL longer than this and the request would fail; a
 * query with a large input is sent on its own instead. Matches the host.
 */
const MAX_BATCHED_URL_LENGTH = 4000;

/** The untyped client every feature Provider is handed. */
export type UiFeatureApiTransport = FeatureApiClient<FeatureApiMap>;

export type UiFeatureApiClientOptions = {
  /** Overridden only by a test; production is always same-origin. */
  url?: string;
  /** The fetch to send on. Defaults to the browser's. */
  fetch?: typeof globalThis.fetch;
  /** Overridden only by a test; production is always the document's origin. */
  subscriptionUrl?: string;
  /** The EventSource to open live channels with. Defaults to the browser's. */
  eventSource?: SseEventSourceConstructor;
};

/**
 * The three lanes, built once and shared by both clients below.
 *
 * Shared rather than restated so the typed client the api-map retirement moves
 * features onto cannot take a different lane from the untyped one it replaces
 * — a subscription that quietly rode the request lane renders once and then
 * looks like a screen with no news.
 */
function uiFeatureApiLinks({
  url = UI_TRPC_ENDPOINT,
  fetch,
  subscriptionUrl = subscriptionOrigin(),
  eventSource,
}: UiFeatureApiClientOptions) {
  const httpRouting = splitLink({
    condition: (operation) => operation.context.skipBatch === true,
    true: httpLink({ url, transformer: superjson, ...(fetch ? { fetch } : {}) }),
    false: httpBatchLink({
      url,
      transformer: superjson,
      maxURLLength: MAX_BATCHED_URL_LENGTH,
      ...(fetch ? { fetch } : {}),
    }),
  });

  return [
    splitLink({
      condition: (operation) => operation.type === "subscription",
      // Reconnect attempts and backoff are the link's own defaults, which
      // are the platform host's pins. Restating them here would be a second
      // place for the number to live and a second place for it to drift.
      true: sseSubscriptionLink({
        url: subscriptionUrl,
        transformer: superjson,
        transformPath: (path) => `${UI_SSE_ENDPOINT_PREFIX}${path}`,
        ...(eventSource ? { eventSource } : {}),
      }),
      false: httpRouting,
    }),
  ];
}

/** Builds the transport once per application; `op.context.skipBatch` opts a query out of batching (same flag the host reads). */
export function createUiFeatureApiClient(
  options: UiFeatureApiClientOptions = {},
): UiFeatureApiTransport {
  return getUntypedClient(
    createTRPCClient<RouterFromMap<FeatureApiMap>>({ links: uiFeatureApiLinks(options) }),
  );
}

/**
 * The same three lanes, typed by the router the API process actually mounts.
 *
 * `AppRouter` is read from the api process's `./app-trpc/types` subpath, which
 * is types only — no value crosses from the API into the browser bundle. This
 * is what retires the 38 hand-written `*ApiMap`s: a procedure's input and its
 * answer are inferred from the procedure, so a rename on the server is a
 * compile error in the screen that calls it rather than a 404 a person finds.
 */
export function createUiAppApiClient(
  options: UiFeatureApiClientOptions = {},
): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: uiFeatureApiLinks(options) });
}

/** A feature's Provider, with the types its own procedure map gave it erased. */
export type UiFeatureApiProvider = ComponentType<{
  client: unknown;
  queryClient: QueryClient;
  children: ReactNode;
}>;

/** One feature package's hooks, ready for the shell to mount. */
export type UiFeatureApiBinding = {
  /** The package this transport serves, named for composition diagnostics. */
  readonly name: string;
  readonly Provider: UiFeatureApiProvider;
};

/**
 * Erases a feature's typed client Provider to the untyped prop the shell
 * mounts every feature with. `TClient` stays unconstrained on purpose: this
 * is the one place allowed to erase either client shape.
 */
export function uiFeatureApi<TClient>({
  name,
  api,
}: {
  name: string;
  api: {
    Provider: ComponentType<{
      client: TClient;
      queryClient: QueryClient;
      children: ReactNode;
    }>;
  };
}): UiFeatureApiBinding {
  return { name, Provider: api.Provider as UiFeatureApiProvider };
}
