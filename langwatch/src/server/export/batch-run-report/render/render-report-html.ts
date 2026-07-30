import type { RunOutcomeCounts } from "~/server/scenarios/run-outcome-summary";
import type {
  Artifact,
  Block,
  Citation,
  Claim,
  Finding,
  PassRateFact,
  QuestionTier,
  ReportIntegrity,
  ReportModel,
  ReportSection,
  ReportTier,
  SelectedTranscript,
  Severity,
  TableCell,
  Tone,
} from "../report.types";
import { type BarSegment, formatRate, passRateBar } from "./charts";
import { escapeAttr, escapeHtml } from "./html-escape";
import { REPORT_SCRIPT } from "./report-script";
import { REPORT_STYLES, toneToken } from "./report-styles";

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
  verified: "Analysis checked",
  unchecked: "Analysis not checked",
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
    "The analysis could not be independently checked. The figures below are computed directly from the run data.",
  figures_only:
    "The written analysis is unavailable. Everything below is computed directly from the run data.",
};

const SEVERITY_TONES: Readonly<Record<Severity, Tone>> = {
  critical: "fail",
  high: "fail",
  medium: "warn",
  low: "muted",
};

const ARTIFACT_LABELS: Readonly<Record<Artifact["artifactType"], string>> = {
  scenario: "Scenario",
  system_prompt_amendment: "System prompt amendment",
  guardrail_rule: "Guardrail rule",
};

function toneClass(tone: Tone | undefined): string {
  return `tone-${toneToken(tone)}`;
}

// ============================================================================
// Blocks
// ============================================================================

function renderStats(
  stats: { label: string; value: string; hint?: string }[],
): string {
  const entries = stats
    .map(
      (stat) =>
        `<div><dt>${escapeHtml(stat.label)}</dt><dd>${escapeHtml(stat.value)}${
          stat.hint === undefined
            ? ""
            : `<span class="hint">${escapeHtml(stat.hint)}</span>`
        }</dd></div>`,
    )
    .join("");
  return `<dl class="stats">${entries}</dl>`;
}

function renderCell(cell: TableCell): string {
  const sortAttr =
    cell.sortValue === undefined
      ? ""
      : ` data-sort-value="${escapeAttr(String(cell.sortValue))}"`;
  return `<td class="${toneClass(cell.tone)}"${sortAttr}>${escapeHtml(cell.text)}</td>`;
}

function renderTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: TableCell[][];
}): string {
  const head = columns
    .map(
      (column) =>
        `<th scope="col" data-sortable aria-sort="none">${escapeHtml(column)}</th>`,
    )
    .join("");
  const body = rows
    .map((row) => `<tr>${row.map(renderCell).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderList(items: { text: string; tone?: Tone }[]): string {
  const entries = items
    .map(
      (item) =>
        `<li class="${toneClass(item.tone)}">${escapeHtml(item.text)}</li>`,
    )
    .join("");
  return `<ul class="list">${entries}</ul>`;
}

type GroupBlock = Extract<Block, { kind: "groups" }>;

function renderGroupDetail(detail: { label: string; body: string }[]): string {
  const entries = detail
    .map(
      (item) =>
        `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.body)}</dd>`,
    )
    .join("");
  return `<dl class="detail">${entries}</dl>`;
}

function gapMarker(count: number): string {
  return `<li class="turn-gap">${escapeHtml(
    `${count} ${count === 1 ? "turn" : "turns"} not shown`,
  )}</li>`;
}

/**
 * The turns of one conversation, with the dropped middle marked where it fell.
 *
 * Selection keeps the opening turn and the tail, so a gap sits between two
 * non-consecutive indices. The marker is derived from that discontinuity rather
 * than from a count, which is what puts it in the right place instead of at the
 * top — a reader following an escalation needs to know where the jump was.
 */
function renderTranscriptTurns(
  turns: SelectedTranscript["turns"],
  omittedTurns: number,
): string {
  return (
    turns
      .map((turn, position) => {
        const previous = turns[position - 1];
        const gap =
          previous !== undefined && turn.index > previous.index + 1
            ? gapMarker(turn.index - previous.index - 1)
            : "";
        return [
          gap,
          `<li class="turn">`,
          `<p class="turn-meta"><span class="turn-role">${escapeHtml(turn.role)}</span>`,
          `<span class="turn-index">turn ${escapeHtml(String(turn.index))}</span></p>`,
          `<p class="turn-body">${escapeHtml(turn.content)}</p>`,
          "</li>",
        ].join("");
      })
      .join("")
      // A conversation whose gap is not between two kept turns (nothing after the
      // opening survived) still owes the reader the count.
      .concat(
        omittedTurns > 0 && turns.length <= 1 ? gapMarker(omittedTurns) : "",
      )
  );
}

/**
 * The conversations behind a failure group.
 *
 * Read verbatim from the run record, so this is the one part of the document a
 * reader can check the rest against. Nested disclosures: a group opens to its
 * conversation list, and each conversation opens to its turns, so neither a
 * forty-scenario group nor a fifty-turn transcript floods the page.
 */
function renderTranscripts(transcripts: SelectedTranscript[]): string {
  if (transcripts.length === 0) return "";
  const entries = transcripts
    .map(
      (transcript) =>
        `<details class="transcript"><summary>${escapeHtml(
          transcript.scenarioName,
        )}<span class="group-subtitle">${escapeHtml(
          `run ${transcript.runId}`,
        )}</span></summary><ol class="turns">${renderTranscriptTurns(
          transcript.turns,
          transcript.omittedTurns,
        )}</ol></details>`,
    )
    .join("");
  return `<div class="replay"><p class="replay-heading">${escapeHtml(
    transcripts.length === 1
      ? "The conversation"
      : `${transcripts.length} of these conversations`,
  )}</p>${entries}</div>`;
}

/**
 * Failure groups, each behind a native disclosure.
 *
 * `<details>` rather than a scripted toggle so the detail is reachable by
 * keyboard, survives scripting being off, and is opened again before printing.
 */
function renderGroups(groups: GroupBlock["groups"]): string {
  return groups
    .map(
      (group) =>
        `<details class="${toneClass(group.tone)}"><summary>${escapeHtml(
          group.title,
        )}<span class="group-subtitle">${escapeHtml(
          group.subtitle,
        )}</span></summary>${renderGroupDetail(
          group.detail,
        )}${renderTranscripts(group.transcripts ?? [])}</details>`,
    )
    .join("");
}

function describeCitation(citation: Citation): string {
  switch (citation.kind) {
    case "run":
      return `run ${citation.runId}`;
    case "criterion":
      return `criterion ${citation.criterionId}`;
    case "signature":
      return `failure group ${citation.signatureId}`;
    case "turn":
      return `run ${citation.runId}, turn ${citation.turnIndex}`;
    case "stat":
      return `figure ${citation.path}`;
  }
}

function renderCitations(citations: Citation[]): string {
  if (citations.length === 0) return "";
  const entries = citations
    .map((citation) => `<li>${escapeHtml(describeCitation(citation))}</li>`)
    .join("");
  return `<ul class="citations">${entries}</ul>`;
}

function renderClaims(claims: Claim[]): string {
  if (claims.length === 0) return "";
  const entries = claims
    .map(
      (claim) =>
        `<li id="claim-${escapeAttr(claim.id)}">${escapeHtml(
          claim.text,
        )}${renderCitations(claim.citations)}</li>`,
    )
    .join("");
  return `<ul class="claims">${entries}</ul>`;
}

/**
 * The severity line, showing the computed prior whenever the two disagree — a
 * model talking a failure up or down is itself worth seeing.
 */
function renderSeverity(finding: Finding): string {
  const agreed = finding.severity === finding.computedSeverity;
  const suffix = agreed ? "" : ` (computed: ${finding.computedSeverity})`;
  return `<p class="severity ${toneClass(SEVERITY_TONES[finding.severity])}">${escapeHtml(
    `${finding.severity}${suffix}`,
  )}</p>`;
}

function renderFindings(findings: Finding[]): string {
  return findings
    .map(
      (finding) =>
        `<article class="finding"><h4>${escapeHtml(
          finding.headline,
        )}</h4>${renderSeverity(finding)}<p>${escapeHtml(
          finding.consequence,
        )}</p>${renderClaims(finding.claims)}</article>`,
    )
    .join("");
}

function renderArtifacts(artifacts: Artifact[]): string {
  return artifacts
    .map(
      (artifact) =>
        `<article class="artifact"><h4>${escapeHtml(
          artifact.title,
        )}</h4><p class="severity">${escapeHtml(
          ARTIFACT_LABELS[artifact.artifactType],
        )}</p><p>${escapeHtml(
          artifact.rationale,
        )}</p><details><summary>Show the proposal</summary><pre><code>${escapeHtml(
          artifact.body,
        )}</code></pre></details>${renderClaims(artifact.claims)}</article>`,
    )
    .join("");
}

/**
 * Dispatches one block.
 *
 * Exhaustive with no `default`, so adding a variant to `Block` is a compile
 * error here until it has somewhere to render.
 */
function renderBlock(block: Block): string {
  switch (block.kind) {
    case "stats":
      return renderStats(block.stats);
    case "bar":
      return passRateBar({ segments: block.segments });
    case "table":
      return renderTable({ columns: block.columns, rows: block.rows });
    case "list":
      return renderList(block.items);
    case "groups":
      return renderGroups(block.groups);
    case "note":
      return `<p class="note ${toneClass(block.tone)}">${escapeHtml(block.text)}</p>`;
    case "claims":
      return renderClaims(block.claims);
    case "findings":
      return renderFindings(block.findings);
    case "artifacts":
      return renderArtifacts(block.artifacts);
  }
}

function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join("");
}

// ============================================================================
// Sections
// ============================================================================

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
  if (passRate.tooFewToConclude) {
    return `${counts.failedCount} of ${passRate.settled} settled runs failed. Too few runs to draw a conclusion from a rate.`;
  }
  if (passRate.value === null) {
    return "No runs have settled, so there is no pass rate to state.";
  }
  const headline = `Pass rate ${formatRate(passRate.value)} across ${passRate.settled} settled runs`;
  if (passRate.ci95 === null) return `${headline}.`;
  return `${headline}, likely between ${formatRate(passRate.ci95.low)} and ${formatRate(passRate.ci95.high)}.`;
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

function renderTierBanner(tier: ReportTier): string {
  const note = TIER_NOTES[tier];
  const badge = `<p><span class="badge badge-${escapeAttr(tier)}">${escapeHtml(
    TIER_BADGES[tier],
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
    renderTierBanner(model.tier),
    "</header>",
  ].join("");
}

/**
 * What was dropped on the way here, and by which half of the pipeline.
 *
 * Always rendered, including when nothing was dropped: a footer that appears
 * only when something went wrong teaches a reader to skip it.
 */
function renderIntegrity(integrity: ReportIntegrity): string {
  const dropped = [
    `${integrity.claimsDroppedUncited} statements removed for citing nothing`,
    `${integrity.claimsDroppedUnresolvable} statements removed for citing something that is not in this run`,
    `${integrity.claimsDroppedUnconfirmed} statements removed because the second reading could not confirm them`,
  ];
  const notes = integrity.notes.map((note) => `<li>${escapeHtml(note)}</li>`);
  return [
    "<h2>How this report was produced</h2>",
    "<p>The figures are computed from this run’s data with no model involved. The written analysis is produced by a model, and every statement is traced back to the run before it is allowed into the file.</p>",
    `<ul>${dropped.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
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
    renderHeadline(model),
    CONTROLS,
    renderTierGroups(model.sections),
    `<footer>${renderIntegrity(model.integrity)}</footer>`,
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
