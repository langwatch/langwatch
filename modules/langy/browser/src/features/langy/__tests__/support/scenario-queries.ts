/**
 * `enabled`-honouring stand-ins for tRPC queries, served from a test's own scenario: one async
 * resolution per arm / refetch / invalidation, loading → success | error, no retries.
 */

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";

/** A version every armed query subscribes to, so an invalidate refreshes it like React Query. */
export type InvalidationChannel = { listeners: Set<() => void>; state: { version: number } };

type QueryState<TData> = {
  status: "loading" | "success" | "error";
  data: TData | undefined;
  error: unknown;
  fetched: boolean;
};

const LOADING = { status: "loading", data: undefined, error: null, fetched: false } as const;

function useChannelVersion(channel: InvalidationChannel | undefined): number {
  return useSyncExternalStore(
    (notify: () => void) => {
      if (!channel) return () => undefined;
      channel.listeners.add(notify);
      return () => channel.listeners.delete(notify);
    },
    () => channel?.state.version ?? 0,
  );
}

const failed = <TData>(error: unknown): QueryState<TData> => ({
  status: "error",
  data: undefined,
  error,
  fetched: true,
});

/** Settles one resolution into state unless the effect that armed it has since been torn down. */
function settle<TData, TState>({
  promise,
  isCancelled,
  onData,
  onError,
  setState,
}: {
  promise: Promise<TData>;
  isCancelled: () => boolean;
  onData: (data: TData) => TState;
  onError: (error: unknown) => TState;
  setState: (state: TState) => void;
}): void {
  promise
    .then((data) => {
      if (!isCancelled()) setState(onData(data));
    })
    .catch((error: unknown) => {
      if (!isCancelled()) setState(onError(error));
    });
}

export function useScenarioQuery<TData>({
  resolve,
  enabled,
  channel,
}: {
  resolve: () => Promise<TData>;
  enabled: boolean;
  channel?: InvalidationChannel;
}) {
  const version = useChannelVersion(channel);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<QueryState<TData>>(LOADING);
  const run = useEffectEvent((isCancelled: () => boolean) =>
    settle({
      promise: resolve(),
      isCancelled,
      onData: (data): QueryState<TData> => ({
        status: "success",
        data,
        error: null,
        fetched: true,
      }),
      onError: failed<TData>,
      setState,
    }),
  );
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    run(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce, version]);

  const loading = enabled && state.status === "loading";
  return {
    data: state.data,
    // isLoading, not isFetching: React Query reports a DISABLED query as loading forever,
    // and the panel disables the list while closed, so only an enabled query counts.
    isLoading: loading,
    isFetching: loading,
    isPlaceholderData: false,
    isFetched: state.fetched,
    isError: state.status === "error",
    error: state.error,
    refetch: () => {
      setNonce((n) => n + 1);
      return Promise.resolve();
    },
  };
}

export type ListInput = { projectId: string; limit: number; query?: string };
export type ListCursor = { lastActivityAtMs: number | null; id: string };
type ListConversation = { id: string; title: string | null; lastActivityAtMs: number };
export type ListPage<TConversation> = {
  items: TConversation[];
  nextCursor: { lastActivityAtMs: number; id: string } | null;
};

/** The conversations a search matches, newest activity first, ties broken by id. */
function visibleConversations<TConversation extends ListConversation>(
  conversations: TConversation[],
  query: string | undefined,
): TConversation[] {
  const q = query?.trim().toLowerCase();
  return conversations
    .filter((conversation) => (q ? conversation.title?.toLowerCase().includes(q) : true))
    .toSorted((a, b) => b.lastActivityAtMs - a.lastActivityAtMs || b.id.localeCompare(a.id));
}

/** One page of the recents list after a cursor, as `langy.list` pages it. */
export function listPage<TConversation extends ListConversation>({
  conversations,
  input,
  cursor,
}: {
  conversations: TConversation[];
  input: ListInput;
  cursor?: ListCursor;
}): ListPage<TConversation> {
  const visible = visibleConversations(conversations, input.query);
  const cursorIndex = cursor
    ? visible.findIndex(
        (conversation) =>
          conversation.id === cursor.id &&
          conversation.lastActivityAtMs === cursor.lastActivityAtMs,
      )
    : -1;
  const start = cursorIndex + 1;
  const items = visible.slice(start, start + input.limit);
  const last = items.at(-1);
  const hasMore = start + items.length < visible.length;
  return {
    items,
    nextCursor: hasMore && last ? { lastActivityAtMs: last.lastActivityAtMs, id: last.id } : null,
  };
}

type InfiniteData<TPage> = { pages: TPage[]; pageParams: (ListCursor | undefined)[] };

/** An infinite list query over `resolvePage`, refreshed by the channel and paged by cursor. */
export function useScenarioInfiniteListQuery<TPage extends { nextCursor: ListCursor | null }>({
  input,
  enabled,
  channel,
  resolvePage,
}: {
  input: ListInput;
  enabled: boolean;
  channel: InvalidationChannel;
  resolvePage: (input: ListInput, cursor?: ListCursor) => Promise<TPage>;
}) {
  const version = useChannelVersion(channel);
  const [nonce, setNonce] = useState(0);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [state, setState] = useState<QueryState<InfiniteData<TPage>>>(LOADING);
  const run = useEffectEvent((isCancelled: () => boolean) => {
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    settle({
      promise: resolvePage(input),
      isCancelled,
      onData: (page): QueryState<InfiniteData<TPage>> => ({
        status: "success",
        data: { pages: [page], pageParams: [undefined] },
        error: null,
        fetched: true,
      }),
      onError: failed<InfiniteData<TPage>>,
      setState,
    });
  });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    run(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [enabled, input.projectId, input.limit, input.query, nonce, version]);

  const nextCursor = state.data?.pages.at(-1)?.nextCursor ?? undefined;
  const fetchNextPage = async () => {
    if (!nextCursor) return;
    setIsFetchingNextPage(true);
    try {
      const page = await resolvePage(input, nextCursor);
      setState((previous) => ({
        status: "success",
        data: {
          pages: [...(previous.data?.pages ?? []), page],
          pageParams: [...(previous.data?.pageParams ?? []), nextCursor],
        },
        error: null,
        fetched: true,
      }));
    } finally {
      setIsFetchingNextPage(false);
    }
  };

  const loading = enabled && state.status === "loading";
  return {
    data: state.data,
    isLoading: loading && state.data === undefined,
    isFetching: loading,
    isPlaceholderData: state.status === "loading" && state.data !== undefined,
    isFetched: state.fetched,
    isError: state.status === "error",
    error: state.error,
    refetch: () => {
      setNonce((n) => n + 1);
      return Promise.resolve();
    },
    fetchNextPage,
    hasNextPage: !!nextCursor,
    isFetchingNextPage,
  };
}
