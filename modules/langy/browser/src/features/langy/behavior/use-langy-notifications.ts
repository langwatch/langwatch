/**
 * Langy's browser notifications: the person's choice (on the account), the
 * browser's permission, and the notifier that watches a conversation and sends
 * one when a long turn finishes, a card waits on the person, or Langy calls its
 * `notify` tool, only ever while they are away from the tab.
 * Spec: specs/langy/langy-notifications.feature
 */
import {
  isPageAway,
  showBrowserNotification,
  useBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "@langwatch/browser-host/browser-notifications";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { useLangyStore } from "@langwatch/langy-browser-kit";
import { useCallback, useEffect, useRef } from "react";

import { api } from "../../../behavior/langy-api.ts";
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

/** A key is any card that waits on the person: a pending permission, a question, a folder request. */
export type LangyDecisionKeys = readonly string[];

const IN_FLIGHT = new Set(["submitted", "streaming"]);

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
    const wasInFlight = IN_FLIGHT.has(previousStatus.current);
    const isInFlight = IN_FLIGHT.has(status);
    previousStatus.current = status;
    if (isInFlight && !wasInFlight) {
      turnStartedAt.current = now();
      return;
    }
    if (wasInFlight && !isInFlight && turnStartedAt.current !== null) {
      const durationMs = now() - turnStartedAt.current;
      turnStartedAt.current = null;
      if (status === "ready") send({ kind: "turn_finished", durationMs });
    }
  }, [status, now, send]);

  // `notify` calls: only one that lands while a turn is in flight here is news;
  // a hydrated history carries old calls that already had their moment.
  useEffect(() => {
    const live = IN_FLIGHT.has(status);
    for (const message of messages) {
      if (message.role === "user") continue;
      for (const part of message.parts ?? []) {
        const call = readNotifyCall(part);
        if (!call || seenNotifyCalls.current.has(call.callId)) continue;
        seenNotifyCalls.current.add(call.callId);
        if (live) send({ kind: "tool", title: call.title, body: call.body });
      }
    }
  }, [messages, status, send]);

  // Cards that wait on the person: the keys held when the conversation was
  // first read are the baseline, and only a key after that notifies.
  const baseline = useRef<{ conversationId: string | null; keys: Set<string> } | null>(null);
  useEffect(() => {
    if (!decisionKeysReady) return;
    if (baseline.current?.conversationId !== conversationId) {
      baseline.current = { conversationId, keys: new Set(decisionKeys) };
      return;
    }
    const known = baseline.current.keys;
    const fresh = decisionKeys.filter((key) => !known.has(key));
    for (const key of fresh) known.add(key);
    if (fresh.length > 0) send({ kind: "decision_needed" });
  }, [conversationId, decisionKeys, decisionKeysReady, send]);
}
