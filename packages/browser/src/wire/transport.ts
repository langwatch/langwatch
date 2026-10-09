/**
 * One tRPC client per application: one request per call over `httpLink`
 * (no batching), subscriptions over same-origin SSE. See ADR-128,
 * subscription-wire appendix.
 */

import type { ModuleApiClient, ModuleApiMap, RouterFromMap } from "@langwatch/api/web";
import type { CacheDeclaringContract } from "@langwatch/browser-host/cache-tiers";
import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, getUntypedClient, httpLink, loggerLink, splitLink } from "@trpc/client";
import type { ComponentType, ReactNode } from "react";

import { type SseEventSourceConstructor, sseSubscriptionLink } from "./sse-subscription-link";
import { logTrpcOperation } from "./trpc-request-log";

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

/** The untyped client every feature Provider is handed. */
export type UiFeatureApiTransport = ModuleApiClient<ModuleApiMap>;

export type UiFeatureApiClientOptions = {
  /** Overridden only by a test; production is always same-origin. */
  url?: string;
  /** The fetch to send on. Defaults to the browser's. */
  fetch?: typeof globalThis.fetch;
  /** Overridden only by a test; production is always the document's origin. */
  subscriptionUrl?: string;
  /** The EventSource to open live channels with. Defaults to the browser's. */
  eventSource?: SseEventSourceConstructor;
  /** The deployment's `isDevelopment`: logs operation and timing, never what a request carried. */
  isDevelopment?: boolean;
};

/**
 * The three lanes the browser's one client is built from.
 */
function uiFeatureApiLinks({
  url = UI_TRPC_ENDPOINT,
  fetch,
  subscriptionUrl = subscriptionOrigin(),
  eventSource,
  isDevelopment = false,
}: UiFeatureApiClientOptions) {
  // One request per call: the server does not batch (Alex, 2026-10-01).
  const plainRouting = httpLink({ url, ...(fetch ? { fetch } : {}) });
  // A write sent moments before the document goes away ("Not now" on a
  // dialog, then a navigation) opts in with `context: { keepalive: true }`:
  // the browser would otherwise cancel it and the answer is lost. Bodies are
  // capped at 64 KB across keepalive requests, so this is for answers only.
  const keepaliveRouting = httpLink({
    url,
    fetch: (input, init) => (fetch ?? globalThis.fetch)(input, { ...init, keepalive: true }),
  });
  const httpRouting = splitLink({
    condition: (operation) => operation.context.keepalive === true,
    true: keepaliveRouting,
    false: plainRouting,
  });

  return [
    loggerLink({ enabled: () => isDevelopment, logger: logTrpcOperation }),
    splitLink({
      condition: (operation) => operation.type === "subscription",
      // Reconnect attempts and backoff are the link's own defaults, which
      // are the platform host's pins. Restating them here would be a second
      // place for the number to live and a second place for it to drift.
      true: sseSubscriptionLink({
        url: subscriptionUrl,
        transformer: JSON,
        transformPath: (path) => `${UI_SSE_ENDPOINT_PREFIX}${path}`,
        ...(eventSource ? { eventSource } : {}),
      }),
      false: httpRouting,
    }),
  ];
}

/** Builds the transport once per app;  */
export function createUiFeatureApiClient(
  options: UiFeatureApiClientOptions = {},
): UiFeatureApiTransport {
  return getUntypedClient(
    createTRPCClient<RouterFromMap<ModuleApiMap>>({ links: uiFeatureApiLinks(options) }),
  );
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
  /** The contracts whose declared cache policies this package's reads follow. */
  readonly contracts?: readonly CacheDeclaringContract[];
};
