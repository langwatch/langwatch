/**
 * Langy's browser notifications: the person's choice (on the account), the browser's
 * permission, and the notifier that sends one for a long turn, a waiting card or a `notify`
 * call, only while the person is away. Spec: specs/langy/langy-notifications.feature
 */
import {
  isPageAway,
  showBrowserNotification,
  useBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "@langwatch/browser-host/browser-notifications";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { useCallback, useEffect, useRef } from "react";

import { api } from "../../../behavior/langy-api.ts";
import { useLangyStore } from "../../../behavior/langy.store.ts";
import {
  langyNotificationFor,
  langyNotificationTag,
  readNotifyCall,
  type LangyNotificationEvent,
} from "../../../model/langy-notifications.ts";

export type LangyNotificationChoice = "enabled" | "declined" | null;

export type LangyNotificationPreferenceState = {
  /** The person's answer, or null while they never gave one. */
  choice: LangyNotificationChoice;
  /** The answer has not been read yet: a card must not offer what may already be answered. */
  isLoading: boolean;
  permission: BrowserNotificationPermission;
  /** Notifications will actually be shown: turned on, and the browser allows them. */
  active: boolean;
  isSaving: boolean;
  /**
   * Asks the browser, then turns Langy notifications on when it allows them.
   * Answers the browser's permission so a caller can say what happened.
   */
  enable: () => Promise<BrowserNotificationPermission>;
  /** Records "no" without asking the browser anything. */
  decline: () => Promise<void>;
};

const TOPIC = "langy" as const;

export function useLangyNotificationPreference(): LangyNotificationPreferenceState {
  const { permission, request } = useBrowserNotificationPermission();
  const utils = api.useUtils();
  const preference = api.user.getNotificationPreference.useQuery(
    { topic: TOPIC },
    { staleTime: 60_000, retry: false },
  );
  const save = api.user.setNotificationPreference.useMutation({
    onSuccess: (data) => utils.user.getNotificationPreference.setData({ topic: TOPIC }, data),
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Could not save the notification choice" }),
  });

  const choice = preference.data?.choice ?? null;
  const enable = useCallback(async () => {
    // Asked first, inside the click, since browsers only prompt from one.
    const answer = await request();
    if (answer === "granted") {
      await save.mutateAsync({ topic: TOPIC, choice: "enabled" });
    }
    return answer;
  }, [request, save]);
  const decline = useCallback(async () => {
    await save.mutateAsync({ topic: TOPIC, choice: "declined" });
  }, [save]);

  return {
    choice,
    isLoading: preference.isLoading,
    permission,
    active: choice === "enabled" && permission === "granted",
    isSaving: save.isPending,
    enable,
    decline,
  };
}

/** A key per card that waits on the person: a pending permission, a question, a folder request. */
export type LangyDecisionKeys = readonly string[];

const IN_FLIGHT = new Set(["submitted", "streaming"]);

/** Where the turn clock stands after a status change, and a finished turn's length. */
function advanceTurnClock({
  previousStatus,
  status,
  startedAt,
  now,
}: {
  previousStatus: string;
  status: string;
  startedAt: number | null;
  now: number;
}): { startedAt: number | null; finishedMs: number | null } {
  const wasInFlight = IN_FLIGHT.has(previousStatus);
  const isInFlight = IN_FLIGHT.has(status);
  if (isInFlight && !wasInFlight) return { startedAt: now, finishedMs: null };
  if (!wasInFlight || isInFlight || startedAt === null) return { startedAt, finishedMs: null };
  return { startedAt: null, finishedMs: status === "ready" ? now - startedAt : null };
}

/**
 * The waiting cards are known once both of their reads answered: the folder state and the
 * conversation record. A baseline taken before the record lands would call old cards new.
 */
export function langyDecisionKeysReady({
  workspaceFetched,
  recordFetched,
}: {
  workspaceFetched: boolean;
  recordFetched: boolean;
}): boolean {
  return workspaceFetched && recordFetched;
}

type DecisionBaseline = { conversationId: string | null; keys: Set<string> };

/** Whether a key arrived after the conversation's baseline; a new conversation resets it. */
function takeNewDecision({
  baseline,
  conversationId,
  decisionKeys,
}: {
  baseline: DecisionBaseline | null;
  conversationId: string | null;
  decisionKeys: LangyDecisionKeys;
}): { baseline: DecisionBaseline; isNew: boolean } {
  if (baseline?.conversationId !== conversationId) {
    return { baseline: { conversationId, keys: new Set(decisionKeys) }, isNew: false };
  }
  const fresh = decisionKeys.filter((key) => !baseline.keys.has(key));
  for (const key of fresh) baseline.keys.add(key);
  return { baseline, isNew: fresh.length > 0 };
}

type NotifyCall = NonNullable<ReturnType<typeof readNotifyCall>>;

/** The `notify` calls in these messages not seen before; marks them seen. */
function takeUnseenNotifyCalls({
  messages,
  seen,
}: {
  messages: readonly { role?: string; parts?: readonly unknown[] }[];
  seen: Set<string>;
}): NotifyCall[] {
  const calls: NotifyCall[] = [];
  for (const message of messages) {
    if (message.role === "user") continue;
    for (const part of message.parts ?? []) {
      const call = readNotifyCall(part);
      if (!call || seen.has(call.callId)) continue;
      seen.add(call.callId);
      calls.push(call);
    }
  }
  return calls;
}

/**
 * Watches one conversation and sends the notifications the rule allows. What
 * the conversation already held when it was opened never notifies: a
 * reload is not news.
 */
export function useLangyNotifier({
  conversationId,
  conversationTitle,
  status,
  messages,
  decisionKeys,
  decisionKeysReady,
  enabled,
  permission,
  now = Date.now,
}: {
  conversationId: string | null;
  conversationTitle?: string | null;
  status: string;
  messages: readonly { role?: string; parts?: readonly unknown[] }[];
  decisionKeys: LangyDecisionKeys;
  /** The source of the keys has answered once for this conversation. */
  decisionKeysReady: boolean;
  enabled: boolean;
  permission: BrowserNotificationPermission;
  now?: () => number;
}): void {
  const send = useCallback(
    (event: LangyNotificationEvent) => {
      if (!conversationId) return;
      const content = langyNotificationFor({
        event,
        enabled,
        permission,
        away: isPageAway(),
        conversationTitle,
      });
      if (!content) return;
      showBrowserNotification({
        ...content,
        tag: langyNotificationTag(conversationId),
        onClick: () => {
          useLangyStore.getState().openPanel();
          useLangyStore.getState().selectConversation(conversationId);
        },
      });
    },
    [conversationId, conversationTitle, enabled, permission],
  );

  // A turn's length is measured from the moment this tab saw it in flight.
  const turnStartedAt = useRef<number | null>(null);
  const previousStatus = useRef(status);
  const seenNotifyCalls = useRef(new Set<string>());

  // Opening another conversation forgets the last one's calls and turn.
  useEffect(() => {
    seenNotifyCalls.current = new Set();
    turnStartedAt.current = null;
  }, [conversationId]);

  useEffect(() => {
    const clock = advanceTurnClock({
      previousStatus: previousStatus.current,
      status,
      startedAt: turnStartedAt.current,
      now: now(),
    });
    previousStatus.current = status;
    turnStartedAt.current = clock.startedAt;
    if (clock.finishedMs !== null) send({ kind: "turn_finished", durationMs: clock.finishedMs });
  }, [status, now, send]);

  // `notify` calls: only one that lands while a turn is in flight here is news;
  // a hydrated history carries old calls that already had their moment.
  useEffect(() => {
    const calls = takeUnseenNotifyCalls({ messages, seen: seenNotifyCalls.current });
    if (!IN_FLIGHT.has(status)) return;
    for (const call of calls) send({ kind: "tool", title: call.title, body: call.body });
  }, [messages, status, send]);

  // Cards that wait on the person: the keys held when the conversation was
  // first read are the baseline, and only a key after that notifies.
  const baseline = useRef<DecisionBaseline | null>(null);
  useEffect(() => {
    if (!decisionKeysReady) return;
    const next = takeNewDecision({ baseline: baseline.current, conversationId, decisionKeys });
    baseline.current = next.baseline;
    if (next.isNew) send({ kind: "decision_needed" });
  }, [conversationId, decisionKeys, decisionKeysReady, send]);
}
