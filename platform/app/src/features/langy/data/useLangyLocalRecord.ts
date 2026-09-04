/**
 * The conversation's local control record (ADR-129): every card the
 * developer's machine put up, and whether the folder is connected.
 *
 * Read from the durable record rather than from the live stream, because the
 * live stream cannot answer either question for a tab that did not start the
 * turn — it never subscribes — and answers neither at all for a conversation
 * that is simply reopened.
 *
 * It follows the conversation's event cursor: the messages poll moves that
 * while a turn is in flight, so a card raised on the running turn lands within
 * one poll, and a settled conversation reads it once.
 */

import type { LangyEventCursor } from "@langwatch/langy";
import { useEffect } from "react";

import { api } from "~/utils/api";

import type { LangyRecordWait } from "../logic/langyLocalWaits";
import { useLangyLocalControlStore } from "../stores/langyLocalControlStore";

export interface LangyLocalRecordResult {
  waits: LangyRecordWait[];
  /** Whether the record's last word on the folder was that it connected. */
  workspaceConnected: boolean;
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
  };
}
