/**
 * Every word the weekly digest says, from each row's numbers: the title, the context line, the
 * button and text link, and the lines built over the rows. Kept here, apart from the layout, so a
 * copy pass edits one file. Pure: no React.
 */
import {
  formatCompact,
  formatCount,
  formatLatency,
  formatPercent,
  formatUsd,
  percentOf,
} from "./digest-parts.tsx";
import type {
  DigestWeekEvaluator,
  DigestWeekFoldedRow,
  DigestWeekProps,
  DigestWeekRow,
} from "./digest-week.tsx";

/** The most buttons one email shows; later rows that carry one keep their linked title. */
export const MAX_BUTTONS = 2;

/** The label on each row kind's chip. */
export const CHIP_LABELS: Readonly<Record<DigestWeekRow["kind"], string>> = {
  plan: "Plan",
  scenarios: "Scenarios",
  evals: "Evals",
  quiet: "Quiet",
  setup: "Set up",
  coding: "Coding",
  traces: "Traces",
  new: "New",
};

type Action = Readonly<{ label: string; href: string }>;
/** A text link, with any plain words that lead into it kept out of the link. */
type TextLink = Action & Readonly<{ before?: string }>;

/** One row in words. A row with a button needs the reader, and its chip is solid. */
export type RowCopy = Readonly<{
  kind: DigestWeekRow["kind"];
  title: string;
  href: string;
  context: string;
  button?: Action;
  link?: TextLink;
  needsYou: boolean;
  /** How the header's "Needs you" line names it, when it needs the reader. */
  needsYouPhrase?: string;
  /** How the inbox preview names it, after the first row. */
  previewPhrase: string;
}>;

const plural = ({ count, one, many }: { count: number; one: string; many: string }): string =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** `a`, `a and b`, `a, b and c`. */
export const joinAnd = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;

/** A catalogue evaluator's name, or the custom ones together. */
const evalName = (evaluator: DigestWeekEvaluator): string =>
  evaluator.kind === "custom" ? "custom evaluations" : `${evaluator.name} eval`;

const traceChange = ({
  traces,
  previousTraces,
}: {
  traces: number;
  previousTraces?: number;
}): string => {
  if (previousTraces === undefined) return "";
  if (previousTraces === traces) return ", the same as last week";
  const direction = traces > previousTraces ? "up" : "down";
  const from = previousTraces === 0 ? "none" : formatCount(previousTraces);
  return `, ${direction} from ${from} last week`;
};

function planCopy(row: Extract<DigestWeekRow, { kind: "plan" }>): RowCopy {
  const used = formatPercent(percentOf({ part: row.used, whole: row.limit }));
  const days = plural({ count: row.daysLeft, one: "day", many: "days" });
  return {
    kind: row.kind,
    title: `You have used ${used} of this month's traces`,
    href: row.url,
    context: `${formatCount(row.used)} of the ${formatCount(row.limit)} traces your plan includes. The count resets on ${row.resetsOn}, in ${days}.`,
    button: { label: "Raise the limit", href: row.upgradeUrl },
    link: { before: "or ", label: "choose which traces to keep", href: row.url },
    needsYou: true,
    needsYouPhrase: "the plan",
    previewPhrase: "this month's plan usage",
  };
}

function scenariosCopy(row: Extract<DigestWeekRow, { kind: "scenarios" }>): RowCopy {
  const rate = formatPercent(percentOf({ part: row.failed, whole: row.runs }));
  const baseline = formatPercent(row.baselineFailurePercent);
  const failedOfRuns = `${formatCount(row.failed)} of ${formatCount(row.runs)} test conversations failed`;
  if (row.direction === "better") {
    return {
      kind: row.kind,
      title: `${row.projectName}'s scenarios failed ${rate} of runs, down from ${baseline}`,
      href: row.url,
      context: `${failedOfRuns} this week.`,
      needsYou: false,
      previewPhrase: `${row.projectName}'s scenarios recovering`,
    };
  }
  return {
    kind: row.kind,
    title: `${row.projectName}'s scenarios failed ${rate} of runs, up from ${baseline}`,
    href: row.url,
    context: `${failedOfRuns}. In the four weeks before, ${baseline} failed.`,
    button: { label: "See the failing runs", href: row.url },
    needsYou: true,
    needsYouPhrase: `${row.projectName}'s failing tests`,
    previewPhrase: `${row.projectName}'s failing scenario runs`,
  };
}

function evalsCopy(row: Extract<DigestWeekRow, { kind: "evals" }>): RowCopy {
  const name = evalName(row.evaluator);
  const passed = formatPercent(percentOf({ part: row.checks - row.failed, whole: row.checks }));
  const baseline = formatPercent(row.baselinePassPercent);
  const recovered = row.direction === "better";
  return {
    kind: row.kind,
    title: recovered
      ? `${row.projectName}'s ${name} passed ${passed} of checks, up from ${baseline}`
      : `${row.projectName}'s ${name} passed ${passed} of checks, down from ${baseline}`,
    href: row.url,
    // Counts checks, not traces: two evaluators on one trace are two checks.
    context: `${formatCount(row.failed)} of ${formatCount(row.checks)} checks failed this week.`,
    needsYou: false,
    previewPhrase: recovered ? `${row.projectName}'s ${name} recovering` : `a drop in the ${name}`,
  };
}

function quietCopy(row: Extract<DigestWeekRow, { kind: "quiet" }>): RowCopy {
  return {
    kind: row.kind,
    title: `${row.projectName} sent no traces this week`,
    href: row.url,
    context: `It sent ${formatCount(row.previousTraces)} the week before. Check it still sends traces after your last deploy.`,
    needsYou: false,
    previewPhrase: "a project that stopped sending data",
  };
}

function setupCopy(row: Extract<DigestWeekRow, { kind: "setup" }>): RowCopy {
  return {
    kind: row.kind,
    title: `Nothing checked ${row.projectName}'s answers yet`,
    href: row.url,
    context: "Add one eval and next Monday's email shows how many passed.",
    button: { label: "Add an eval", href: row.url },
    needsYou: true,
    needsYouPhrase: `one eval on ${row.projectName}`,
    previewPhrase: "the one step that makes next week's email useful",
  };
}

/** No cost, anywhere in the row: what a person's agents spent is not this email's to say. */
function codingCopy(row: Extract<DigestWeekRow, { kind: "coding" }>): RowCopy {
  const totals = [
    `${formatCompact(row.tokens)} tokens`,
    ...(row.commits === undefined
      ? []
      : [`${formatCount(row.commits)} ${row.commits === 1 ? "commit" : "commits"}`]),
    ...(row.pullRequests === undefined
      ? []
      : [
          `${formatCount(row.pullRequests)} ${row.pullRequests === 1 ? "pull request" : "pull requests"}`,
        ]),
  ];
  // One "at least" covers the whole list: every total was floored by the same series cap.
  const floor = row.totalsAtLeast ? "at least " : "";
  const repository = row.topRepository
    ? `, ${formatCount(row.topRepository.sessions)} of the sessions in ${row.topRepository.name}`
    : "";
  return {
    kind: row.kind,
    title: `Your coding agents ran ${plural({ count: row.sessions, one: "session", many: "sessions" })}`,
    href: row.url,
    context: `${capitalise(`${floor}${joinAnd(totals)}`)}${repository}.`,
    needsYou: false,
    previewPhrase: "your coding agents' week",
  };
}

function tracesCopy(row: Extract<DigestWeekRow, { kind: "traces" }>): RowCopy {
  const errors = plural({ count: row.errors, one: "error", many: "errors" });
  const extras = [
    ...(row.topModel
      ? [`${row.topModel.name} answered ${formatCount(row.topModel.traces)} of them`]
      : []),
    ...(row.p95Milliseconds > 0 ? [`95% took ${formatLatency(row.p95Milliseconds)} or less`] : []),
  ];
  return {
    kind: row.kind,
    title: `${row.projectName} sent ${plural({ count: row.traces, one: "trace", many: "traces" })}${traceChange(row)}`,
    href: row.url,
    context: `${errors} and ${formatUsd(row.costUsd)} in model costs.${extras.length > 0 ? ` ${extras.join("; ")}.` : ""}`,
    needsYou: false,
    previewPhrase: `${row.projectName}'s traces`,
  };
}

function newCopy(row: Extract<DigestWeekRow, { kind: "new" }>): RowCopy {
  return {
    kind: row.kind,
    title: "Test conversations before you ship",
    href: row.url,
    context: `A scenario plays a scripted conversation against ${row.projectName} and tells you if the answer passed.`,
    link: { label: "Write your first scenario", href: row.url },
    needsYou: false,
    previewPhrase: "something new to try",
  };
}

/** A row's words, from its numbers. */
export function rowCopy(row: DigestWeekRow): RowCopy {
  switch (row.kind) {
    case "plan":
      return planCopy(row);
    case "scenarios":
      return scenariosCopy(row);
    case "evals":
      return evalsCopy(row);
    case "quiet":
      return quietCopy(row);
    case "setup":
      return setupCopy(row);
    case "coding":
      return codingCopy(row);
    case "traces":
      return tracesCopy(row);
    case "new":
      return newCopy(row);
  }
}

/** The first MAX_BUTTONS rows that carry a button keep it, in order; null for every other row. */
export function buttonSlots(rows: readonly RowCopy[]): (number | null)[] {
  let next = 0;
  return rows.map((row) => (row.button && next < MAX_BUTTONS ? next++ : null));
}

/** The email's subject: its first row's title. */
export function digestWeekSubject({ rows }: Pick<DigestWeekProps, "rows">): string {
  const [first] = rows;
  return first ? rowCopy(first).title : "Your week on LangWatch";
}

/** The inbox preview: what else is inside, or the one row's context when there is nothing else. */
export function digestWeekPreview({ rows }: Pick<DigestWeekProps, "rows">): string {
  const [first, ...rest] = rows.map(rowCopy);
  const phrases = [...new Set(rest.map((row) => row.previewPhrase))];
  if (phrases.length === 0) return first?.context ?? "";
  return `Inside: ${joinAnd(phrases)}.`;
}

export function digestWeekHeading({
  organizationName,
}: Pick<DigestWeekProps, "organizationName">): string {
  return organizationName
    ? `What changed in ${organizationName} this week`
    : "What changed this week";
}

/** The line under the heading: the week, and which rows need the reader, by name. */
export function digestWeekSubheading({
  weekLabel,
  rows,
}: Pick<DigestWeekProps, "weekLabel" | "rows">): string {
  const phrases = rows.map(rowCopy).flatMap((row) => row.needsYouPhrase ?? []);
  return phrases.length === 0 ? weekLabel : `${weekLabel} · Needs you: ${joinAnd(phrases)}.`;
}

export function digestWeekReason({
  organizationName,
}: Pick<DigestWeekProps, "organizationName">): string {
  return organizationName
    ? `You get this because you're in ${organizationName}.`
    : "You get this because you have a LangWatch account.";
}

const steadyEvalsPart = (steadyEvals: DigestWeekProps["steadyEvals"]): string | null => {
  const [only] = steadyEvals;
  if (!only) return null;
  if (steadyEvals.length > 1) return `${formatCount(steadyEvals.length)} evals held steady`;
  const passed = formatPercent(only.passRatePercent);
  return `${evalName(only.evaluator)} held steady at ${passed} passed`;
};

/**
 * The "Also this week" line: the organisation's traces and its steady evals in one sentence,
 * then each row the cap cut, by title. A cut New row is never here: the digest drops it.
 */
export function alsoThisWeek({
  folded,
  steadyEvals,
  organizationTraces,
}: Pick<DigestWeekProps, "folded" | "steadyEvals" | "organizationTraces">): Readonly<{
  label: string;
  lead: string | null;
  folded: readonly Action[];
  everything: string;
}> {
  const parts = [
    ...(organizationTraces
      ? [
          `${formatCount(organizationTraces.traces)} traces across ${formatCount(organizationTraces.projects)} projects`,
        ]
      : []),
    ...[steadyEvalsPart(steadyEvals)].flatMap((part) => part ?? []),
  ];
  return {
    label: "Also this week:",
    lead: parts.length > 0 ? `${capitalise(joinAnd(parts))}.` : null,
    folded: folded.map((row: DigestWeekFoldedRow) => {
      const copy = rowCopy(row);
      return { label: copy.title, href: copy.href };
    }),
    everything: "See everything in LangWatch",
  };
}
