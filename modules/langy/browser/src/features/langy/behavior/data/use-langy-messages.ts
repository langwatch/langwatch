import type { LangyEventCursor, LangyMessageDto } from "@langwatch/langy-contract";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";

export interface LangyMessagesResult {
  messages: LangyMessageDto[];
  /**
   * The last turn's failure, serialized (a domain-error kind + safe meta, never raw
   * text) — or null if it didn't fail.
   */
  lastError: string | null;
  /**
   * Whether a turn is in flight right now, read off the conversation fold — the DURABLE
   * truth, not the browser stream.
   */
  isTurnInFlight: boolean;
  /**
   * WHICH turn is in flight, straight off the durable record — null when none is, and
   * null in the brief window between a send and the turn being accepted.
   */
  inFlightTurnId: string | null;
  /**
   * The backend-driven feedback cadence: should the panel ask "How did Langy
   * do?" under the latest answer? Computed server-side (conversation depth +
   * per-user quiet period) so it holds across tabs and devices.
   */
  shouldAskFeedback: boolean;
  /**
   * The projection's event cursor at this snapshot (ADR-059): where the local
   * fold seeds itself before catching up on the durable tail. Null until the
   * snapshot lands (or from servers predating the field).
   */
  eventCursor: LangyEventCursor | null;
  /** The turn in flight per the durable fold — what a refresh reattaches to. */
  currentTurnId: string | null;
  /**
   * The model the conversation's latest turn ran on, off the durable fold — null before
   * any turn recorded one. The panel seeds the composer's picker from it on open, so a
   * conversation keeps the model it was last used with across tabs and reloads.
   */
  lastModel: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  /** Re-run the history fetch — what the failure card's "Try again" does. */
  refetch: () => void;
  /** The failure itself, so the panel can classify and explain it. */
  error: unknown;
}

/**
 * HEAVY, on-demand message history for one conversation (`langy.messages`).
 */
export function useLangyMessages(conversationId: string | null): LangyMessagesResult {
  const { project } = useOrganizationTeamProject();

  const query = api.langy.messages.useQuery(
    {
      projectId: project?.id ?? "",
      conversationId: conversationId ?? "",
    },
    {
      enabled: !!project?.id && !!conversationId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    },
  );

  // A successful read is durable proof the conversation's projection exists —
  // confirms a freshly-minted conversation (see `unconfirmedConversations`).
  const conversationRead = !!conversationId && query.isSuccess;
  useEffect(() => {
    if (conversationRead && conversationId) {
      useLangyStore.getState().confirmConversation(conversationId);
    }
  }, [conversationRead, conversationId]);

  // With no conversation open there is nothing to read: `keepPreviousData` smooths the switch
  // between two conversations, but after New chat it would keep handing back the one just left.
  const data = conversationId ? query.data : undefined;

  return {
    messages: (data?.messages ?? []) as LangyMessageDto[],
    lastError: data?.lastError ?? null,
    isTurnInFlight: data?.isTurnInFlight ?? false,
    inFlightTurnId: data?.inFlightTurnId ?? null,
    shouldAskFeedback: data?.shouldAskFeedback ?? false,
    eventCursor: data?.eventCursor ?? null,
    currentTurnId: data?.currentTurnId ?? null,
    lastModel: data?.lastModel ?? null,
    isLoading: !!conversationId && query.isLoading,
    isFetching: !!conversationId && query.isFetching,
    isError: !!conversationId && query.isError,
    error: conversationId ? query.error : null,
    refetch: () => void query.refetch(),
  };
}
