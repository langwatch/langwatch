/**
 * This browser's side of Langy's Web Push: subscribing while notifications are on, forgetting
 * when off, and answering the service worker for Langy's tags.
 * Spec: specs/langy/langy-notifications.feature
 */
import {
  isPageAway,
  useBrowserNotificationPermission,
} from "@langwatch/browser-host/browser-notifications";
import {
  checkWebPushSupport,
  ensureWebPushSubscription,
  listenToWebPushWorker,
  removeWebPushSubscription,
} from "@langwatch/browser-host/web-push";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { LANGY_NOTIFICATION_TOPIC } from "@langwatch/langy-contract";
import { useCallback, useEffect, useRef } from "react";

import { api } from "../../../behavior/langy-api.ts";
import { useLangyStore } from "../../../behavior/langy.store.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";

const TAG_PREFIX = "langy:";

/** The conversation a Langy tag names, or null for another feature's tag. */
export function langyConversationOfTag(tag: string): string | null {
  return tag.startsWith(TAG_PREFIX) && tag.length > TAG_PREFIX.length
    ? tag.slice(TAG_PREFIX.length)
    : null;
}

/** The project slug a notification link opens, the first segment of its path. */
export function projectSlugOfLink(url: string): string | null {
  try {
    const [first] = new URL(url, "https://link.invalid").pathname.split("/").filter(Boolean);
    return first ? decodeURIComponent(first) : null;
  } catch {
    return null;
  }
}

/** Subscribing and forgetting this browser, for the choice's enable and turn-off. */
export function useLangyPushDevice(): {
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
} {
  const utils = api.useUtils();
  const save = api.notification.subscribeWebPush.useMutation();
  const forget = api.notification.unsubscribeWebPush.useMutation();

  const subscribe = useCallback(async () => {
    if (!checkWebPushSupport()) return false;
    const publicKey = await utils.notification.webPushPublicKey
      .fetch({})
      .then(({ publicKey: key }) => key)
      .catch(() => null);
    // Without the key the browser's own subscription, if any, still stands: the device keeps
    // whatever standing it had, so a blip never turns the tab into a second sender.
    if (!publicKey) return false;
    const subscription = await ensureWebPushSubscription(publicKey);
    if (!subscription) return false;
    try {
      await save.mutateAsync({ ...subscription, userAgent: navigator.userAgent.slice(0, 512) });
      return true;
    } catch (error) {
      // A push service the server never sends to: drop the subscription so this device falls
      // back to the tab. Any other failure leaves it subscribed and the next page load stores
      // it again; the tab stays quiet rather than risk a second notification.
      if (readHandledError(error)?.code === "web_push_endpoint_refused") {
        await removeWebPushSubscription({ unusable: true });
      }
      return false;
    }
  }, [utils, save]);

  const unsubscribe = useCallback(async () => {
    const endpoint = await removeWebPushSubscription();
    if (endpoint) await forget.mutateAsync({ endpoint }).catch(() => undefined);
  }, [forget]);

  return { subscribe, unsubscribe };
}

/**
 * Mounted once per project page: keeps this browser subscribed while Langy notifications
 * are on and allowed, and answers the service worker for Langy's tags.
 */
export function useLangyWebPush(): void {
  const { permission } = useBrowserNotificationPermission();
  const preference = api.user.getNotificationPreference.useQuery(
    { topic: LANGY_NOTIFICATION_TOPIC },
    { staleTime: 60_000, retry: false },
  );
  const { subscribe } = useLangyPushDevice();
  const subscribeLatest = useRef(subscribe);
  subscribeLatest.current = subscribe;
  const active = preference.data?.choice === "enabled" && permission === "granted";

  // Re-stored on every page load: the endpoint can rotate, and a browser that changed
  // hands moves to whoever turned notifications on in it.
  useEffect(() => {
    if (active) void subscribeLatest.current();
  }, [active]);

  const utils = api.useUtils();
  const { project } = useOrganizationTeamProject();
  const projectSlug = project?.slug ?? null;

  useEffect(
    () =>
      listenToWebPushWorker({
        shows: (tag) => {
          const conversationId = langyConversationOfTag(tag);
          if (!conversationId || isPageAway()) return false;
          const state = useLangyStore.getState();
          return state.isOpen && state.activeConversationId === conversationId;
        },
        open: ({ tag, url }) => {
          const conversationId = langyConversationOfTag(tag);
          if (!conversationId || !projectSlug || projectSlugOfLink(url) !== projectSlug) {
            return false;
          }
          const store = useLangyStore.getState();
          store.openPanel();
          store.selectConversation(conversationId);
          void utils.langy.messages.invalidate();
          return true;
        },
      }),
    [projectSlug, utils],
  );
}
