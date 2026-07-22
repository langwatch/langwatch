import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
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
   * `agent_turn_accepted`, after opencode has forked + npm-installed). The
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
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  /** The failure itself, so the panel can classify and explain it. */
  error: unknown;
}

/** How often the durable turn state is re-checked while a turn is in flight. */
const TURN_IN_FLIGHT_POLL_MS = 3_000;

/**
 * Self-stopping poll (see dev/docs/best_practices/async-processing-ui.md):
 * while the fold says a turn is in flight, re-check on a short interval so the
 * settled state lands even when the freshness signal is delayed or lost —
 * without it a stale `isTurnInFlight: true` sits in the cache and the working
 * indicator outlives the answer. Stops itself the moment the turn settles.
 */
export function langyMessagesPollInterval(
  data: { isTurnInFlight: boolean } | undefined,
): number | false {
  return data?.isTurnInFlight ? TURN_IN_FLIGHT_POLL_MS : false;
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

  const query = api.langy.messages.useQuery(
    {
      projectId: project?.id ?? "",
      conversationId: conversationId ?? "",
    },
    {
      enabled: !!project?.id && !!conversationId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      keepPreviousData: true,
      // Wrapped, not passed by reference: handing the helper straight to
      // react-query lets its narrow `{ isTurnInFlight }` param type win the
      // inference for the query's TData, collapsing `query.data` to that shape
      // (CI typecheck caught it). The arrow keeps `data` contextually typed.
      refetchInterval: (data) => langyMessagesPollInterval(data),
    },
  );

  return {
    messages: (query.data?.messages ?? []) as LangyMessageDto[],
    lastError: query.data?.lastError ?? null,
    isTurnInFlight: query.data?.isTurnInFlight ?? false,
    inFlightTurnId: query.data?.inFlightTurnId ?? null,
    shouldAskFeedback: query.data?.shouldAskFeedback ?? false,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    /** Re-run the history fetch — what the failure card's "Try again" does. */
    refetch: query.refetch,
  };
}
