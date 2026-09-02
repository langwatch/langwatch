/**
 * The browser transport a feature package's hooks run on.
 *
 * A feature web package writes its procedures as a plain map and calls
 * `createFeatureApi` once; what it never does is build a client, because that
 * means choosing an endpoint, a transformer and a batching window. This module
 * makes that choice for `apps/ui`, and the application shell hands the one
 * client to every feature Provider it mounts.
 *
 * ONE CACHE, TWO LANES. `@trpc/react-query` derives its React Query key from
 * the procedure path alone, so a query registered through a feature's hooks
 * and the same query registered by the host application are the same cache
 * entry — given the same QueryClient. The shell takes the host's QueryClient
 * when it is mounted inside one, which is what keeps invalidation working in
 * both directions while pages are still split across the two packages.
 *
 * The HTTP lane is NOT shared. The host builds its own client, so a query
 * fired here and a query fired by a host hook in the same tick travel in two
 * requests rather than one batch. That is the cost of `apps/ui` owning its own
 * transport instead of being handed the host's, and it is the right trade for
 * this slice: the alternative is a twelfth provider slot that every host must
 * fill before a single screen can move. Batching is a latency optimisation and
 * cache identity is a correctness property, so the split lane is affordable
 * and a split cache would not be.
 *
 * SUBSCRIPTIONS RIDE A THIRD LANE, and they are not a WebSocket. The platform
 * serves every live procedure over Server-Sent Events at `/api/sse/{path}`,
 * and its own transport routes `op.type === "subscription"` there before any
 * other split is consulted — the WebSocket it also runs is opt-in per call for
 * high-frequency queries and carries no subscriptions at all. This transport
 * makes the same split in the same order, so an operation keeps its lane when
 * a hook moves. See dev/docs/plans/ui-subscription-transport.md.
 *
 * The session on that channel is the browser's, carried by nothing more than
 * the origin: an `EventSource` sends the better-auth cookie because the URL is
 * same-origin, which is the one and only reason the server can read a session
 * off it. That is why the base below is the document's own origin rather than
 * anything configurable — a subscription pointed elsewhere is a subscription
 * pointed at an anonymous channel.
 */

import {
  type FeatureApiClient,
  type FeatureApiMap,
  type RouterFromMap,
  type SseEventSourceConstructor,
  sseSubscriptionLink,
} from "@langwatch/platform-api-client";
import type { QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  getUntypedClient,
  httpBatchLink,
  httpLink,
  splitLink,
} from "@trpc/client";
import type { ComponentType, ReactNode } from "react";
import superjson from "superjson";

/** Same-origin, so the browser sends the session cookie without configuration. */
export const UI_TRPC_ENDPOINT = "/api/trpc";

/**
 * Where the platform serves a live procedure. The procedure path is appended
 * to it, so `langy.onTurnStream` is read at `/api/sse/langy.onTurnStream`.
 */
export const UI_SSE_ENDPOINT_PREFIX = "/api/sse/";

/**
 * The origin a subscription opens against.
 *
 * `EventSource` takes no relative URL, so this cannot be written the way
 * `UI_TRPC_ENDPOINT` is — and the origin is the whole auth story, so it
 * resolves to the document's own rather than to anything a caller supplies.
 * Outside a browser there is no session to carry and no `EventSource` to open
 * with, so the placeholder only ever has to parse.
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
 * The transport, built once per application.
 *
 * `op.context.skipBatch` sends one request for one call, for a query mounted
 * on the application shell that would otherwise be stuck behind a page's slow
 * fan-out. The host reads the same flag, so a hook keeps its meaning when it
 * moves.
 */
export function createUiFeatureApiClient({
  url = UI_TRPC_ENDPOINT,
  fetch,
  subscriptionUrl = subscriptionOrigin(),
  eventSource,
}: UiFeatureApiClientOptions = {}): UiFeatureApiTransport {
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

  const client = createTRPCClient<RouterFromMap<FeatureApiMap>>({
    links: [
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
    ],
  });

  return getUntypedClient(client);
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
 * Declares that a feature's hooks run on this application's transport.
 *
 * At runtime there is one kind of client: it dispatches on a path string and
 * knows nothing about router types. Each feature's Provider is typed by its
 * own procedure map, so mounting a list of them in one loop needs the props
 * erased — and this is the one place that erases them, rather than a cast at
 * every mount site.
 */
export function uiFeatureApi<TMap extends FeatureApiMap>({
  name,
  api,
}: {
  name: string;
  api: {
    Provider: ComponentType<{
      client: FeatureApiClient<TMap>;
      queryClient: QueryClient;
      children: ReactNode;
    }>;
  };
}): UiFeatureApiBinding {
  return { name, Provider: api.Provider as UiFeatureApiProvider };
}
