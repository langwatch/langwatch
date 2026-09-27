/**
 * Langy's notification rules, pure: which tool parts are the notification
 * tools, what a turn or a card turns into, and whether anything is sent at all.
 * The browser capability shows the notification; this module decides.
 * Spec: specs/langy/langy-notifications.feature
 */
import type { BrowserNotificationPermission } from "@langwatch/browser-host/browser-notifications";

export const LANGY_NOTIFY_TOOL_NAME = "notify";
export const LANGY_OFFER_NOTIFICATIONS_TOOL_NAME = "offer_notifications";

/** A turn at least this long, finishing while the person is away, is worth telling them about. */
export const LANGY_LONG_TURN_MS = 60_000;

/** The worker's caps, repeated here so a malformed call cannot fill the notification centre. */
export const LANGY_NOTIFY_TITLE_MAX = 80;
export const LANGY_NOTIFY_BODY_MAX = 240;

/** The tag every Langy notification of one conversation shares, so a newer one replaces the older. */
export function langyNotificationTag(conversationId: string): string {
  return `langy:${conversationId}`;
}

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

/** Cuts a line to `max` characters, ending on an ellipsis when it was cut. */
export function clipNotificationLine(text: string, max: number): string {
  const folded = text.trim().replace(/\s+/g, " ");
  return folded.length <= max ? folded : `${folded.slice(0, max - 1).trimEnd()}…`;
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

/** Something that happened in a conversation, before the rule decides whether it is sent. */
export type LangyNotificationEvent =
  | { kind: "turn_finished"; durationMs: number }
  | { kind: "decision_needed" }
  | { kind: "tool"; title: string; body: string };

export type LangyNotificationContent = { title: string; body: string };

/**
 * Whether an event becomes a notification, and its words. Nothing is sent
 * unless the person turned Langy notifications on, the browser allows them,
 * and the person is away from the tab; a finished turn also has to have run long.
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
  const about = conversationTitle?.trim() ? conversationTitle.trim() : null;
  switch (event.kind) {
    case "turn_finished":
      if (event.durationMs < LANGY_LONG_TURN_MS) return null;
      return {
        title: "Langy finished",
        body: about ? `Done with "${about}".` : "Your answer is ready.",
      };
    case "decision_needed":
      return {
        title: "Langy needs a decision",
        body: about ? `Waiting on you in "${about}".` : "Langy is waiting on your answer.",
      };
    case "tool":
      return { title: event.title, body: event.body };
  }
}
