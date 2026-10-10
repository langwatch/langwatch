/**
 * Checks the answer of a daily run. The answer is untrusted: Langy wrote it after reading
 * customer trace text, which may carry instructions. Nothing is taken from it but the words
 * of each finding; one fault refuses the whole answer, so nothing is filed in part.
 */

import {
  INSIGHT_RUN_FINDINGS_FENCE_TAG,
  type InsightRunFinding,
  insightRunFindingsSchema,
} from "@langwatch/insight-contract";

import { EXAMPLE_FINDING } from "./insight-daily-run-brief.rules.ts";

/** An answer longer than this is refused unread; a real one is a few kilobytes. */
const MAX_ANSWER_LENGTH = 400_000;

const OPENING_FENCE = new RegExp(`^ {0,3}\`{3,}[ \\t]*${INSIGHT_RUN_FINDINGS_FENCE_TAG}[ \\t]*$`);
const CLOSING_FENCE = /^ {0,3}`{3,}[ \t]*$/;

/** One finding as the run files it: its words, and a widget only when the board has it. */
export type CheckedFinding = Readonly<
  Omit<InsightRunFinding, "widgetId" | "topic" | "lwql"> & {
    topic: string | null;
    lwql: string | null;
    widget: { id: string; name: string } | null;
  }
>;

type RunAnswerCheck = Readonly<{ ok: true; findings: CheckedFinding[] }> | Readonly<{ ok: false }>;

const REFUSED: RunAnswerCheck = { ok: false };

/** The content of the answer's one findings block; undefined for none, several or an open one. */
function findingsBlockOf(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const openings = lines.flatMap((line, index) => (OPENING_FENCE.test(line) ? [index] : []));
  const [opening] = openings;
  if (opening === undefined || openings.length !== 1) return void 0;
  const closing = lines.findIndex((line, index) => index > opening && CLOSING_FENCE.test(line));
  if (closing === -1) return void 0;
  return lines.slice(opening + 1, closing).join("\n");
}

function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}

export function checkRunAnswer({
  text,
  maxInsights,
  widgets,
}: {
  text: string;
  maxInsights: number;
  /** The widgets on the board as the run read it; the answer names none into being. */
  widgets: readonly { id: string; name: string }[];
}): RunAnswerCheck {
  if (text.length > MAX_ANSWER_LENGTH) return REFUSED;
  const block = findingsBlockOf(text);
  if (block === undefined) return REFUSED;
  const parsed = insightRunFindingsSchema.safeParse(parsedJson(block));
  if (!parsed.success) return REFUSED;
  // The brief's own example, handed back: the answer copied the brief and found nothing.
  if (parsed.data.findings.some(({ title }) => title === EXAMPLE_FINDING.title)) return REFUSED;

  const findings = parsed.data.findings
    .slice(0, maxInsights)
    .map(({ widgetId, topic, lwql, ...words }) => {
      const widget = widgets.find((candidate) => candidate.id === widgetId);
      return {
        ...words,
        topic: topic ?? null,
        lwql: lwql ?? null,
        widget: widget ? { id: widget.id, name: widget.name } : null,
      };
    });
  return { ok: true, findings };
}
