/**
 * What Langy tells a person, shared by the server's Web Push and the open tab's fallback:
 * which events are worth a notification, and their words.
 * Spec: specs/langy/langy-notifications.feature
 */
import { LANGY_CONVERSATION_PARAM } from "./langy.deep-link.ts";

/** The person's preference topic for Langy notifications. */
export const LANGY_NOTIFICATION_TOPIC = "langy";

/** A turn at least this long, finishing, is worth telling the person about. */
export const LANGY_LONG_TURN_MS = 60_000;

/** The worker's caps for `notify`, repeated so a malformed call cannot flood the screen. */
export const LANGY_NOTIFY_TITLE_MAX = 80;
export const LANGY_NOTIFY_BODY_MAX = 240;

/** One conversation's notifications share a tag, so a newer one replaces the older. */
export function langyNotificationTag(conversationId: string): string {
  return `langy:${conversationId}`;
}

/** Where a click on a conversation's notification goes, on this installation's origin. */
export function langyConversationPath({
  projectSlug,
  conversationId,
}: {
  projectSlug: string;
  conversationId: string;
}): string {
  const params = new URLSearchParams({ [LANGY_CONVERSATION_PARAM]: conversationId });
  return `/${encodeURIComponent(projectSlug)}?${params.toString()}`;
}

/** Cuts a line to `max` characters, ending on an ellipsis when it was cut. */
export function clipNotificationLine(text: string, max: number): string {
  const folded = text.trim().replace(/\s+/g, " ");
  return folded.length <= max ? folded : `${folded.slice(0, max - 1).trimEnd()}…`;
}

/** Something that happened in a conversation, before the rule decides whether it is sent. */
export type LangyNotificationEvent =
  | { kind: "turn_finished"; durationMs: number }
  | { kind: "decision_needed" }
  | { kind: "tool"; title: string; body: string };

export type LangyNotificationContent = { title: string; body: string };

/** Whether an event is worth a notification, and its words when it is. */
export type LangyNotificationOutcome =
  | ({ kind: "notify" } & LangyNotificationContent)
  | { kind: "skip" };

const SKIP: LangyNotificationOutcome = { kind: "skip" };

/** The words for an event; a turn has to have run long, and a `notify` call needs a title. */
export function langyNotificationContent({
  event,
  conversationTitle,
}: {
  event: LangyNotificationEvent;
  conversationTitle?: string | null;
}): LangyNotificationOutcome {
  const about = conversationTitle?.trim() ? conversationTitle.trim() : null;
  switch (event.kind) {
    case "turn_finished":
      if (event.durationMs < LANGY_LONG_TURN_MS) return SKIP;
      return {
        kind: "notify",
        title: "Langy finished",
        body: about ? `Done with "${about}".` : "Your answer is ready.",
      };
    case "decision_needed":
      return {
        kind: "notify",
        title: "Langy needs a decision",
        body: about ? `Waiting on you in "${about}".` : "Langy is waiting on your answer.",
      };
    case "tool": {
      const title = clipNotificationLine(event.title, LANGY_NOTIFY_TITLE_MAX);
      if (title === "") return SKIP;
      return {
        kind: "notify",
        title,
        body: clipNotificationLine(event.body, LANGY_NOTIFY_BODY_MAX),
      };
    }
  }
}
