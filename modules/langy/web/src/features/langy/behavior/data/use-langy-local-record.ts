/**
 * The conversation's local control record (ADR-129). Read from the durable record rather than
 * the live stream, since the live stream can't answer for a tab that never subscribed. Follows
 * the conversation's event cursor, so a card lands within one poll.
 */

import type { LangyEventCursor } from "@langwatch/langy-contract";
import { useEffect } from "react";

import { api } from "../../../../behavior/langy-api.ts";

import type { LangyRecordWait } from "../../../../model/langy-local-waits.ts";
import { useLangyLocalControlStore } from "../../../../behavior/langy-local-control.store.ts";

export interface LangyLocalRecordResult {
  waits: LangyRecordWait[];
  /** Whether the record's last word on the folder was that it connected. */
  workspaceConnected: boolean;
  /**
   * The read itself failed, so the cards this record carries are not on
   * screen and the panel cannot know whether any are waiting. Never quieter
   * than a success: the panel says so and offers the read again.
   */
  isError: boolean;
  /** The failure, for the shared error copy to name it. */
  error: unknown;
  /** Read the record again, which is what the panel's retry does. */
  refetch: () => void;
}

const NO_WAITS: LangyRecordWait[] = [];

export function useLangyLocalRecord({
  projectId,
  conversationId,
  cursor,
}: {
  projectId: string | undefined;
  conversationId: string | null;
  cursor: LangyEventCursor | null | undefined;
}): LangyLocalRecordResult {
  const query = api.langy.localRecord.useQuery(
    { projectId: projectId ?? "", conversationId: conversationId ?? "" },
    {
      enabled: !!projectId && !!conversationId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  const refetch = query.refetch;
  useEffect(() => {
    if (!cursor) return;
    void refetch();
  }, [cursor?.acceptedAt, cursor?.eventId, refetch]);

  // The folder connecting is what the code access card has to hear about, and
  // on the turn the connect itself started this browser has no live entry to
  // hear it from: the card sat on "How should I reach your code?" for a minute
  // after the terminal said Connected. Bumping the store's revision is the
  // same wake-up a live entry gives, so the card refetches its one query.
  const connected = conversationId ? query.data?.workspaceConnected : undefined;
  useEffect(() => {
    if (connected === undefined) return;
    useLangyLocalControlStore.getState().recordWorkspaceState({
      conversationId,
      connected,
    });
  }, [connected, conversationId]);

  const data = conversationId ? query.data : undefined;
  return {
    waits: (data?.waits ?? NO_WAITS) as LangyRecordWait[],
    workspaceConnected: data?.workspaceConnected ?? false,
    isError: !!conversationId && query.isError,
    error: conversationId ? query.error : null,
    refetch: () => void refetch(),
  };
}
