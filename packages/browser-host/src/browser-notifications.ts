/**
 * Browser notifications, for any feature that sends them: the permission the
 * browser holds, asking for it, whether the person is away from the tab, and
 * showing one whose click brings the tab forward. A feature keeps its own
 * rules for when to notify and the person's own choice; this module only
 * speaks to the browser.
 * Spec: specs/langy/langy-notifications.feature
 */
import { useCallback, useEffect, useState } from "react";

/**
 * The browser's answer. `default` means it was never asked; `unsupported`
 * means this browser has no notifications at all (or not in this context,
 * such as an insecure origin).
 */
export type BrowserNotificationPermission = "granted" | "denied" | "default" | "unsupported";

function notificationApi(): typeof Notification | undefined {
  return typeof globalThis.Notification === "function" ? globalThis.Notification : undefined;
}

/** What the browser answers right now, without asking. */
export function readBrowserNotificationPermission(): BrowserNotificationPermission {
  const api = notificationApi();
  if (!api) return "unsupported";
  const permission = api.permission;
  return permission === "granted" || permission === "denied" ? permission : "default";
}

/**
 * Asks the browser. It only shows its prompt while the permission is
 * `default` and the call comes from a click; otherwise it answers what it
 * already holds.
 */
export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  const api = notificationApi();
  if (!api) return "unsupported";
  try {
    const answer = await api.requestPermission();
    return answer === "granted" || answer === "denied" ? answer : "default";
  } catch {
    return readBrowserNotificationPermission();
  }
}

/** The person is away: the tab is hidden, or the window does not have focus. */
export function isPageAway(): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState === "hidden") return true;
  return typeof document.hasFocus === "function" ? !document.hasFocus() : false;
}

export type BrowserNotificationInput = {
  title: string;
  body?: string;
  /** A notification with the same tag replaces the earlier one instead of stacking. */
  tag?: string;
  /** Runs after the tab is brought forward, for the feature to open what the notification names. */
  onClick?: () => void;
};

/**
 * Shows a notification when the browser allows it. Clicking it focuses the
 * tab, closes it and runs `onClick`. Answers whether one was shown.
 */
export function showBrowserNotification({
  title,
  body,
  tag,
  onClick,
}: BrowserNotificationInput): boolean {
  const api = notificationApi();
  if (!api || readBrowserNotificationPermission() !== "granted") return false;
  try {
    const notification = new api(title, { body, tag });
    notification.onclick = () => {
      globalThis.focus?.();
      notification.close();
      onClick?.();
    };
    return true;
  } catch {
    // Some browsers only allow notifications from a service worker; there is
    // nothing the person can do about that from here.
    return false;
  }
}

/**
 * The permission as React state, kept current when the person changes it in
 * the browser's own site settings, plus the call that asks for it.
 */
export function useBrowserNotificationPermission(): {
  permission: BrowserNotificationPermission;
  request: () => Promise<BrowserNotificationPermission>;
} {
  const [permission, setPermission] = useState(readBrowserNotificationPermission);

  useEffect(() => {
    let status: PermissionStatus | undefined;
    let cancelled = false;
    const refresh = () => setPermission(readBrowserNotificationPermission());
    const query = globalThis.navigator?.permissions?.query;
    if (typeof query === "function") {
      query
        .call(globalThis.navigator.permissions, { name: "notifications" as PermissionName })
        .then((result) => {
          if (cancelled) return;
          status = result;
          status.addEventListener("change", refresh);
        })
        .catch(() => undefined);
    }
    // A browser without the permissions query still reports a change made in
    // its settings once the person comes back to the tab.
    globalThis.addEventListener?.("focus", refresh);
    return () => {
      cancelled = true;
      status?.removeEventListener("change", refresh);
      globalThis.removeEventListener?.("focus", refresh);
    };
  }, []);

  const request = useCallback(async () => {
    const answer = await requestBrowserNotificationPermission();
    setPermission(answer);
    return answer;
  }, []);

  return { permission, request };
}
