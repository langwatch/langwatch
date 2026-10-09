/**
 * How the Upgrades pages colour and word what the reader answers (UI plan section 4). The reader
 * already labels states and step statuses; this adds the tone of a status, the command a state
 * asks for, and the page's grouping. Unknown values pass through raw in a neutral tone.
 */

export type UpgradeTone = "neutral" | "info" | "warning" | "danger" | "success";

export type UpgradeLabel = { label: string; tone: UpgradeTone };

/** The command that runs a release upgrade in the image (UI plan section 6.3). */
export const UPGRADE_COMMAND = "pnpm task upgrade";

/** The reader's reasons whose fix is to run the release upgrade. */
const REASONS_FIXED_BY_UPGRADING = new Set([
  "image-newer",
  "no-upgrade-recorded",
  "blocking-steps-pending",
]);

const STATUS_TONES: Record<string, UpgradeTone> = {
  pending: "neutral",
  running: "info",
  done: "success",
  "not-needed": "neutral",
  failed: "danger",
  gated: "neutral",
};

const RUN_OUTCOMES: Record<string, UpgradeLabel> = {
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  abandoned: { label: "Abandoned", tone: "warning" },
};

const PHASE_LABELS: Record<string, string> = {
  preflight: "Preflight",
  "postgres-schema": "Postgres schema",
  "clickhouse-schema": "ClickHouse schema",
  reconcile: "Reconcile",
};

const PHASE_OUTCOMES: Record<string, UpgradeLabel> = {
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

/** A run phase's name as the page words it; a name this release does not know reads raw. */
export function phaseLabel(name: string): string {
  return Object.hasOwn(PHASE_LABELS, name) ? PHASE_LABELS[name]! : name;
}

/** A phase's outcome; one this page does not know reads as stored, in a neutral tone. */
export function phaseOutcomeLabel(outcome: string): UpgradeLabel {
  return Object.hasOwn(PHASE_OUTCOMES, outcome)
    ? PHASE_OUTCOMES[outcome]!
    : { label: outcome, tone: "neutral" };
}

const PREFLIGHT_OUTCOMES: Record<string, UpgradeLabel> = {
  verified: { label: "Pass", tone: "success" },
  refused: { label: "Fail", tone: "danger" },
};

/** A preflight row's outcome in the checkup's words; anything else was not checked. */
export function preflightLabel(outcome: string): UpgradeLabel {
  return Object.hasOwn(PREFLIGHT_OUTCOMES, outcome)
    ? PREFLIGHT_OUTCOMES[outcome]!
    : { label: "Not checked", tone: "neutral" };
}

const MODE_LABELS: Record<string, string> = {
  schema: "Schema",
  blocking: "Blocking",
  background: "Background",
  operator: "Operator",
};

const TONES = new Set<string>(["neutral", "info", "warning", "danger", "success"]);

/** The reader's tone as one this page knows; anything else reads neutral. */
export function toneOf(tone: string): UpgradeTone {
  return TONES.has(tone) ? (tone as UpgradeTone) : "neutral";
}

/** The design-system colour palette a tone renders in. */
export function tonePalette(tone: UpgradeTone): string {
  switch (tone) {
    case "info":
      return "blue";
    case "warning":
      return "orange";
    case "danger":
      return "red";
    case "success":
      return "green";
    case "neutral":
      return "gray";
  }
}

export function statusTone(status: string): UpgradeTone {
  return Object.hasOwn(STATUS_TONES, status) ? STATUS_TONES[status]! : "neutral";
}

/** A run with no outcome yet is running; an outcome this page does not know reads as stored. */
export function runOutcomeLabel(outcome: string | null): UpgradeLabel {
  if (outcome === null) return { label: "Running", tone: "info" };
  return Object.hasOwn(RUN_OUTCOMES, outcome)
    ? RUN_OUTCOMES[outcome]!
    : { label: outcome, tone: "neutral" };
}

export function modeLabel(mode: string): string {
  return Object.hasOwn(MODE_LABELS, mode) ? MODE_LABELS[mode]! : mode;
}

/** The command the installation's state asks the operator to run, if any. */
export function upgradeCommandFor({ reason }: { reason: string }): string | null {
  return REASONS_FIXED_BY_UPGRADING.has(reason) ? UPGRADE_COMMAND : null;
}

/** Steps grouped by release in the reader's order; a step with no release goes last. */
export function groupStepsByRelease<Step extends { release: string | null }>(
  steps: readonly Step[],
): { release: string | null; steps: Step[] }[] {
  const groups: { release: string | null; steps: Step[] }[] = [];
  for (const step of steps) {
    const group = groups.find((candidate) => candidate.release === step.release);
    if (group) group.steps.push(step);
    else groups.push({ release: step.release, steps: [step] });
  }
  return [
    ...groups.filter((group) => group.release !== null),
    ...groups.filter((group) => group.release === null),
  ];
}

/** Step statuses that need nothing more; every other status is still to do. */
const FINISHED_STATUSES = new Set(["done", "not-needed"]);

export function isFinished(status: string): boolean {
  return FINISHED_STATUSES.has(status);
}

/** How many steps a release still has to do, from its counts by status. */
export function remainingCount(counts: Record<string, number>): number {
  return Object.entries(counts)
    .filter(([status]) => !isFinished(status))
    .reduce((sum, [, count]) => sum + count, 0);
}

function releaseParts(release: string): number[] {
  return release.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
}

/** Unreleased first (cloud tracks main), then newest release first. */
export function orderReleasesNewestFirst<Release extends { release: string | null }>(
  releases: readonly Release[],
): Release[] {
  return releases.toSorted((a, b) => {
    if (a.release === null || b.release === null) return a.release === null ? -1 : 1;
    const left = releaseParts(a.release);
    const right = releaseParts(b.release);
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = (right[index] ?? 0) - (left[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  });
}

/** The longest an error summary reads before it is cut; the full text is a click away. */
const ERROR_SUMMARY_LENGTH = 90;

/** An error's first clause, parenthesised detail dropped, cut to one readable line. */
export function summariseError(error: string): string {
  const clause = (error.split(/[;\n]/)[0] ?? error).replace(/\s*\([^)]*\)/g, "").trim();
  const sentence = clause.charAt(0).toUpperCase() + clause.slice(1);
  return sentence.length > ERROR_SUMMARY_LENGTH
    ? `${sentence.slice(0, ERROR_SUMMARY_LENGTH - 1).trimEnd()}…`
    : sentence;
}

/** A status count's words: `not-needed` reads "not needed". */
export function statusWords(status: string): string {
  return status.replaceAll("-", " ");
}
