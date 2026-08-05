/**
 * How each kind of block becomes HTML.
 *
 * One function per block kind, and `renderBlock` dispatches. Everything here
 * is pure and synchronous: no DOM, no React, no I/O, so the same model always
 * produces the same bytes.
 *
 * Model text is escaped into text nodes and there is no markdown, so the only
 * markup in the document is markup this file wrote.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import type {
  Artifact,
  Block,
  Citation,
  Claim,
  Finding,
  SelectedTranscript,
  Severity,
  TableCell,
  Tone,
} from "../report.types";
import { passRateBar, sparkline } from "./charts";
import { escapeAttr, escapeHtml } from "./html-escape";
import { toneToken } from "./report-styles";

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

export function toneClass(tone: Tone | undefined): string {
  return `tone-${toneToken(tone)}`;
}

// ============================================================================
// Blocks
// ============================================================================

export function renderStats(
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
  // A run that errored before it said anything has no turns. Opening a
  // disclosure onto nothing reads as a rendering fault, so it says why it is
  // empty — which is itself the finding for a run that never got started.
  if (turns.length === 0) {
    return '<li class="turn-gap">No conversation was recorded — this run ended before a turn was exchanged.</li>';
  }

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
    case "trend":
      return sparkline({ points: block.points });
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

export function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join("");
}

// ============================================================================
// Sections
// ============================================================================
