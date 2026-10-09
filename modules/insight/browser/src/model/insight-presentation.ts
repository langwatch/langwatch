/**
 * How an insight reads on screen: the written verdict, the date line, the validity line and
 * the markdown-lite body. Pure, so the page, the bell and the sidebar print the same words.
 */

import {
  type InsightEntry,
  type InsightFolder,
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

/** The line under the title: done, expired, renewed, or how long it stays true. */
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
    return { text: `Renewed · still true through ${format(expiry, "MMM d")}`, tone: "ok" };
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
