import { useLangyStore } from "@langwatch/langy-browser-kit";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  explainLangyError,
  isLangyConversationPending,
  LANGY_CONVERSATION_PENDING_GRACE_MS,
  readLangyTrpcError,
} from "../logic/langy-error-explainer.ts";

/** What an error card draws: a presentation, or nothing. */
export type LangyPanelErrorPresentation = ReturnType<typeof explainLangyError>;

/** The card for a read that failed with nothing the registry could name. */
function unavailableCard({
  kind,
  title,
  description,
}: {
  kind: string;
  title: string;
  description: string;
}): LangyPanelErrorPresentation {
  return {
    kind,
    title,
    description,
    render: "card" as const,
    action: { label: "Try again", kind: "retry" as const },
  };
}

/** A failed read, in the registry's words when it names the failure. */
export function presentReadError({
  error,
  fallback,
}: {
  error: unknown;
  fallback: { kind: string; title: string; description: string };
}): LangyPanelErrorPresentation {
  const domain = readLangyTrpcError(error);
  return domain ? explainLangyError(domain) : unavailableCard(fallback);
}

const HISTORY_UNAVAILABLE = {
  kind: "langy_history_unavailable",
  title: "This conversation isn't loading",
  description: "Its messages can't be reached right now. You can still start a new chat.",
};

/**
 * The open conversation's own history failed to load. A not-found for a conversation this tab
 * just minted is the projection lagging the accepted create ("not yet", never an error) — but only
 * while the grace holds; confirmation arriving afterwards refetches past the suppressed read.
 */
export function useLangyHistoryError({
  activeConversationId,
  hasHistoryError,
  historyError,
  refetchHistory,
}: {
  activeConversationId: string | null;
  hasHistoryError: boolean;
  historyError: unknown;
  refetchHistory: () => void;
}) {
  const isUnconfirmed = useLangyStore((s) =>
    s.activeConversationId ? s.unconfirmedConversations[s.activeConversationId] === true : false,
  );
  const suppressedNotFoundRef = useRef(false);
  const [graceIsOver, setGraceIsOver] = useState(false);
  useEffect(() => {
    setGraceIsOver(false);
    if (!hasHistoryError || !isUnconfirmed) return;
    const timer = setTimeout(() => setGraceIsOver(true), LANGY_CONVERSATION_PENDING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [hasHistoryError, isUnconfirmed, activeConversationId]);

  const presentation = useMemo(() => {
    if (!hasHistoryError) return null;
    const code = readLangyTrpcError(historyError)?.code;
    if (isLangyConversationPending({ code, unconfirmed: isUnconfirmed, graceIsOver })) {
      suppressedNotFoundRef.current = true;
      return null;
    }
    return presentReadError({ error: historyError, fallback: HISTORY_UNAVAILABLE });
  }, [hasHistoryError, historyError, isUnconfirmed, graceIsOver]);

  useEffect(() => {
    if (isUnconfirmed || !suppressedNotFoundRef.current) return;
    suppressedNotFoundRef.current = false;
    refetchHistory();
  }, [isUnconfirmed, refetchHistory]);

  return { presentation, isUnconfirmed };
}

const CONVERSATIONS_UNAVAILABLE = {
  kind: "langy_conversations_unavailable",
  title: "Recent conversations aren't loading",
  description:
    "Chatting still works. Your past conversations will be back once they can be reached again.",
};

/**
 * A failed recents list surfaces INSIDE the panel as a dismissable card, never a toast.
 * Dismissal holds until the list recovers, so the card can't nag again for the same outage.
 */
export function useLangyListError({
  hasListError,
  listError,
}: {
  hasListError: boolean;
  listError: unknown;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!hasListError) setDismissed(false);
  }, [hasListError]);
  const presentation = useMemo(
    () =>
      hasListError && !dismissed
        ? presentReadError({ error: listError, fallback: CONVERSATIONS_UNAVAILABLE })
        : null,
    [hasListError, dismissed, listError],
  );
  return { presentation, dismiss: () => setDismissed(true) };
}
