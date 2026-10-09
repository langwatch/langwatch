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

/** The order a release's step groups are shown in (UI plan W2). */
export const UPGRADE_MODE_ORDER = ["blocking", "background", "operator"] as const;

const MODE_LABELS: Record<string, string> = {
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

/** Steps grouped by mode in the page's order, any unknown mode after them. */
export function groupStepsByMode<Step extends { mode: string }>(
  steps: readonly Step[],
): { mode: string; label: string; steps: Step[] }[] {
  const unknown = steps
    .map((step) => step.mode)
    .filter((mode) => !Object.hasOwn(MODE_LABELS, mode));
  return [...UPGRADE_MODE_ORDER, ...new Set(unknown)]
    .map((mode) => ({ mode, label: modeLabel(mode), steps: steps.filter((s) => s.mode === mode) }))
    .filter((group) => group.steps.length > 0);
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
