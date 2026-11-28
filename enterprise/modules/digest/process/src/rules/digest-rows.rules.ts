// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Which rows a person's weekly email shows, in what order, and which the cap cuts (ADR-003). */

/** Tuned from the Cloud admin gallery; ADR-003 explains each. */
export const DIGEST_ROW_THRESHOLDS = {
  planPressurePercent: 80,
  /** A scenario failure rate or an eval pass rate this far from its baseline gets a row. */
  movePoints: 10,
  codingAgentSessions: 5,
  /** An eval is compared only with this many checks this week and in its baseline. */
  evalMinChecks: 20,
  maxRows: 5,
  maxRegressions: 2,
} as const;

/** Runs (or checks) and how many of them failed. */
export type DigestRowCounts = Readonly<{ total: number; failed: number }>;

/** One evaluator on one project: this week's checks and its baseline's. */
export type DigestRowsEvaluator = Readonly<{
  evaluatorType: string;
  week: DigestRowCounts;
  baseline: DigestRowCounts;
}>;

/** What the rules read of one project the reader may view. */
export type DigestRowsProject = Readonly<{
  projectId: string;
  traces: number;
  /** Last week's traces; null when that read failed. */
  previousTraces: number | null;
  scenarios: DigestRowCounts;
  /** The four weeks before, summed, so the baseline is weighted by runs. */
  scenarioBaseline: DigestRowCounts;
  evaluators: readonly DigestRowsEvaluator[];
  /** Evaluation runs of any outcome, this week and the four before. */
  evaluationRuns: number;
}>;

/** "auto" is the weekly send; "every-row" lifts the thresholds and the cap for a staff test. */
export type DigestRowsMode = "auto" | "every-row";

export type DigestRowsInput = Readonly<{
  mode: DigestRowsMode;
  admin: boolean;
  /** The month's count against a finite plan limit; null when the plan has none. */
  plan: Readonly<{ used: number; limit: number }> | null;
  codingAgentSessions: number;
  projects: readonly DigestRowsProject[];
}>;

type Direction = "worse" | "better";

/** A row picked for the email, with the counts its words need; names and links come later. */
export type DigestRow =
  | Readonly<{ kind: "plan" }>
  | Readonly<{
      kind: "scenarios";
      projectId: string;
      direction: Direction;
      week: DigestRowCounts;
      baseline: DigestRowCounts;
    }>
  | Readonly<{
      kind: "evals";
      projectId: string;
      evaluatorType: string;
      direction: Direction;
      week: DigestRowCounts;
      baseline: DigestRowCounts;
    }>
  | Readonly<{ kind: "quiet"; projectId: string; previousTraces: number }>
  | Readonly<{ kind: "setup"; projectId: string }>
  | Readonly<{ kind: "coding" }>
  | Readonly<{ kind: "traces"; projectId: string }>
  | Readonly<{ kind: "new"; projectId: string }>;

/** A row the cap cut: named in the last line. A New row is dropped instead, so it is not one. */
export type DigestFoldedRow = Exclude<DigestRow, { kind: "new" }>;

export type DigestRowSelection = Readonly<{
  shown: readonly DigestRow[];
  folded: readonly DigestFoldedRow[];
  /** Evals compared with enough checks that held their rate, for the last line. */
  steadyEvals: readonly Readonly<{ evaluatorType: string; week: DigestRowCounts }>[];
}>;

type Move =
  | Readonly<{ kind: "moved"; direction: Direction; points: number; reaches: boolean }>
  | Readonly<{ kind: "unmoved" }>;

const UNMOVED: Move = { kind: "unmoved" };

/**
 * This week's failure share against the baseline's, cross-multiplied in integers so a move of
 * exactly the threshold is never lost to float error. Unmoved when either side is empty or the
 * rates are equal.
 */
function moveOf({ week, baseline }: { week: DigestRowCounts; baseline: DigestRowCounts }): Move {
  if (week.total === 0 || baseline.total === 0) return UNMOVED;
  const moved = week.failed * baseline.total - baseline.failed * week.total;
  if (moved === 0) return UNMOVED;
  const scale = week.total * baseline.total;
  return {
    kind: "moved",
    direction: moved > 0 ? "worse" : "better",
    points: (Math.abs(moved) * 100) / scale,
    reaches: Math.abs(moved) * 100 >= DIGEST_ROW_THRESHOLDS.movePoints * scale,
  };
}

type MovedRow = Readonly<{
  row: Extract<DigestRow, { kind: "scenarios" | "evals" }>;
  points: number;
}>;

const hasEnoughChecks = ({ week, baseline }: DigestRowsEvaluator): boolean =>
  week.total >= DIGEST_ROW_THRESHOLDS.evalMinChecks &&
  baseline.total >= DIGEST_ROW_THRESHOLDS.evalMinChecks;

/** Every scenario and eval move that earns a row, per visible project and evaluator. */
function movedRows({ projects, mode }: DigestRowsInput): MovedRow[] {
  const every = mode === "every-row";
  const earns = (move: Move): move is Extract<Move, { kind: "moved" }> =>
    move.kind === "moved" && (every || move.reaches);
  return projects.flatMap(({ projectId, scenarios, scenarioBaseline, evaluators }) => {
    const scenarioMove = moveOf({ week: scenarios, baseline: scenarioBaseline });
    const scenarioRows: MovedRow[] = earns(scenarioMove)
      ? [
          {
            row: {
              kind: "scenarios",
              projectId,
              direction: scenarioMove.direction,
              week: scenarios,
              baseline: scenarioBaseline,
            },
            points: scenarioMove.points,
          },
        ]
      : [];
    const evalRows = evaluators.flatMap((evaluator): MovedRow[] => {
      if (!every && !hasEnoughChecks(evaluator)) return [];
      const move = moveOf(evaluator);
      if (!earns(move)) return [];
      return [
        {
          row: {
            kind: "evals",
            projectId,
            evaluatorType: evaluator.evaluatorType,
            direction: move.direction,
            week: evaluator.week,
            baseline: evaluator.baseline,
          },
          points: move.points,
        },
      ];
    });
    return [...scenarioRows, ...evalRows];
  });
}

const biggestFirst = (moves: MovedRow[]): DigestRow[] =>
  moves.toSorted((left, right) => right.points - left.points).map(({ row }) => row);

const isRegression = (row: DigestRow): boolean =>
  (row.kind === "scenarios" || row.kind === "evals") && row.direction === "worse";

/** The busiest project first: by traces, then by scenario runs. */
const busiestFirst = (projects: readonly DigestRowsProject[]) =>
  projects.toSorted(
    (left, right) => right.traces - left.traces || right.scenarios.total - left.scenarios.total,
  );

/**
 * Every row with something to say, highest priority first: the plan (admins only), regressions,
 * quiet projects, setup, the reader's coding agents, the busiest project's traces, recoveries.
 */
function rankedRows(input: DigestRowsInput): DigestRow[] {
  const { admin, plan, codingAgentSessions, projects, mode } = input;
  const every = mode === "every-row";
  const planRow: DigestRow[] =
    admin &&
    plan !== null &&
    (every || plan.used * 100 >= DIGEST_ROW_THRESHOLDS.planPressurePercent * plan.limit)
      ? [{ kind: "plan" }]
      : [];
  const moved = movedRows(input);
  const quiet = projects
    .flatMap(({ projectId, traces, previousTraces }) =>
      traces === 0 && previousTraces !== null && previousTraces > 0
        ? [{ kind: "quiet" as const, projectId, previousTraces }]
        : [],
    )
    .toSorted((left, right) => right.previousTraces - left.previousTraces);
  const busiest = busiestFirst(projects).find(({ traces }) => traces > 0);
  const evaluated = projects.some(({ evaluationRuns }) => evaluationRuns > 0);
  const minSessions = every ? 1 : DIGEST_ROW_THRESHOLDS.codingAgentSessions;
  return [
    ...planRow,
    ...biggestFirst(moved.filter(({ row }) => row.direction === "worse")),
    ...quiet,
    ...(busiest && !evaluated ? [{ kind: "setup" as const, projectId: busiest.projectId }] : []),
    ...(codingAgentSessions >= minSessions ? [{ kind: "coding" as const }] : []),
    ...(busiest ? [{ kind: "traces" as const, projectId: busiest.projectId }] : []),
    ...biggestFirst(moved.filter(({ row }) => row.direction === "better")),
  ];
}

/** The busiest project with traces and no scenario run in five weeks: write its first scenario. */
function newRows({ projects }: DigestRowsInput): DigestRow[] {
  return busiestFirst(projects)
    .filter(
      ({ traces, scenarios, scenarioBaseline }) =>
        traces > 0 && scenarios.total + scenarioBaseline.total === 0,
    )
    .slice(0, 1)
    .map(({ projectId }) => ({ kind: "new" as const, projectId }));
}

/**
 * One per evaluator, its checks summed across projects: the line names no project to tell two
 * apart, so an evaluator that moved on any project is steady on none.
 */
function steadyEvalsOf(
  input: DigestRowsInput,
  shownOrFolded: readonly DigestRow[],
): DigestRowSelection["steadyEvals"] {
  const moved = new Set(
    shownOrFolded.flatMap((row) => (row.kind === "evals" ? [row.evaluatorType] : [])),
  );
  const steady = new Map<string, DigestRowCounts>();
  for (const { evaluators } of input.projects) {
    for (const evaluator of evaluators) {
      if (!hasEnoughChecks(evaluator) || moved.has(evaluator.evaluatorType)) continue;
      const counted = steady.get(evaluator.evaluatorType) ?? { total: 0, failed: 0 };
      steady.set(evaluator.evaluatorType, {
        total: counted.total + evaluator.week.total,
        failed: counted.failed + evaluator.week.failed,
      });
    }
  }
  return [...steady].map(([evaluatorType, week]) => ({ evaluatorType, week }));
}

/** At most two regressions and five rows, in rank order; what does not fit folds. */
function capRows(ranked: readonly DigestRow[]): Pick<DigestRowSelection, "shown" | "folded"> {
  const shown: DigestRow[] = [];
  const folded: DigestFoldedRow[] = [];
  let regressions = 0;
  for (const row of ranked) {
    const regression = isRegression(row);
    const fits =
      shown.length < DIGEST_ROW_THRESHOLDS.maxRows &&
      (!regression || regressions < DIGEST_ROW_THRESHOLDS.maxRegressions);
    if (fits) {
      shown.push(row);
      if (regression) regressions += 1;
    } else if (row.kind !== "new") {
      folded.push(row);
    }
  }
  return { shown, folded };
}

/**
 * The rows a person's email shows and the ones the cap folds, with a New row last only when
 * there is room (dropped otherwise). Nothing is shown when only a New row would be, since the
 * email is not sent then. "every-row" keeps every row, uncapped.
 */
export function selectDigestRows(input: DigestRowsInput): DigestRowSelection {
  const ranked = rankedRows(input);
  if (ranked.length === 0) return { shown: [], folded: [], steadyEvals: [] };
  const tryThis = newRows(input);
  const steadyEvals = steadyEvalsOf(input, ranked);
  if (input.mode === "every-row")
    return { shown: [...ranked, ...tryThis], folded: [], steadyEvals };
  const { shown, folded } = capRows(ranked);
  const room = DIGEST_ROW_THRESHOLDS.maxRows - shown.length;
  return { shown: [...shown, ...tryThis.slice(0, room)], folded, steadyEvals };
}
