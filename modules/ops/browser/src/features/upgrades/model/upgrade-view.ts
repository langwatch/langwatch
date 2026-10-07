/**
 * UpgradeReader's answers as they cross the wire (packages/upgrade/src/reader/reader.schema.ts,
 * dates as ISO strings). Scaffolding: once ops-api.ts maps the ops.upgrade contract, each alias
 * becomes `RouterOutputs["ops"]["upgrade"][...]`. Handoff: .claude/handoffs/mig-u2-ops-ui.md.
 */

export type UpgradeRunSummaryView = {
  id: string;
  kind: string;
  release: string | null;
  floor: string | null;
  startedAt: string;
  finishedAt: string | null;
  outcome: string | null;
};

/** One phase of a run's report (round 9, U2-PHASES); an unknown name or outcome reads raw. */
export type UpgradeRunPhaseView = {
  name: string;
  release: string | null;
  startedAt: string;
  finishedAt: string | null;
  outcome: string;
};

/** `state` includes `never-upgraded` (round 17, U1-a), labelled "Never upgraded" by the reader. */
export type UpgradeStatusView = {
  state: string;
  label: string;
  tone: string;
  reason: string;
  summary: string;
  installed: string | null;
  origin: string;
  image: string;
  floor: string | null;
  ledgerFloor: string | null;
  lease: { owner: string | null; image: string | null; expiresAt: string | null } | null;
  lastRun: UpgradeRunSummaryView | null;
  counts: Record<string, number>;
  failedStepIds: string[];
  failedTargets: number;
};

export type UpgradeReleaseView = {
  release: string | null;
  installed: boolean;
  image: boolean;
  stepCount: number;
  counts: Record<string, number>;
};

export type UpgradeStepView = {
  id: string;
  kind: string;
  release: string | null;
  mode: string;
  status: string;
  statusLabel: string;
  owner: string | null;
  description: string | null;
  recorded: boolean;
  attempt: number;
  lastError: string | null;
  report: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type UpgradeTargetView = {
  target: string;
  status: string;
  version: string | null;
  lastError: string | null;
};

export type UpgradeStepDetailView = UpgradeStepView & { targets: UpgradeTargetView[] };

export type UpgradeRunDetailView = UpgradeRunSummaryView & {
  plan: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  phases: UpgradeRunPhaseView[];
  steps: UpgradeStepView[];
};
