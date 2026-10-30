/**
 * An insight's actions: the ids a filing mints, and the message a click sends Langy. Pure, so
 * a repeated request of the same click writes the same bytes and Langy dedupes it.
 * @see modules/insight/adrs/005-insight-actions.md
 */

import type { InsightAction, InsightActionInput, InsightEntry } from "@langwatch/insight-contract";
import { Temporal } from "@langwatch/time";

/** Ids by position, `a0`..`a3`: an action is named by where Langy put it on the card. */
export function mintInsightActions(actions: readonly InsightActionInput[]): InsightAction[] {
  return actions.map(({ label, prompt }, position) => ({ id: `a${position}`, label, prompt }));
}

/** The idempotency key Langy dedupes one click by. */
export function insightActionIdempotencyKey({
  insightId,
  actionId,
  clickId,
}: {
  insightId: string;
  actionId: string;
  clickId: string;
}): string {
  return `insight-action:${insightId}:${actionId}:${clickId}`;
}

type ActionInsight = Pick<InsightEntry, "title" | "body" | "lwql" | "replay">;

/** What a new conversation is told first, when the one the insight came from is gone. */
function seedOf({ title, body, lwql, replay }: ActionInsight): string {
  const lines = [`This conversation starts from the insight "${title}":`, "", body];
  if (lwql !== null) lines.push("", `Its query: ${lwql}`);
  if (replay !== null) {
    const start = Temporal.Instant.fromEpochMilliseconds(replay.start).toString();
    const end = Temporal.Instant.fromEpochMilliseconds(replay.end).toString();
    lines.push(`Its window: from ${start} to ${end}`);
  }
  return lines.join("\n");
}

/**
 * The message a click sends: a fixed framing line, then the stored prompt word for word. A
 * seeded conversation starts with the insight itself, since it holds none of the source's turns.
 */
export function insightActionMessage({
  insight,
  prompt,
  isSeeded,
}: {
  insight: ActionInsight;
  prompt: string;
  isSeeded: boolean;
}): string {
  const framed = `You clicked this action on the insight "${insight.title}":\n\n${prompt}`;
  return isSeeded ? `${seedOf(insight)}\n\n${framed}` : framed;
}
