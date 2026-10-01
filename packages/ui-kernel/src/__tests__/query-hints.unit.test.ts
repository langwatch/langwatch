/**
 * The focused tab's hint stream. packages/api/specs/read-hints.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import {
  UiRpc,
  type UiRpcSubscription,
  type UiRpcSubscriptionHandlers,
} from "@langwatch/browser-host/capabilities";
import { focusManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readHintStreamOver, startUiQueryHints, type UiQueryHintStream } from "../query-hints.ts";

const graphKey = trpcQueryKey("organization.getScopeGraph", { input: {}, type: "query" });
const projectsKey = trpcQueryKey("project.getAll", { input: {}, type: "query" });

function fakeStream() {
  const opened: { onOpen: () => void; onHint: (hint: unknown) => void }[] = [];
  let open = 0;
  const stream: UiQueryHintStream = (handlers) => {
    opened.push(handlers);
    open += 1;
    return () => void (open -= 1);
  };
  return { stream, opened, openCount: () => open, latest: () => opened[opened.length - 1] };
}

function fakeChannel() {
  const sent: unknown[] = [];
  return {
    sent,
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: (message: unknown) => void sent.push(message),
    close: () => void 0,
  };
}

/** A read mounted by one observer; `fetches` counts its network calls. */
async function mount({
  queryClient,
  queryKey,
}: {
  queryClient: QueryClient;
  queryKey: readonly unknown[];
}) {
  let fetches = 0;
  const queryFn = async () => ({ fetch: ++fetches });
  const observer = new QueryObserver(queryClient, { queryKey, queryFn, staleTime: 30_000 });
  const unsubscribe = observer.subscribe(() => void 0);
  await vi.waitFor(() => expect(fetches).toBe(1));
  return { fetches: () => fetches, unsubscribe };
}

const isStale = ({
  queryClient,
  queryKey,
}: {
  queryClient: QueryClient;
  queryKey: readonly unknown[];
}) => queryClient.getQueryCache().find({ queryKey, exact: true })?.state.isInvalidated;

/** A browser that refuses a channel (opaque origin, privacy mode). */
class RefusedBroadcastChannel {
  constructor() {
    throw new Error("refused");
  }
}

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
});

describe("startUiQueryHints", () => {
  /** @scenario "Only the focused tab holds the hint stream" */
  it("opens one stream while focused and closes it on blur", () => {
    focusManager.setFocused(true);
    const { stream, openCount } = fakeStream();
    const stop = startUiQueryHints({
      queryClient: new QueryClient(),
      stream,
      channel: fakeChannel(),
    });

    expect(openCount()).toBe(1);
    focusManager.setFocused(false);
    expect(openCount()).toBe(0);
    focusManager.setFocused(true);
    expect(openCount()).toBe(1);
    stop();
    expect(openCount()).toBe(0);
  });

  it("opens no stream in a tab that starts hidden", () => {
    focusManager.setFocused(false);
    const { stream, openCount } = fakeStream();
    startUiQueryHints({ queryClient: new QueryClient(), stream, channel: fakeChannel() })();

    expect(openCount()).toBe(0);
  });

  /** @scenario "A hint refetches the mounted reads of its procedure and no others" */
  it("refetches only the reads under the hinted path", async () => {
    focusManager.setFocused(true);
    const queryClient = new QueryClient();
    const graph = await mount({ queryClient, queryKey: graphKey });
    const projects = await mount({ queryClient, queryKey: projectsKey });
    const { stream, latest } = fakeStream();
    startUiQueryHints({ queryClient, stream, channel: fakeChannel() });

    latest()?.onHint({ path: "organization.getScopeGraph", tenant: { organizationId: "acme" } });

    await vi.waitFor(() => expect(graph.fetches()).toBe(2));
    expect(projects.fetches()).toBe(1);
  });

  /** @scenario "A hint is passed to the other tabs, which mark the read stale without fetching" */
  it("posts the path to other tabs, which mark it stale and fetch nothing", async () => {
    focusManager.setFocused(true);
    const focusedChannel = fakeChannel();
    const { stream, latest } = fakeStream();
    startUiQueryHints({ queryClient: new QueryClient(), stream, channel: focusedChannel });
    latest()?.onHint({ path: "organization.getScopeGraph" });
    expect(focusedChannel.sent).toEqual([{ path: "organization.getScopeGraph" }]);

    focusManager.setFocused(false);
    const hidden = new QueryClient();
    const graph = await mount({ queryClient: hidden, queryKey: graphKey });
    const hiddenChannel = fakeChannel();
    startUiQueryHints({ queryClient: hidden, stream: fakeStream().stream, channel: hiddenChannel });
    hiddenChannel.onmessage?.(new MessageEvent("message", { data: focusedChannel.sent[0] }));

    await vi.waitFor(() => expect(isStale({ queryClient: hidden, queryKey: graphKey })).toBe(true));
    expect(graph.fetches()).toBe(1);
  });

  /** @scenario "A connected stream marks every mounted read stale once" */
  it("refetches every mounted read on each open", async () => {
    focusManager.setFocused(true);
    const queryClient = new QueryClient();
    const graph = await mount({ queryClient, queryKey: graphKey });
    const projects = await mount({ queryClient, queryKey: projectsKey });
    const { stream, latest } = fakeStream();
    startUiQueryHints({ queryClient, stream, channel: fakeChannel() });

    latest()?.onOpen();

    await vi.waitFor(() => expect(graph.fetches()).toBe(2));
    await vi.waitFor(() => expect(projects.fetches()).toBe(2));
  });

  /** @scenario "A malformed hint is ignored" */
  it("ignores a hint with no path", async () => {
    focusManager.setFocused(true);
    const queryClient = new QueryClient();
    const graph = await mount({ queryClient, queryKey: graphKey });
    const channel = fakeChannel();
    const { stream, latest } = fakeStream();
    startUiQueryHints({ queryClient, stream, channel });

    latest()?.onHint({ tenant: { organizationId: "acme" } });
    latest()?.onHint("organization.getScopeGraph");

    expect(isStale({ queryClient, queryKey: graphKey })).toBe(false);
    expect(graph.fetches()).toBe(1);
    expect(channel.sent).toEqual([]);
  });

  /** @scenario "A tab without a broadcast channel still refetches on a hint" */
  it("refetches without a channel", async () => {
    focusManager.setFocused(true);
    const queryClient = new QueryClient();
    const graph = await mount({ queryClient, queryKey: graphKey });
    vi.stubGlobal("BroadcastChannel", RefusedBroadcastChannel);
    const { stream, latest } = fakeStream();
    startUiQueryHints({ queryClient, stream });

    latest()?.onHint({ path: "organization.getScopeGraph" });

    await vi.waitFor(() => expect(graph.fetches()).toBe(2));
  });
});

/** Records the one subscription the stream opens; every other dispatch refuses. */
class RecordingRpc extends UiRpc {
  readonly opened: { path: string; input: unknown; handlers: UiRpcSubscriptionHandlers }[] = [];
  closed = 0;

  async query(): Promise<unknown> {
    throw new Error("not a query");
  }

  async mutate(): Promise<unknown> {
    throw new Error("not a mutation");
  }

  subscribe(path: string, input: unknown, handlers: UiRpcSubscriptionHandlers): UiRpcSubscription {
    this.opened.push({ path, input, handlers });
    return { unsubscribe: () => void (this.closed += 1) };
  }
}

describe("readHintStreamOver", () => {
  /** @scenario "A hint refetches the mounted reads of its procedure and no others" */
  it("opens notification.onReadHints for where the tab stands and relays its frames", () => {
    const rpc = new RecordingRpc();
    const opens: number[] = [];
    const hints: unknown[] = [];

    const close = readHintStreamOver({ rpc, organizationId: "acme", projectId: "p1" })({
      onOpen: () => void opens.push(1),
      onHint: (hint) => void hints.push(hint),
    });
    rpc.opened[0]?.handlers.onStarted?.();
    rpc.opened[0]?.handlers.onData?.({ path: "organization.getScopeGraph" });
    close();

    expect(rpc.opened.map(({ path, input }) => ({ path, input }))).toEqual([
      { path: "notification.onReadHints", input: { organizationId: "acme", projectId: "p1" } },
    ]);
    expect(opens).toEqual([1]);
    expect(hints).toEqual([{ path: "organization.getScopeGraph" }]);
    expect(rpc.closed).toBe(1);
  });

  it("names no project on a page outside one", () => {
    const rpc = new RecordingRpc();

    readHintStreamOver({ rpc, organizationId: "acme", projectId: null })({
      onOpen: () => undefined,
      onHint: () => undefined,
    });

    expect(rpc.opened[0]?.input).toEqual({ organizationId: "acme" });
  });
});
