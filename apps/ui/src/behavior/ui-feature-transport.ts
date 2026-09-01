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
 * Subscriptions are deliberately absent. The host routes them over a WebSocket
 * and an SSE fallback it configures from its own environment; a feature that
 * needs one is the signal to move that configuration, not to guess at it here.
 */

import type {
  FeatureApiClient,
  FeatureApiMap,
  RouterFromMap,
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
}: UiFeatureApiClientOptions = {}): UiFeatureApiTransport {
  const client = createTRPCClient<RouterFromMap<FeatureApiMap>>({
    links: [
      splitLink({
        condition: (operation) => operation.context.skipBatch === true,
        true: httpLink({ url, transformer: superjson, ...(fetch ? { fetch } : {}) }),
        false: httpBatchLink({
          url,
          transformer: superjson,
          maxURLLength: MAX_BATCHED_URL_LENGTH,
          ...(fetch ? { fetch } : {}),
        }),
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
