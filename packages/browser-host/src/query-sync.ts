/**
 * Only the focused tab speaks to the server; its landed fetch broadcasts `{ key, version }`,
 * never data, and a tab whose version differs marks the key stale. On focus a tab reads
 * IndexedDB first. specs/ui/browser-query-caching.feature.
 */

import {
  focusManager,
  hashKey,
  type Query,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from "@tanstack/react-query";

import { procedurePathOf, type UiCachePlan, type UiQueryVersions } from "./cache-tiers.ts";
import { readStoredQuery, storedQueryKey, type UiQueryStore } from "./query-persistence.ts";

export const UI_QUERY_SYNC_CHANNEL = "langwatch:query-versions";

type UiQuerySyncMessage = { key: string; version: string };

function isSyncMessage(value: unknown): value is UiQuerySyncMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "key" in value &&
    typeof value.key === "string" &&
    "version" in value &&
    typeof value.version === "string"
  );
}

/** Some browsers refuse a channel (opaque origins, privacy modes); the tab then syncs on focus. */
function openChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    return new BroadcastChannel(UI_QUERY_SYNC_CHANNEL);
  } catch {
    return;
  }
}

type SyncChannel = Pick<BroadcastChannel, "postMessage" | "close" | "onmessage">;

/** What every stage of one tab's sync reads; `announced` holds versions heard but not yet held. */
type SyncContext = {
  queryClient: QueryClient;
  plan: UiCachePlan;
  store: UiQueryStore;
  userId: string;
  buildId: string;
  versions: UiQueryVersions;
  announced: Map<string, string>;
};

const pathOf = (query: Query) => procedurePathOf(query.queryKey) ?? "";

/** The persisted reads: the ones another tab's copy or the disk can stand in for. */
function isTracked({ plan, query }: { plan: UiCachePlan; query: Query }): boolean {
  return plan.persisted.has(pathOf(query));
}

function versionOf({ versions, query }: { versions: UiQueryVersions; query: Query }): string {
  return versions.get(query.queryHash) ?? hashKey([query.state.data]);
}

function markStale({ queryClient, query }: { queryClient: QueryClient; query: Query }) {
  return queryClient.invalidateQueries({
    queryKey: query.queryKey,
    exact: true,
    refetchType: "none",
  });
}

/** A landed fetch in the focused tab tells the others which version it holds. */
function announce({
  event,
  channel,
  plan,
  versions,
}: {
  event: QueryCacheNotifyEvent;
  channel: SyncChannel | undefined;
  plan: UiCachePlan;
  versions: UiQueryVersions;
}): void {
  if (event.type !== "updated" || event.action.type !== "success" || event.action.manual) return;
  if (!focusManager.isFocused() || !isTracked({ plan, query: event.query })) return;
  channel?.postMessage({
    key: event.query.queryHash,
    version: versionOf({ versions, query: event.query }),
  });
}

/** A version this tab does not hold marks the read stale; nothing is fetched. */
function receive({ data, context }: { data: unknown; context: SyncContext }): void {
  if (!isSyncMessage(data)) return;
  const query = context.queryClient.getQueryCache().get(data.key);
  if (!query || !isTracked({ plan: context.plan, query })) return;
  if (versionOf({ versions: context.versions, query }) === data.version) return;
  context.announced.set(data.key, data.version);
  void markStale({ queryClient: context.queryClient, query });
}

/** Draws the stored copy when newer than this tab's; stale again if behind the announcement. */
async function adoptFromDisk({ context, query }: { context: SyncContext; query: Query }) {
  const { queryClient, versions, announced } = context;
  const entry = await readStoredQuery({
    store: context.store,
    key: storedQueryKey({ userId: context.userId, queryHash: query.queryHash }),
    buildId: context.buildId,
  });
  if (!entry || entry.updatedAt <= query.state.dataUpdatedAt) return;
  if (entry.version === undefined) versions.delete(query.queryHash);
  else versions.set(query.queryHash, entry.version);
  queryClient.setQueryData(query.queryKey, entry.data, { updatedAt: entry.updatedAt });
  if (versionOf({ versions, query }) === announced.get(query.queryHash)) return;
  await markStale({ queryClient, query });
}

/** Disk first, then the network for what is still behind. */
async function refreshOnFocus(context: SyncContext): Promise<void> {
  const { queryClient, plan } = context;
  const isBehind = (query: Query) => isTracked({ plan, query }) && query.state.isInvalidated;
  const behind = queryClient.getQueryCache().findAll({ predicate: isBehind });
  await Promise.all(behind.map((query) => adoptFromDisk({ context, query })));
  context.announced.clear();
  await queryClient.refetchQueries({ type: "active", predicate: isBehind });
}

/**
 * Starts this tab's half of the sync; returns the stop. A read without a server
 * version is compared by a hash of its data.
 */
export function startUiQuerySync({
  channel = openChannel(),
  ...options
}: Omit<SyncContext, "announced"> & { channel?: SyncChannel | undefined }): () => void {
  const context: SyncContext = { ...options, announced: new Map() };
  const stopAnnouncing = options.queryClient
    .getQueryCache()
    .subscribe((event) =>
      announce({ event, channel, plan: options.plan, versions: options.versions }),
    );
  if (channel) channel.onmessage = ({ data }: MessageEvent) => receive({ data, context });
  const stopFocus = focusManager.subscribe((focused) => {
    if (focused) void refreshOnFocus(context);
  });

  return () => {
    stopAnnouncing();
    stopFocus();
    channel?.close();
  };
}
