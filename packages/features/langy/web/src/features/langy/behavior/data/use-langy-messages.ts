import type { LangyEventCursor } from "@langwatch/langy-contract";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect } from "react";

import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { api } from "../../../../behavior/langy-api.ts";
import { useLangyStore } from "../../../../behavior/langy.store.ts";
import type { LangyMessageDto } from "@langwatch/langy-contract";

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

/** How often the durable turn state is re-checked while a turn is in flight. */
const TURN_IN_FLIGHT_POLL_MS = 3_000;

/**
 * Self-stopping poll (see dev/docs/best_practices/async-processing-ui.md): while the fold says a
 * turn is in flight, re-check so the settled state lands even if the freshness signal is lost.
 */
export function langyMessagesPollInterval(
  data: { isTurnInFlight: boolean } | undefined,
): number | false {
  return data?.isTurnInFlight ? TURN_IN_FLIGHT_POLL_MS : false;
}

/** The raw query result's `data` shape, loosely — only the fields this hook reads. */
type LangyMessagesData = Partial<
  Omit<
    LangyMessagesResult,
    "isLoading" | "isFetching" | "isError" | "refetch" | "error" | "messages"
  >
> & { messages?: unknown };

/** Assembles the hook's result from the query state, with every field's fallback in
 *  one place instead of inline in the return statement. */
function buildLangyMessagesResult({
  data,
  conversationId,
  query,
}: {
  data: LangyMessagesData | undefined;
  conversationId: string | null;
  query: {
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
}): LangyMessagesResult {
  const hasConversation = !!conversationId;
  return {
    messages: (data?.messages ?? []) as LangyMessageDto[],
    lastError: data?.lastError ?? null,
    isTurnInFlight: data?.isTurnInFlight ?? false,
    inFlightTurnId: data?.inFlightTurnId ?? null,
    shouldAskFeedback: data?.shouldAskFeedback ?? false,
    eventCursor: data?.eventCursor ?? null,
    currentTurnId: data?.currentTurnId ?? null,
    lastModel: data?.lastModel ?? null,
    isLoading: hasConversation && query.isLoading,
    isFetching: hasConversation && query.isFetching,
    isError: hasConversation && query.isError,
    error: hasConversation ? query.error : null,
    refetch: () => void query.refetch(),
  };
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
      refetchInterval: (query) => langyMessagesPollInterval(query.state.data),
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

  return buildLangyMessagesResult({ data, conversationId, query });
}
