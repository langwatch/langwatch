/**
 * Langy's notification rules, pure: which tool parts are the notification tools, what a
 * turn or a card turns into, and whether anything is sent at all.
 * Spec: specs/langy/langy-notifications.feature
 */
import type { BrowserNotificationPermission } from "@langwatch/browser-host/browser-notifications";
import {
  clipNotificationLine,
  LANGY_NOTIFY_BODY_MAX,
  LANGY_NOTIFY_TITLE_MAX,
  langyNotificationContent,
  type LangyNotificationContent,
  type LangyNotificationEvent,
} from "@langwatch/langy-contract";

export {
  clipNotificationLine,
  LANGY_LONG_TURN_MS,
  LANGY_NOTIFY_BODY_MAX,
  LANGY_NOTIFY_TITLE_MAX,
  langyNotificationTag,
  type LangyNotificationContent,
  type LangyNotificationEvent,
} from "@langwatch/langy-contract";

export const LANGY_NOTIFY_TOOL_NAME = "notify";
export const LANGY_OFFER_NOTIFICATIONS_TOOL_NAME = "offer_notifications";

interface ToolPartLike {
  type?: string;
  toolName?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
}

function isToolPartNamed(part: unknown, name: string): boolean {
  const p = part as ToolPartLike | null;
  if (p?.type === `tool-${name}`) return true;
  return p?.type === "dynamic-tool" && p.toolName === name;
}

/** Is this part Langy's `notify` tool call? */
export function isNotifyToolPart(part: unknown): boolean {
  return isToolPartNamed(part, LANGY_NOTIFY_TOOL_NAME);
}

/** Is this part Langy's `offer_notifications` tool call? */
export function isOfferNotificationsToolPart(part: unknown): boolean {
  return isToolPartNamed(part, LANGY_OFFER_NOTIFICATIONS_TOOL_NAME);
}

/** Either notification tool: neither is shown as an activity row. */
export function isNotificationToolPart(part: unknown): boolean {
  return isNotifyToolPart(part) || isOfferNotificationsToolPart(part);
}

/**
 * The id of the `offer_notifications` call that put the card up, or null. Only
 * a call the worker answered counts: a refused one (a second offer) showed nothing.
 */
export function offerNotificationsCallId(parts: readonly unknown[]): string | null {
  for (const part of parts) {
    if (!isOfferNotificationsToolPart(part)) continue;
    const p = part as ToolPartLike;
    if (p.state !== "output-available") continue;
    return p.toolCallId ?? LANGY_OFFER_NOTIFICATIONS_TOOL_NAME;
  }
  return null;
}

export type LangyNotifyCall = { callId: string; title: string; body: string };

/**
 * A `notify` call the worker let through, with its title and body cut to size,
 * or null. A refused call (`output-error`) sent nothing.
 */
export function readNotifyCall(part: unknown): LangyNotifyCall | null {
  if (!isNotifyToolPart(part)) return null;
  const p = part as ToolPartLike;
  if (p.state !== "output-available" || !p.toolCallId) return null;
  const input = (p.input ?? {}) as { title?: unknown; body?: unknown };
  if (typeof input.title !== "string" || input.title.trim() === "") return null;
  return {
    callId: p.toolCallId,
    title: clipNotificationLine(input.title, LANGY_NOTIFY_TITLE_MAX),
    body: clipNotificationLine(
      typeof input.body === "string" ? input.body : "",
      LANGY_NOTIFY_BODY_MAX,
    ),
  };
}

/**
 * The open tab's notification for an event, only when it is on, allowed and the person is away.
 * The words and the long-turn rule are langy-contract's, shared with the server's Web Push.
 */
export function langyNotificationFor({
  event,
  enabled,
  permission,
  away,
  conversationTitle,
}: {
  event: LangyNotificationEvent;
  enabled: boolean;
  permission: BrowserNotificationPermission;
  away: boolean;
  conversationTitle?: string | null;
}): LangyNotificationContent | null {
  if (!enabled || permission !== "granted" || !away) return null;
  const outcome = langyNotificationContent({ event, conversationTitle });
  return outcome.kind === "notify" ? { title: outcome.title, body: outcome.body } : null;
}

/** This browser's push standing, as browser-host's Web Push reports it. */
export type LangyPushDeviceState = "unknown" | "subscribed" | "unsubscribed" | "unavailable";

/**
 * Whether the open tab notifies at all: notifications on, and this browser `unavailable` for
 * push. Subscribed or not yet checked leaves it to the server, even when a send fails.
 */
export function langyTabNotifies({
  choice,
  pushDevice,
}: {
  choice: "enabled" | "declined" | null;
  pushDevice: LangyPushDeviceState;
}): boolean {
  return choice === "enabled" && pushDevice === "unavailable";
}

/** Why this browser could not be set up for Web Push. */
export type LangyPushSetupFailure =
  | "unsupported"
  | "server_unreachable"
  | "browser_refused"
  | "save_failed"
  | "push_service_refused";

const TAB_ONLY = "Langy will only notify you while this tab stays open.";

const PUSH_SETUP_PROBLEMS: Record<LangyPushSetupFailure, { line: string; retryable: boolean }> = {
  unsupported: {
    line: `This browser can't get notifications once the tab is closed. ${TAB_ONLY}`,
    retryable: false,
  },
  server_unreachable: {
    line: "Notifications are on, but this browser couldn't reach LangWatch to finish setting them up, so they may not arrive. Check your connection and try again.",
    retryable: true,
  },
  browser_refused: {
    line: `Your browser wouldn't sign up for notifications. Private windows and strict privacy settings do this. ${TAB_ONLY} Try again from a normal window.`,
    retryable: true,
  },
  save_failed: {
    line: "Notifications are on, but LangWatch couldn't save this browser for them, so they may not arrive. Try again in a moment.",
    retryable: true,
  },
  push_service_refused: {
    line: `LangWatch can't send to this browser's notification service. ${TAB_ONLY}`,
    retryable: false,
  },
};

/** What to tell the person about a failed setup, and whether trying again can help. */
export function langyPushSetupProblem(failure: LangyPushSetupFailure): {
  line: string;
  retryable: boolean;
} {
  return PUSH_SETUP_PROBLEMS[failure];
}
