import type { RunOutcomeCounts } from "~/server/scenarios/run-outcome-summary";
import type {
  PassRateFact,
  QuestionTier,
  ReportIntegrity,
  ReportModel,
  ReportSection,
  ReportTier,
  RunSummary,
} from "../report.types";
import { type BarSegment, formatRate, passRateBar } from "./charts";
import { escapeAttr, escapeHtml } from "./html-escape";
import { renderBlocks, renderStats, toneClass } from "./render-blocks";
import { REPORT_SCRIPT } from "./report-script";
import { REPORT_STYLES } from "./report-styles";

/**
 * Turns a resolved report into one self-contained HTML document.
 *
 * Pure and synchronous: no DOM, no I/O, and no clock. `meta.generatedAt` is
 * already a string on the model, which is what lets the same run render the
 * same file twice.
 *
 * Every string that came from run data or from a model goes through
 * {@link escapeHtml} or {@link escapeAttr}. The document therefore contains
 * exactly one `<script>`, and its body is {@link REPORT_SCRIPT} verbatim — no
 * data reaches it, so nothing in a scenario name or a model sentence can.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const QUESTION_TIERS: readonly { tier: QuestionTier; heading: string }[] = [
  { tier: "past", heading: "What happened" },
  { tier: "present", heading: "What is true now" },
  { tier: "future", heading: "What to do next" },
];

const TIER_BADGES: Readonly<Record<ReportTier, string>> = {
  verified: "Langy checked",
  unchecked: "Langy unchecked",
  figures_only: "Figures only",
};

/**
 * What is missing at each tier, said plainly.
 *
 * A verified report says nothing extra; the other two owe the reader a sentence
 * about which half of the document did not survive being produced.
 */
const TIER_NOTES: Readonly<Record<ReportTier, string | null>> = {
  verified: null,
  unchecked:
    "Langy's analysis could not be checked a second time. The figures below are computed directly from the run data.",
  figures_only:
    "Langy could not write the analysis this time. Everything below is computed directly from the run data.",
};

/**
 * What a figures-only report says when nobody asked for an analysis.
 *
 * The same tier reached deliberately and reached by failure, and a reader told
 * the wrong one either goes looking for a fault that never happened or misses
 * one that did.
 */
const EXPORTED_WITHOUT_LANGY =
  "Exported without Langy. Every figure below is computed directly from the run data.";

/**
 * One question.
 *
 * The computed blocks always render, and a gap is rendered in place of the
 * missing answer rather than in place of the section: a section that is absent
 * and a question that cannot be answered look identical to a reader and mean
 * opposite things.
 */
function renderSection(section: ReportSection): string {
  const gap =
    section.gap === null ? "" : `<p class="gap">${escapeHtml(section.gap)}</p>`;
  return [
    `<section class="card" id="question-${escapeAttr(section.questionId)}">`,
    `<h3>${escapeHtml(section.question)}</h3>`,
    `<p class="question">${escapeHtml(section.intent)}</p>`,
    gap,
    renderBlocks(section.computed),
    renderBlocks(section.written),
    "</section>",
  ].join("");
}

function renderTierGroups(sections: ReportSection[]): string {
  return QUESTION_TIERS.map(({ tier, heading }) => {
    const inTier = sections.filter((section) => section.tier === tier);
    if (inTier.length === 0) return "";
    return `<h2>${escapeHtml(heading)}</h2>${inTier.map(renderSection).join("")}`;
  }).join("");
}

// ============================================================================
// Headline
// ============================================================================

function countSegments(counts: RunOutcomeCounts): BarSegment[] {
  return [
    { label: "passed", value: counts.passedCount, tone: "pass" },
    { label: "failed", value: counts.failedCount, tone: "fail" },
    { label: "stalled", value: counts.stalledCount, tone: "warn" },
    { label: "cancelled", value: counts.cancelledCount, tone: "muted" },
    { label: "in progress", value: counts.inProgressCount, tone: "neutral" },
    { label: "queued", value: counts.queuedCount, tone: "muted" },
  ];
}

/**
 * The one sentence a reader takes away.
 *
 * A small sample is reported as counts and nothing else. Three failures out of
 * four is not a 75% failure rate in any sense worth rewriting a prompt over, so
 * no percentage is offered for one to be read off.
 */
function headlineSentence({
  passRate,
  counts,
}: {
  passRate: PassRateFact;
  counts: RunOutcomeCounts;
}): string {
  if (passRate.value === null) {
    return "No runs have settled, so there is no pass rate to state.";
  }
  if (passRate.inconclusiveReason === "too_few_runs") {
    return `${counts.failedCount} of ${passRate.settled} settled runs failed. Too few runs to draw a conclusion from a rate.`;
  }
  if (passRate.inconclusiveReason === "spread_too_wide") {
    // Naming the sample here would be misleading: there are plenty of runs. The
    // rate is unquotable because the agent was inconsistent across them.
    const spread =
      passRate.ci95 === null
        ? ""
        : ` The true rate could be anywhere from ${formatRate(passRate.ci95.low)} to ${formatRate(passRate.ci95.high)}.`;
    return `${counts.failedCount} of ${passRate.settled} settled runs failed — ${formatRate(passRate.value)}, but results varied too much across runs to quote that as the agent's rate.${spread}`;
  }
  const headline = `Pass rate ${formatRate(passRate.value)} across ${passRate.settled} settled runs`;
  if (passRate.ci95 === null) return `${headline}.`;
  return `${headline}, likely between ${formatRate(passRate.ci95.low)} and ${formatRate(passRate.ci95.high)}.`;
}

/**
 * The card someone reads instead of the report.
 *
 * First on the page and free of ids, because the people it is written for are
 * deciding whether the run needs their attention at all. Everything in it is
 * computed, so it is the same document at every tier.
 */
function renderSummary(summary: RunSummary): string {
  const parts = [
    '<section class="card summary" id="summary">',
    `<p class="verdict ${toneClass(summary.tone)}">${escapeHtml(summary.verdict)}</p>`,
    summary.movement === null
      ? ""
      : `<p class="movement">${escapeHtml(summary.movement)}</p>`,
    renderStats(summary.facts),
    summary.topProblem === null
      ? ""
      : `<p class="summary-line"><span class="summary-label">Worth fixing first</span>${escapeHtml(summary.topProblem)}</p>`,
    summary.caveat === null
      ? ""
      : `<p class="summary-line caveat"><span class="summary-label">Read with care</span>${escapeHtml(summary.caveat)}</p>`,
    "</section>",
  ];
  return parts.filter(Boolean).join("");
}

function renderHeadline(model: ReportModel): string {
  const { passRate, counts } = model.headline;
  return [
    '<section class="card" id="headline">',
    "<h2>Result</h2>",
    `<p class="headline-rate">${escapeHtml(headlineSentence({ passRate, counts }))}</p>`,
    passRateBar({ segments: countSegments(counts) }),
    renderStats([
      { label: "Scenarios", value: String(counts.totalCount) },
      { label: "Passed", value: String(counts.passedCount) },
      { label: "Failed", value: String(counts.failedCount) },
      { label: "Stalled", value: String(counts.stalledCount) },
      { label: "Cancelled", value: String(counts.cancelledCount) },
      { label: "Settled", value: String(counts.settledCount) },
    ]),
    "</section>",
  ].join("");
}

// ============================================================================
// Document
// ============================================================================

function renderTierBanner(tier: ReportTier, withAnalysis: boolean): string {
  const note =
    tier === "figures_only" && !withAnalysis
      ? EXPORTED_WITHOUT_LANGY
      : TIER_NOTES[tier];
  const label =
    tier === "figures_only" && !withAnalysis
      ? "Without Langy"
      : TIER_BADGES[tier];
  const badge = `<p><span class="badge badge-${escapeAttr(tier)}">${escapeHtml(
    label,
  )}</span></p>`;
  return note === null
    ? badge
    : `${badge}<p class="tier-note">${escapeHtml(note)}</p>`;
}

function renderHeader(model: ReportModel): string {
  const { meta } = model;
  return [
    "<header>",
    "<h1>Run report</h1>",
    `<p class="meta"><span>${escapeHtml(meta.suiteName)}</span>`,
    `<span>Run ${escapeHtml(meta.batchRunId)}</span>`,
    `<span>Generated ${escapeHtml(meta.generatedAt)}</span></p>`,
    renderTierBanner(model.tier, model.meta.withAnalysis),
    "</header>",
  ].join("");
}

/**
 * What was dropped on the way here, and by which half of the pipeline.
 *
 * Always rendered, including when nothing was dropped: a footer that appears
 * only when something went wrong teaches a reader to skip it.
 */
function renderIntegrity({
  integrity,
  withAnalysis,
}: {
  integrity: ReportIntegrity;
  withAnalysis: boolean;
}): string {
  const notes = integrity.notes.map((note) => `<li>${escapeHtml(note)}</li>`);

  // A report with no analysis in it has nothing to account for. Printing the
  // sieve's three zeroes there reads as "Langy wrote this and none of it was
  // cut", which is the opposite of what happened.
  const method = withAnalysis
    ? [
        "<p>The figures are computed from this run’s data with no AI involved. The written analysis is Langy’s, and every sentence of it is traced back to the run before it is allowed into the file.</p>",
        `<ul>${[
          `${integrity.claimsDroppedUncited} statements removed for citing nothing`,
          `${integrity.claimsDroppedUnresolvable} statements removed for citing something that is not in this run`,
          `${integrity.claimsDroppedUnconfirmed} statements removed because the second reading could not confirm them`,
        ]
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}</ul>`,
      ]
    : [
        "<p>Every figure here is computed from this run’s data with no AI involved. Nothing in this file was written by Langy.</p>",
      ];

  return [
    "<h2>How this report was produced</h2>",
    ...method,
    notes.length === 0 ? "" : `<ul>${notes.join("")}</ul>`,
  ].join("");
}

function renderHead(model: ReportModel): string {
  return [
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Run report — ${escapeHtml(model.meta.suiteName)}</title>`,
    `<style>${REPORT_STYLES}</style>`,
    "</head>",
  ].join("\n");
}

const CONTROLS = [
  '<div class="controls no-print">',
  '<button type="button" data-details="expand">Expand all detail</button>',
  '<button type="button" data-details="collapse">Collapse all detail</button>',
  "</div>",
].join("");

function renderBody(model: ReportModel): string {
  return [
    "<body>",
    "<main>",
    renderHeader(model),
    renderSummary(model.summary),
    renderHeadline(model),
    CONTROLS,
    renderTierGroups(model.sections),
    `<footer>${renderIntegrity({
      integrity: model.integrity,
      withAnalysis: model.meta.withAnalysis,
    })}</footer>`,
    "</main>",
    `<script>${REPORT_SCRIPT}</script>`,
    "</body>",
  ].join("\n");
}

export function renderReportHtml({ model }: { model: ReportModel }): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    renderHead(model),
    renderBody(model),
    "</html>",
  ].join("\n");
}
