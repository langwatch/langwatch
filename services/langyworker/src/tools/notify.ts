/**
 * `notify` asks the server to push a browser notification, within a limit so a model loop
 * cannot spam; `offer_notifications` asks, once per conversation, whether Langy may notify.
 * Spec: specs/langy/langy-notifications.feature
 */

import type { ExtensionAPI, InlineExtension, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const NOTIFY_TOOL_NAME = "notify";
export const OFFER_NOTIFICATIONS_TOOL_NAME = "offer_notifications";

/** The shortest gap between two notifications Langy sends on purpose. */
export const NOTIFY_MIN_GAP_MS = 60_000;

/** How many notifications Langy may send on purpose in one hour. */
export const NOTIFY_HOURLY_BUDGET = 5;

const HOUR_MS = 60 * 60_000;

/** Short enough to fit a system notification; the server cuts anything longer. */
export const NOTIFY_TITLE_MAX = 80;
export const NOTIFY_BODY_MAX = 240;

/**
 * What the model reads when the notification went out. The server pushes it only when the
 * person turned Langy notifications on, and their browser skips it on a screen showing this
 * conversation.
 */
export const NOTIFY_SENT =
  "Sent. It reaches the person's devices only when they turned Langy notifications on, and not on a screen already showing this conversation; say nothing about it in the reply.";

export const EMPTY_NOTIFY_PUSHBACK =
  "Nothing was sent: the title is empty. Call notify with a short title and a one-line body.";

export const OFFER_SHOWN =
  "The notifications card is shown. It carries its own question, so say nothing about notifications and go on with the step.";

export const OFFER_REPEATED_PUSHBACK =
  "Nothing was shown: notifications were already offered in this conversation. Go on with the step.";

/**
 * Whether one more notification may go out now, given when the earlier ones
 * went: a refusal line naming when the next one may go, or undefined.
 */
export function notifyRefusal({
  now,
  sentAt,
}: {
  now: number;
  sentAt: readonly number[];
}): string | undefined {
  const last = sentAt.length > 0 ? Math.max(...sentAt) : undefined;
  if (last !== undefined && now - last < NOTIFY_MIN_GAP_MS) {
    const seconds = Math.ceil((NOTIFY_MIN_GAP_MS - (now - last)) / 1000);
    return `Nothing was sent: a notification went out ${Math.round((now - last) / 1000)} seconds ago, and the next may go in ${seconds} seconds. Notify only when the work is done or the person is needed.`;
  }
  const lastHour = sentAt.filter((at) => now - at < HOUR_MS);
  if (lastHour.length >= NOTIFY_HOURLY_BUDGET) {
    const oldest = Math.min(...lastHour);
    const minutes = Math.ceil((HOUR_MS - (now - oldest)) / 60_000);
    return `Nothing was sent: ${NOTIFY_HOURLY_BUDGET} notifications went out in the last hour, which is the limit. The next may go in ${minutes} minutes.`;
  }
  return undefined;
}

const notifyParams = Type.Object({
  title: Type.String({
    description: `A short title, at most ${NOTIFY_TITLE_MAX} characters, such as "Your project is ready".`,
  }),
  body: Type.String({
    description: `One line saying what happened or what is needed, at most ${NOTIFY_BODY_MAX} characters.`,
  }),
});

const offerParams = Type.Object({});

/** The per-conversation memory the two tools share: a worker serves one conversation. */
export type NotifyLedger = {
  sentAt: number[];
  offered: boolean;
};

export function createNotifyLedger(): NotifyLedger {
  return { sentAt: [], offered: false };
}

/**
 * The ledger a resumed session already earned: every notification that went out and whether the
 * offer was made, read off the session's own tool results so a restart resets neither.
 */
export function notifyLedgerFromEntries(entries: readonly SessionEntry[]): NotifyLedger {
  const ledger = createNotifyLedger();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
    if (entry.message.isError) continue;
    if (entry.message.toolName === NOTIFY_TOOL_NAME) ledger.sentAt.push(entry.message.timestamp);
    if (entry.message.toolName === OFFER_NOTIFICATIONS_TOOL_NAME) ledger.offered = true;
  }
  return ledger;
}

export function createNotifyExtension({
  ledger = createNotifyLedger(),
  now = () => Date.now(),
}: {
  ledger?: NotifyLedger;
  now?: () => number;
} = {}): InlineExtension {
  return {
    name: "langy-notify",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: NOTIFY_TOOL_NAME,
        label: "Notify",
        description: `Send the person a browser notification, for a moment they would want to come back for: the long work they started is done ("Your project is ready"), or it cannot go on without them. The server pushes it to each of their devices, even with the tab closed, only when they turned notifications on; a device already showing this conversation skips it, so calling it costs nothing when they are watching. A newer notification for this conversation replaces the earlier one. Never for progress, a step inside the work, or a line the reply already says. At most one every ${NOTIFY_MIN_GAP_MS / 1000} seconds and ${NOTIFY_HOURLY_BUDGET} an hour; a call past that is refused and says when the next may go.`,
        parameters: notifyParams,
        async execute(_toolCallId, params) {
          const title = typeof params.title === "string" ? params.title : "";
          if (title.trim() === "") throw new Error(EMPTY_NOTIFY_PUSHBACK);
          const at = now();
          const refused = notifyRefusal({ now: at, sentAt: ledger.sentAt });
          if (refused !== undefined) throw new Error(refused);
          ledger.sentAt.push(at);
          return { content: [{ type: "text" as const, text: NOTIFY_SENT }], details: {} };
        },
      });
      pi.registerTool({
        name: OFFER_NOTIFICATIONS_TOOL_NAME,
        label: "Offer notifications",
        description:
          "Put up the card that asks whether you may notify the person when long work is done. It carries its own question and buttons and does not wait for the answer: the work goes on at once. Call it only where a skill says to; once per conversation.",
        parameters: offerParams,
        async execute() {
          if (ledger.offered) throw new Error(OFFER_REPEATED_PUSHBACK);
          ledger.offered = true;
          return { content: [{ type: "text" as const, text: OFFER_SHOWN }], details: {} };
        },
      });
    },
  };
}
