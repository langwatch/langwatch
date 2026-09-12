import type { LangyEventCursor } from "@langwatch/langy";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useLangyStore } from "../stores/langyStore";
import type { LangyMessageDto } from "./langy.dtos";

export interface LangyMessagesResult {
  messages: LangyMessageDto[];
  /**
   * The last turn's failure, serialized (a domain-error kind + safe meta, never
   * raw text) — or null if it didn't fail.
   *
   * Turn errors used to live ONLY in `useChat`'s state, so a refresh after a
   * failed turn left the user's question sitting there with no answer and no
   * explanation. The failure was durable on the conversation fold the whole
   * time; nobody read it back. Now the history load carries it, and the panel
   * renders the same card it would have shown live.
   */
  lastError: string | null;
  /**
   * Whether a turn is in flight right now, read off the conversation fold — the
   * DURABLE truth, not the browser stream. Covers the whole span from
   * message-sent (`active`) through the agent responding (`running`), so it
   * includes the worker cold-start window (the fold only reaches `running` at
   * `agent_turn_accepted`, after the worker has forked + npm-installed). The
   * live `useChat` transport only knows a turn is running while its
   * `onTurnStream` subscription is open, and that closes the moment a silent
   * worker stops pushing frames — long before the turn ends. This lets the panel
   * hold a working state through that gap instead of going blank.
   */
  isTurnInFlight: boolean;
  /**
   * WHICH turn is in flight, straight off the durable record — null when none
   * is, and null in the brief window between a send and the turn being accepted.
   *
   * This is what makes Stop work in a tab that did not start the turn. A tab
   * only learns a turn id from its own send, so a turn adopted from
   * `isTurnInFlight` alone had a Stop button with nothing behind it (see
   * `logic/langyStopTarget.ts`).
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
   * The model the conversation's latest turn ran on, off the durable fold —
   * null before any turn recorded one. The panel seeds the composer's picker
   * from it on open, so a conversation keeps the model it was last used with
   * across tabs and reloads.
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
 * How often a read that has not produced data yet is retried while the
 * conversation is still unconfirmed. Shorter than the in-flight cadence: the
 * projection usually lands within a few seconds, and every beat of this
 * interval is a beat the panel spends saying "not found" about a conversation
 * the user is looking at.
 */
const UNCONFIRMED_POLL_MS = 1_000;

/**
 * Self-stopping poll (see dev/docs/best_practices/async-processing-ui.md):
 * while the fold says a turn is in flight, re-check on a short interval so the
 * settled state lands even when the freshness signal is delayed or lost —
 * without it a stale `isTurnInFlight: true` sits in the cache and the working
 * indicator outlives the answer. Stops itself the moment the turn settles.
 *
 * A read with NO data for a conversation this tab just minted also polls
 * (`unconfirmed` — see `unconfirmedConversations`): the projection row is
 * written by an asynchronous fold, so the first read routinely 404s, the
 * query's retry policy rightly never retries a 404, and nothing else would
 * ever re-ask. Stops itself on the first successful read — data lands, the
 * success effect confirms the conversation, and the flag drops.
 */
export function langyMessagesPollInterval(
  data: { isTurnInFlight: boolean } | undefined,
  unconfirmed = false,
): number | false {
  if (data?.isTurnInFlight) return TURN_IN_FLIGHT_POLL_MS;
  if (!data && unconfirmed) return UNCONFIRMED_POLL_MS;
  return false;
}

/**
 * HEAVY, on-demand message history for one conversation (`langy.messages`).
 * Deliberately split from the slim list: opening a conversation reads its
 * messages here, and the recents list is never re-fetched to obtain them (and
 * never carries content). Disabled until a conversation is selected.
 */
export function useLangyMessages(
  conversationId: string | null,
): LangyMessagesResult {
  const { project } = useOrganizationTeamProject();

  // Subscribed on THIS hook's conversation (not the store's active one): the
  // poll must follow the query it drives, and the two ids diverge mid-switch.
  const unconfirmed = useLangyStore(
    (s) => !!conversationId && !!s.unconfirmedConversations[conversationId],
  );

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
      refetchInterval: (query) =>
        langyMessagesPollInterval(query.state.data, unconfirmed),
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

  // With no conversation open there is nothing to read. `keepPreviousData`
  // exists to smooth the switch BETWEEN two conversations, but after New chat
  // it keeps handing back the conversation just left: its messages, its
  // in-flight flag and its last error. The panel then reported all three about
  // a conversation the reader had already walked away from — the composer said
  // Langy was working and the column showed the old turn's failure.
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
