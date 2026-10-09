/**
 * How an insight reads on screen: the written verdict, the date line, the validity line and
 * the markdown-lite body. Pure, so the page, the bell and the sidebar print the same words.
 */

import {
  type InsightEntry,
  type InsightFiledVia,
  type InsightFolder,
  type InsightReplay,
  type InsightTone,
  insightEffectiveAt,
  insightExpiresAt,
} from "@langwatch/insight-contract";
import { differenceInCalendarDays, format } from "@langwatch/time";

/** The verdict, written out: why you should care, not a colour to decode. */
export const TONE_PRESENTATION: Record<InsightTone, { label: string; color: string }> = {
  bad: { label: "Warning", color: "red.solid" },
  watch: { label: "Worth a look", color: "yellow.solid" },
  good: { label: "Good news", color: "green.solid" },
};

/** How it was filed, in words. Says nothing of who else sees it. */
export const FILED_VIA_WORDS: Record<InsightFiledVia, string> = {
  chat: "Saved from a chat with Langy",
  run: "Daily run",
};

/** "Jul 5 to Aug 3", or the one day; the window is half-open, so its last day holds `end - 1`. */
function replayDays({ start, end }: Pick<InsightReplay, "start" | "end">): string {
  const first = format(start, "MMM d");
  const last = format(end - 1, "MMM d");
  return first === last ? first : `${first} to ${last}`;
}

/** The line under the evidence chart: the fixed dates, then every value that was in force. */
export function replayCaption({
  replay,
  fromBoard,
}: {
  replay: InsightReplay;
  /** A window kept from a board says so; one kept from elsewhere names only its values. */
  fromBoard: boolean;
}): string {
  const values = Object.entries(replay.parameters).map(([name, value]) => `${name}: ${value}`);
  const words = [replayDays(replay), ...(replay.period ? [replay.period] : []), ...values];
  const replayed = `Replayed with: ${words.join(" · ")}.`;
  return fromBoard ? `${replayed} The board as it was set when Langy filed this.` : replayed;
}

/** "Today · 07:00", "Yesterday · 07:00", or "Oct 3 · 07:00". */
export function insightWhen({ entry, now }: { entry: InsightEntry; now: number }): string {
  const at = insightEffectiveAt(entry);
  return `${dayLabel({ at, now })} · ${format(at, "HH:mm")}`;
}

function dayLabel({ at, now }: { at: number; now: number }): string {
  const days = differenceInCalendarDays(now, at);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return format(at, "MMM d");
}

/** The short day an inbox one-liner shows. */
export function insightDay(entry: InsightEntry): string {
  return format(insightEffectiveAt(entry), "MMM d");
}

export type ValidityLine = { text: string; tone: "muted" | "warn" | "ok" };

/** "today", or the short day a later run found the insight still true. */
function seenAgainDay({ at, now }: { at: number; now: number }): string {
  return differenceInCalendarDays(now, at) === 0 ? "today" : format(at, "MMM d");
}

/** The line under the title: done, expired, kept, seen again, or how long it stays true. */
export function insightValidity({
  entry,
  folder,
  now,
}: {
  entry: InsightEntry;
  folder: InsightFolder;
  now: number;
}): ValidityLine {
  const expiry = insightExpiresAt(entry);
  if (folder === "archived") return { text: "Done", tone: "muted" };
  if (folder === "stale") return { text: `Expired ${format(expiry, "MMM d")}`, tone: "warn" };
  if (entry.keptAt !== null) return { text: "Kept as still relevant", tone: "ok" };
  if (entry.renewedAt !== null) {
    const seenAgain = seenAgainDay({ at: entry.renewedAt, now });
    return {
      text: `Seen again ${seenAgain} · still true through ${format(expiry, "MMM d")}`,
      tone: "ok",
    };
  }
  const daysLeft = differenceInCalendarDays(expiry, now);
  const through = `Valid through ${format(expiry, "MMM d")}`;
  return daysLeft <= 3
    ? { text: `${through} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`, tone: "warn" }
    : { text: through, tone: "muted" };
}

export type InsightBodyBlock = { kind: "header" | "paragraph"; text: string };

/** Paragraphs split on blank lines; a paragraph that is only `**Header**` is a section header. */
export function insightBodyBlocks(body: string): InsightBodyBlock[] {
  return body
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const header = /^\*\*(.+)\*\*$/.exec(block);
      return header?.[1] ? { kind: "header", text: header[1] } : { kind: "paragraph", text: block };
    });
}

/** The first line of an answer, cut to a title's length, as the dialog's starting title. */
export function titleFromAnswer(answer: string): string {
  const firstLine =
    answer
      .split("\n")
      .map((line) =>
        line
          .replace(/^[#>*\-\s]+/, "")
          .replace(/\*\*/g, "")
          .trim(),
      )
      .find((line) => line.length > 0) ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 117).trimEnd()}...` : firstLine;
}
