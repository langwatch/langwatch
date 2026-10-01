/**
 * One tRPC client per application: HTTP split by `skipBatch`, subscriptions
 * same-origin SSE, batches streamed (JSON lines) so each answer lands as it
 * resolves. See ADR-128, subscription-wire appendix.
 */

import {
  type ModuleApiClient,
  type ModuleApiMap,
  type RouterFromMap,
  trpcQueryKey,
} from "@langwatch/api/web";
import type {
  CacheDeclaringContract,
  UiQueryVersions,
  UiVersionedReads,
} from "@langwatch/browser-host/cache-tiers";
import { hashKey, type QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  getUntypedClient,
  httpBatchStreamLink,
  httpLink,
  loggerLink,
  splitLink,
  type TRPCLink,
} from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
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

/**
 * The batch link refuses a URL longer than this and the request would fail; a
 * query with a large input is sent on its own instead. Matches the host.
 */
const MAX_BATCHED_URL_LENGTH = 4000;

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
  /** Reads sent alone, so one URL is one read and its ETag means one thing (ADR-164). */
  unbatchedPaths?: ReadonlySet<string>;
  /** Reads declared `versioned`: sent with `since`, answered `unchanged` or with a new version. */
  versionedReads?: UiVersionedReads;
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
  unbatchedPaths,
  versionedReads,
  isDevelopment = false,
}: UiFeatureApiClientOptions) {
  const batchRouting = splitLink({
    condition: (operation) =>
      operation.context.skipBatch === true || unbatchedPaths?.has(operation.path) === true,
    true: httpLink({ url, ...(fetch ? { fetch } : {}) }),
    false: httpBatchStreamLink({
      url,
      maxURLLength: MAX_BATCHED_URL_LENGTH,
      ...(fetch ? { fetch } : {}),
    }),
  });
  // A write sent moments before the document goes away ("Not now" on a
  // dialog, then a navigation) opts in with `context: { keepalive: true }`:
  // the browser would otherwise cancel it and the answer is lost. Unbatched,
  // so one answer is never held behind an unrelated call; bodies are capped
  // at 64 KB across keepalive requests, so this is for answers, not payloads.
  const keepaliveRouting = httpLink({
    url,
    fetch: (input, init) => (fetch ?? globalThis.fetch)(input, { ...init, keepalive: true }),
  });
  const httpRouting = splitLink({
    condition: (operation) => operation.context.keepalive === true,
    true: keepaliveRouting,
    false: batchRouting,
  });

  return [
    loggerLink({ enabled: () => isDevelopment, logger: logTrpcOperation }),
    ...(versionedReads ? [versionedReadLink<AnyRouter>(versionedReads)] : []),
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

const isUnchangedAnswer = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "unchanged" in value && value.unchanged === true;

function versionedAnswerOf(value: unknown): { version: string; data: unknown } | undefined {
  if (typeof value !== "object" || value === null) return;
  if (!("version" in value) || typeof value.version !== "string" || !("data" in value)) return;
  return { version: value.version, data: value.data };
}

/** The input with the version the caller holds joined to it; unchanged when it holds none. */
function inputWithSince({ input, since }: { input: unknown; since: string | undefined }): unknown {
  if (since === undefined) return input;
  return { ...(typeof input === "object" && input !== null ? input : {}), since };
}

/** The data a versioned answer stands for, or undefined when the answer is not one. */
function dataOfVersionedAnswer({
  answer,
  versions,
  hash,
  cached,
}: {
  answer: unknown;
  versions: UiQueryVersions;
  hash: string;
  cached: () => unknown;
}): { data: unknown } | undefined {
  if (isUnchangedAnswer(answer)) return { data: cached() };
  const versioned = versionedAnswerOf(answer);
  if (!versioned) return;
  versions.set(hash, versioned.version);
  return { data: versioned.data };
}

/**
 * A versioned read is sent with the version its cached data holds and, answered
 * `unchanged`, resolves to that cached data. A new version is remembered, and the
 * caller sees the bare data either way. specs/ui/browser-query-caching.feature.
 */
function versionedReadLink<TRouter extends AnyRouter>({
  paths,
  versions,
  queryClient,
}: UiVersionedReads): TRPCLink<TRouter> {
  return () =>
    ({ op, next }) => {
      if (op.type !== "query" || !paths.has(op.path)) return next(op);
      const key = trpcQueryKey(op.path, { input: op.input, type: "query" });
      const hash = hashKey(key);
      const held = queryClient()?.getQueryData(key);
      const since = held === undefined ? undefined : versions.get(hash);
      const input = inputWithSince({ input: op.input, since });
      const cached = () => queryClient()?.getQueryData(key) ?? held;

      return observable((observer) =>
        next({ ...op, input }).subscribe({
          next: (envelope) =>
            observer.next(resolveVersionedEnvelope({ envelope, versions, hash, cached })),
          error: (error) => observer.error(error),
          complete: () => observer.complete(),
        }),
      );
    };
}

function resolveVersionedEnvelope<TEnvelope extends { result: object }>({
  envelope,
  versions,
  hash,
  cached,
}: {
  envelope: TEnvelope;
  versions: UiQueryVersions;
  hash: string;
  cached: () => unknown;
}): TEnvelope {
  const { result } = envelope;
  const answer = "data" in result ? result.data : undefined;
  const resolved = dataOfVersionedAnswer({ answer, versions, hash, cached });
  return resolved ? { ...envelope, result: { data: resolved.data } } : envelope;
}

/** Builds the transport once per app; `op.context.skipBatch` opts a query out of batching. */
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
  /** The contracts whose declared cache tiers this package's reads follow (ADR-164). */
  readonly contracts?: readonly CacheDeclaringContract[];
};
