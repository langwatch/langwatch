/**
 * The blocks answering what happened: outcomes, regressions, fixes, streaks.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import { formatDuration } from "../format";
import type {
  Block,
  ReportEvidence,
  TableCell,
  TrendClassification,
} from "../report.types";
import {
  plural,
  scenarioNameFor,
  TREND_LABELS,
  trendClassificationById,
  trendPoints,
} from "./question-helpers";

function runRow(run: ReportEvidence["runs"][number]) {
  return [
    { text: run.scenarioName },
    {
      text: run.status,
      tone:
        run.category === "success"
          ? ("pass" as const)
          : run.category === "failure"
            ? ("fail" as const)
            : ("warn" as const),
    },
    {
      // A run that never reached the judge has no criteria either way, and
      // "0/0" reads as a verdict rather than as the absence of one.
      text:
        run.metCriteria.length + run.unmetCriteria.length === 0
          ? "—"
          : `${run.metCriteria.length}/${run.metCriteria.length + run.unmetCriteria.length}`,
      sortValue: run.metCriteria.length,
    },
    { text: String(run.turnCount), sortValue: run.turnCount },
    { text: formatDuration(run.durationMs), sortValue: run.durationMs },
  ];
}

const RUN_COLUMNS = ["Scenario", "Outcome", "Criteria met", "Turns", "Took"];

/**
 * What happened, per scenario.
 *
 * Deliberately does NOT restate the counts or redraw the outcome bar. Both sit
 * two cards above this one, and a reader who has just been given the totals and
 * the same chart twice reads the third copy as a different measurement and
 * starts looking for the discrepancy. What this section owns is the row-level
 * detail and the run's place in the sequence.
 */
export function outcomeBlocks(evidence: ReportEvidence): Block[] {
  // Only what a reader would act on. A run of twenty-one scenarios put every
  // passing row on the page, and a reader scanning for what went wrong had to
  // do the filtering themselves — on the section that exists to tell them.
  // The ones that passed are reference, so they are reachable rather than
  // absent, and a run where nothing failed still shows its rows.
  const didNotPass = evidence.runs.filter((run) => run.category !== "success");
  const passed = evidence.runs.filter((run) => run.category === "success");
  const blocks: Block[] = [];

  if (didNotPass.length > 0) {
    blocks.push({
      kind: "table",
      columns: RUN_COLUMNS,
      rows: didNotPass.map(runRow),
    });
    if (passed.length > 0) {
      blocks.push({
        kind: "groups",
        groups: [
          {
            title: `${plural(passed.length, "scenario", "scenarios")} passed`,
            subtitle: "nothing to do here",
            tone: "pass" as const,
            detail: passed.map((run) => ({
              label: run.scenarioName,
              body: `${run.metCriteria.length} of ${run.metCriteria.length + run.unmetCriteria.length} criteria, ${formatDuration(run.durationMs)}`,
            })),
          },
        ],
      });
    }
  } else {
    blocks.push({
      kind: "table",
      columns: RUN_COLUMNS,
      rows: evidence.runs.map(runRow),
    });
  }

  // This run's rate in the company of the ones before it. A single figure
  // cannot say whether 25% is a collapse or the usual, which is the first
  // thing a reader wants to know about it.
  const history = trendPoints(evidence);
  if (history.length > 1) {
    blocks.push({ kind: "trend", points: history });
  }

  if (evidence.isStillRunning) {
    blocks.unshift({
      kind: "note",
      tone: "warn",
      text: "Some scenarios had not finished when this report was produced, so these figures cover only the ones that had.",
    });
  }

  return blocks;
}

export function trendTable({
  evidence,
  classifications,
  emptyText,
}: {
  evidence: ReportEvidence;
  classifications: TrendClassification[];
  emptyText: string;
}): Block[] {
  const matching = evidence.trend.filter((fact) =>
    classifications.includes(fact.classification),
  );

  if (matching.length === 0) {
    return [{ kind: "note", text: emptyText, tone: "muted" }];
  }

  return [
    {
      kind: "table",
      columns: ["Criterion", "Scenario", "Status", "Runs"],
      rows: matching.map((fact) => [
        { text: fact.text },
        {
          text: scenarioNameFor({ evidence, scenarioId: fact.scenarioId }),
        },
        { text: TREND_LABELS[fact.classification] },
        { text: String(fact.streakBatches), sortValue: fact.streakBatches },
      ]),
    },
  ];
}

export function streakBlocks(evidence: ReportEvidence): Block[] {
  const holding = evidence.coverage.neverFailed;
  if (holding.length === 0) {
    return [
      {
        kind: "note",
        tone: "muted",
        text: "No criterion has come through every run without failing at least once.",
      },
    ];
  }

  // Criterion identity is scoped to its scenario, so one criterion worded the
  // same way across five scenarios is five entries here. Listing it five times
  // reads as a rendering fault; it is one thing that is holding.
  const byText = new Map<string, { scenarios: number; batches: number }>();
  for (const entry of holding) {
    const seen = byText.get(entry.text);
    byText.set(entry.text, {
      scenarios: (seen?.scenarios ?? 0) + 1,
      batches: Math.max(seen?.batches ?? 0, entry.batches),
    });
  }

  const longest = Math.max(...[...byText.values()].map((it) => it.batches));

  // This is the section that says a reader does not need to look here, and it
  // was the second largest in the document — every holding criterion spelled
  // out, each with the same suffix repeated after it. So it answers in one
  // line and keeps the roll call behind a disclosure for anyone who wants to
  // audit it. What is working earns an acknowledgement, not a page.
  return [
    {
      kind: "note",
      tone: "pass",
      text:
        longest > 1
          ? `${plural(byText.size, "criterion", "criteria")} came through this run without failing, the steadiest of them across ${longest} runs.`
          : `${plural(byText.size, "criterion", "criteria")} came through this run without failing.`,
    },
    {
      kind: "groups",
      groups: [
        {
          title: "Everything that held",
          subtitle: plural(byText.size, "criterion", "criteria"),
          tone: "pass" as const,
          detail: [...byText].map(([text, { scenarios, batches }]) => ({
            label: text,
            body: [
              scenarios > 1 ? `${scenarios} scenarios` : "1 scenario",
              batches > 1 ? `${batches} runs` : "this run",
            ].join(", "),
          })),
        },
      ],
    },
  ];
}

// ============================================================================
// Present
// ============================================================================
