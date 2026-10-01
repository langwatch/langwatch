/**
 * A visible tab's one hint stream (record §10, "Server events say when a read is stale"): a hint
 * names a procedure path, whose mounted reads refetch here and go stale in the other tabs.
 * packages/api/specs/read-hints.feature.
 */

import { procedurePathOf } from "@langwatch/browser-host/cache-tiers";
import type { UiRpc } from "@langwatch/browser-host/capabilities";
import { UI_QUERY_SYNC_CHANNEL } from "@langwatch/browser-host/query-sync";
import { focusManager, type Query, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";

/** What the tab reads off a hint; the server's tenant has already been checked. */
const uiQueryHintSchema = z.object({ path: z.string().min(1) });
export type UiQueryHint = z.infer<typeof uiQueryHintSchema>;

/** Opens the stream and delivers each hint. Answers the close. */
export type UiQueryHintStream = (handlers: { onHint: (hint: unknown) => void }) => () => void;

/** `presence.onProjectReadHints`, or `presence.onOrganizationReadHints` with no project. */
export function readHintStreamOver({
  rpc,
  organizationId,
  projectId,
}: {
  rpc: UiRpc;
  organizationId: string;
  projectId: string | null;
}): UiQueryHintStream {
  return ({ onHint }) => {
    const handlers = { onData: onHint };
    // Hints are optional (the safety refetch covers staleness), so a runtime
    // with no stream stays quiet.
    try {
      const subscription =
        projectId === null
          ? rpc.subscribe("presence.onOrganizationReadHints", { organizationId }, handlers)
          : rpc.subscribe("presence.onProjectReadHints", { organizationId, projectId }, handlers);
      return () => subscription.unsubscribe();
    } catch {
      return () => {};
    }
  };
}

type HintChannel = Pick<BroadcastChannel, "postMessage" | "close" | "onmessage">;

/** Some browsers refuse a channel (opaque origins, privacy modes); hints then stay in this tab. */
function openChannel(): HintChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    return new BroadcastChannel(UI_QUERY_SYNC_CHANNEL);
  } catch {
    return;
  }
}

const underPath = (path: string) => (query: Query) => procedurePathOf(query.queryKey) === path;

/**
 * Starts this tab's half; returns the stop. Every tab listens on the channel, only a visible
 * one holds the stream.
 */
export function startUiQueryHints({
  queryClient,
  stream,
  channel = openChannel(),
}: {
  queryClient: QueryClient;
  stream: UiQueryHintStream;
  channel?: HintChannel | undefined;
}): () => void {
  let closeStream: (() => void) | undefined;

  const onHint = (value: unknown) => {
    const hint = uiQueryHintSchema.safeParse(value);
    if (!hint.success) return;
    void queryClient.invalidateQueries({ predicate: underPath(hint.data.path) });
    channel?.postMessage({ path: hint.data.path });
  };
  // A reopened stream revalidates nothing: the one focus pass (query-sync) refetches stale reads.
  // ARCHITECTURE.md §10.2.
  const follow = (focused: boolean) => {
    if (focused && !closeStream) closeStream = stream({ onHint });
    if (focused || !closeStream) return;
    closeStream();
    closeStream = undefined;
  };

  if (channel) {
    channel.onmessage = ({ data }: MessageEvent) => {
      const hint = uiQueryHintSchema.safeParse(data);
      if (!hint.success) return;
      void queryClient.invalidateQueries({
        predicate: underPath(hint.data.path),
        refetchType: "none",
      });
    };
  }
  follow(focusManager.isFocused());
  const stopFocus = focusManager.subscribe(follow);

  return () => {
    stopFocus();
    closeStream?.();
    channel?.close();
  };
}
