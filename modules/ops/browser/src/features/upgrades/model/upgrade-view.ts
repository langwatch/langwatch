/**
 * The ops.upgrade reads' answers, in ops' own contract shapes, named the way the sections read
 * them. Nothing here restates a shape.
 */
import type {
  OpsUpgradePreview,
  OpsUpgradeRelease,
  OpsUpgradeRun,
  OpsUpgradeRunPhase,
  OpsUpgradeRunSummary,
  OpsUpgradeStatus,
  OpsUpgradeStep,
  OpsUpgradeStepDetail,
  OpsUpgradeTarget,
  OpsUpgradeTargetSummary,
} from "@langwatch/ops-contract";

export type UpgradeRunSummaryView = OpsUpgradeRunSummary;
/** One phase of a run's report (round 9, U2-PHASES); an unknown name or outcome reads raw. */
export type UpgradeRunPhaseView = OpsUpgradeRunPhase;
/** `state` includes `never-upgraded` (round 17, U1-a), labelled "Never upgraded" by the reader. */
export type UpgradeStatusView = OpsUpgradeStatus;
export type UpgradeReleaseView = OpsUpgradeRelease;
export type UpgradeStepView = OpsUpgradeStep;
export type UpgradeTargetView = OpsUpgradeTarget;
export type UpgradeStepDetailView = OpsUpgradeStepDetail;
export type UpgradeRunDetailView = OpsUpgradeRun;
/** W5: the plan narrowed to a target release, or the reader's refusal, and the preflight rows. */
export type UpgradePreviewView = OpsUpgradePreview;
/** W7: one ClickHouse target's latest done version, outstanding steps and latest error. */
export type UpgradeTargetSummaryView = OpsUpgradeTargetSummary;
