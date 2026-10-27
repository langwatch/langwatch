/**
 * Checks the answer of a daily run. The answer is untrusted: Langy wrote it after reading
 * customer trace text, which may carry instructions. Nothing is taken from it but the words
 * of each finding; one fault refuses the whole answer, so nothing is filed in part.
 * @see modules/insight/adrs/004-daily-run.md
 */

import { LWQL_PERIOD_GRANULARITY_PARAMETER } from "@langwatch/analytics-contract";
import {
  INSIGHT_RUN_FINDINGS_FENCE_TAG,
  type InsightRunFailureReason,
  type InsightRunFinding,
  insightRunFindingsSchema,
} from "@langwatch/insight-contract";
import { type LangyInsightsCardFinding, langyInsightsCardPartsOf } from "@langwatch/langy-contract";

import { DAILY_RUN_GRANULARITY_SECONDS } from "./insight-daily-run.rules.ts";
import { WEB_ADDRESS } from "./web-address.rules.ts";

/**
 * The title of the finding the daily-insights skill shows the shape with. An answer that hands
 * it back copied the skill and read nothing, so the check refuses it by this title.
 */
export const SKILL_EXAMPLE_TITLE = "Checkout errors doubled";

/** The step parameter as a stored query declares it; Langy runs a copy with the step written in. */
const PERIOD_STEP = `{${LWQL_PERIOD_GRANULARITY_PARAMETER}:UInt32}`;

/** An answer longer than this is refused unread; a real one is a few kilobytes. */
const MAX_ANSWER_LENGTH = 400_000;

const OPENING_FENCE = new RegExp(`^ {0,3}\`{3,}[ \\t]*${INSIGHT_RUN_FINDINGS_FENCE_TAG}[ \\t]*$`);
const CLOSING_FENCE = /^ {0,3}`{3,}[ \t]*$/;

/** A widget of the board as the run read it, with the queries the board stores for it. */
type BoardWidget = Readonly<{
  id: string;
  name: string;
  statements: readonly Readonly<{ sql: string }>[];
}>;

/**
 * One finding as the run files it: its words, a widget only when the board has it, a query
 * only when that widget stores it, its key as one spelling, and the insight it says it repeats.
 */
export type CheckedFinding = Readonly<
  Omit<InsightRunFinding, "widgetId" | "topic" | "lwql" | "key" | "renews"> & {
    topic: string | null;
    lwql: string | null;
    widget: { id: string; name: string } | null;
    findingKey: string | null;
    /** An insight id as Langy wrote it; the run checks whose it is. */
    renews: string | null;
  }
>;

/** Why an answer is refused whole; each is a reason a run may record. */
type RunAnswerFault = Extract<InsightRunFailureReason, "bad_output" | "finding_has_url">;

type RunAnswerCheck =
  | Readonly<{ ok: true; findings: CheckedFinding[] }>
  | Readonly<{ ok: false; reason: RunAnswerFault }>;

const REFUSED: RunAnswerCheck = { ok: false, reason: "bad_output" };

function holdsWebAddress({ title, body, topic }: InsightRunFinding): boolean {
  return [title, body, topic ?? ""].some((words) => WEB_ADDRESS.test(words));
}

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

/** A query as one line: the skill asks for it so, and the board may store it on several. */
function onOneLine(sql: string): string {
  return sql.trim().replaceAll(/\s+/g, " ");
}

/**
 * The stored query as Langy may hand it back: as stored, or as the skill had it run, with the
 * run's step written in place of the parameter. Either way the board's own text is filed.
 */
function isHandedBack({ stored, handedBack }: { stored: string; handedBack: string }): boolean {
  const line = onOneLine(stored);
  if (line === handedBack) return true;
  return line.replaceAll(PERIOD_STEP, String(DAILY_RUN_GRANULARITY_SECONDS)) === handedBack;
}

/**
 * A key as one spelling: lower case, words joined by hyphens. Langy writes the same finding's
 * key with other capitals or spaces on another day, and it must still match.
 */
function findingKeyOf(key: string | undefined): string | null {
  const slug = (key ?? "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return slug.length > 0 ? slug : null;
}

function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}

/**
 * A card's finding as a run takes it: the fields a run's finding lists, named one by one, so
 * a field Langy's card gains later is not one a run starts to trust.
 */
function runFindingOf(finding: LangyInsightsCardFinding): Record<string, unknown> {
  const { title, body, tone, topic, validDays, widgetId, lwql, key, renews } = finding;
  return { title, body, tone, topic, validDays, widgetId, lwql, key, renews };
}

/**
 * What the answer hands back, unchecked. The typed card of the settled turn comes first; the
 * fenced block in the prose is read only when the turn carries no insights card at all, for
 * one release. Undefined for several cards, a repaired card, or neither a card nor one block.
 */
function findingsHandedBack({ text, parts }: { text: string; parts: readonly unknown[] }): unknown {
  const cards = langyInsightsCardPartsOf(parts);
  const [card] = cards;
  if (card === undefined) {
    const block = findingsBlockOf(text);
    return block === undefined ? void 0 : parsedJson(block);
  }
  // A card cut off mid-stream was repaired to what was left of it: never filed in part.
  if (cards.length > 1 || card.repaired) return void 0;
  return { findings: card.card.findings.map(runFindingOf) };
}

export function checkRunAnswer({
  text,
  parts,
  maxInsights,
  widgets,
}: {
  /** The answer's prose, where a run that started before the card still ends with its block. */
  text: string;
  /** The settled turn's parts: Langy's relay stamped the insights card among them. */
  parts: readonly unknown[];
  maxInsights: number;
  /** The widgets on the board as the run read it; the answer names none into being. */
  widgets: readonly BoardWidget[];
}): RunAnswerCheck {
  if (text.length > MAX_ANSWER_LENGTH) return REFUSED;
  const parsed = insightRunFindingsSchema.safeParse(findingsHandedBack({ text, parts }));
  if (!parsed.success) return REFUSED;
  // The skill's own example, handed back: the answer copied the skill and found nothing.
  if (parsed.data.findings.some(({ title }) => title === SKILL_EXAMPLE_TITLE)) return REFUSED;
  // Asked of every finding the answer holds, filed or not: one link taints the whole answer.
  if (parsed.data.findings.some(holdsWebAddress)) return { ok: false, reason: "finding_has_url" };

  const findings = parsed.data.findings
    .slice(0, maxInsights)
    .map(({ widgetId, topic, lwql, key, renews, ...words }) => {
      const widget = widgets.find((candidate) => candidate.id === widgetId);
      // Langy's own text is never kept: it may name a database or a date, and would not replay.
      const handedBack = lwql === undefined ? undefined : onOneLine(lwql);
      const stored =
        handedBack === undefined
          ? undefined
          : widget?.statements
              .map(({ sql }) => sql)
              .find((query) => isHandedBack({ stored: query, handedBack }));
      return {
        ...words,
        topic: topic ?? null,
        lwql: stored ?? null,
        widget: widget ? { id: widget.id, name: widget.name } : null,
        findingKey: findingKeyOf(key),
        renews: renews ?? null,
      };
    });
  return { ok: true, findings };
}
